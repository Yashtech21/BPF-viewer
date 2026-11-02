/**
 * Stage details utilities
 *
 * Pure helpers used by the stage hover card, the row header and the toolbar:
 * - parsing the steps (fields) of a stage from processstage.clientdata
 * - deriving process status / progress
 * - computing "time in stage" and the overdue severity
 * - locale-aware date formatting
 */

import type { IBPFInstance, IStageStep, ProcessStatus } from '../types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ============================================
// clientdata parsing
// ============================================

type JsonNode = { [key: string]: unknown };

function isObject(value: unknown): value is JsonNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function className(node: JsonNode): string {
  return typeof node.__class === 'string' ? node.__class : '';
}

/** Depth-first search for the first descendant that binds a data field */
function findControl(node: unknown, depth = 0): JsonNode | null {
  if (depth > 12) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findControl(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(node)) return null;
  if (typeof node.dataFieldName === 'string' || typeof node.controlId === 'string') {
    return node;
  }
  for (const key of Object.keys(node)) {
    const found = findControl(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Parse the step list from a processstage.clientdata JSON document.
 *
 * The document is a serialized Workflow ObjectModel tree:
 *   StageStep -> steps.list[] -> StepStep (isProcessRequired, description)
 *                                   -> steps.list[] -> ControlStep (dataFieldName, controlDisplayName)
 *
 * The walker is deliberately tolerant: it does not depend on exact nesting,
 * only on the `__class` names and well-known property names, and it never throws.
 */
export function parseStageSteps(clientData: string | null | undefined): IStageStep[] {
  if (!clientData) return [];

  let root: unknown;
  try {
    root = JSON.parse(clientData);
  } catch {
    return [];
  }

  const steps: IStageStep[] = [];
  const seen = new Set<string>();

  const push = (step: IStageStep) => {
    const key = `${step.fieldName}|${step.displayName}`;
    if (seen.has(key) || (!step.fieldName && !step.displayName)) return;
    seen.add(key);
    steps.push(step);
  };

  const walk = (node: unknown, depth: number): void => {
    if (depth > 16) return;
    if (Array.isArray(node)) {
      node.forEach(child => walk(child, depth + 1));
      return;
    }
    if (!isObject(node)) return;

    const cls = className(node);

    // StepStep: one visible step in the stage (wraps a ControlStep)
    if (cls.startsWith('StepStep')) {
      const control = findControl(node.steps);
      const fieldName = asString(control?.dataFieldName) || asString(control?.controlId);
      const displayName =
        asString(control?.controlDisplayName) ||
        asString(node.description) ||
        asString(node.name) ||
        fieldName;
      // Steps hidden in the BPF designer are not shown to users in D365 either
      if (node.isHidden !== true && control?.isHidden !== true) {
        push({ fieldName, displayName, isRequired: node.isProcessRequired === true });
      }
      return; // children already consumed
    }

    // A ControlStep outside a StepStep (older/alternate serializations)
    if (cls.startsWith('ControlStep') && typeof node.dataFieldName === 'string') {
      if (node.isHidden === true) return;
      const fieldName = node.dataFieldName;
      push({
        fieldName,
        displayName: asString(node.controlDisplayName) || fieldName,
        isRequired: node.isProcessRequired === true || node.isRequired === true,
      });
      return;
    }

    for (const key of Object.keys(node)) {
      walk(node[key], depth + 1);
    }
  };

  walk(root, 0);
  return steps;
}

// ============================================
// Process status & progress
// ============================================

/** Map a BPF instance statuscode to a lifecycle status */
export function getProcessStatus(statusCode: number | null | undefined): ProcessStatus {
  switch (statusCode) {
    case 1:
      return 'active';
    case 2:
      return 'finished';
    case 3:
      return 'aborted';
    default:
      return 'unknown';
  }
}

export const PROCESS_STATUS_LABELS: Record<ProcessStatus, string> = {
  active: 'Active',
  finished: 'Finished',
  aborted: 'Aborted',
  unknown: 'Unknown',
};

/** Percent of stages completed (0–100) */
export function getProgressPercent(instance: IBPFInstance | null | undefined): number {
  if (!instance || instance.stages.length === 0) return 0;
  const completed = instance.stages.filter(s => s.isCompleted).length;
  return Math.round((completed / instance.stages.length) * 100);
}

/** 1-based position of the active stage (or last stage when none is active) */
export function getActiveStagePosition(instance: IBPFInstance): { index: number; total: number } {
  const total = instance.stages.length;
  const idx = instance.stages.findIndex(s => s.isActive || s.stageId === instance.activeStageId);
  return { index: idx >= 0 ? idx + 1 : total, total };
}

// ============================================
// Time in stage
// ============================================

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whole days the record has spent in its active stage.
 * Returns null when the process isn't active or the start date is unknown.
 */
export function getDaysInActiveStage(
  instance: IBPFInstance | null | undefined,
  now: number = Date.now()
): number | null {
  if (!instance) return null;
  const status = instance.processStatus ?? getProcessStatus(instance.statusCode);
  if (status !== 'active') return null;
  const started = parseDate(instance.activeStageStartedOn);
  if (started === null) return null;
  return Math.max(0, Math.floor((now - started) / MS_PER_DAY));
}

export type AgeSeverity = 'none' | 'ok' | 'warning' | 'danger';

/**
 * Severity of the time-in-stage indicator.
 * - `none`    – no threshold configured or age unknown
 * - `ok`      – under the threshold
 * - `warning` – at/over the threshold
 * - `danger`  – at/over twice the threshold
 */
export function getAgeSeverity(days: number | null, warningDays: number | null | undefined): AgeSeverity {
  if (days === null || !warningDays || warningDays <= 0) return 'none';
  if (days >= warningDays * 2) return 'danger';
  if (days >= warningDays) return 'warning';
  return 'ok';
}

/** Compact human duration, e.g. "Today", "1 day", "12 days", "3 mo", "1.5 yr" */
export function formatDays(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 60) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${years} yr`;
}

/** Short duration for compact badges: "0d", "12d", "3mo", "2y" */
export function formatDaysShort(days: number): string {
  if (days < 60) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/** Locale-aware date (and optionally time) for an ISO timestamp; '' if invalid */
export function formatDate(value: string | null | undefined, withTime = false, locale?: string): string {
  const ms = parseDate(value);
  if (ms === null) return '';
  try {
    const options: Intl.DateTimeFormatOptions = withTime
      ? { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { year: 'numeric', month: 'short', day: 'numeric' };
    return new Intl.DateTimeFormat(locale, options).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Whole days between two ISO timestamps (null if either is missing) */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = parseDate(from);
  const b = parseDate(to);
  if (a === null || b === null) return null;
  return Math.max(0, Math.floor((b - a) / MS_PER_DAY));
}

// ============================================
// Record values
// ============================================

const FORMATTED_SUFFIX = '@OData.Community.Display.V1.FormattedValue';

/**
 * Convert a raw Web API entity into a field → value map.
 * Lookups (`_x_value`) are exposed under their attribute logical name `x`
 * so they can be matched against step dataFieldName values.
 */
export function toFieldValueMap(entity: Record<string, unknown> | null | undefined): Map<string, { hasValue: boolean; display: string | null }> {
  const map = new Map<string, { hasValue: boolean; display: string | null }>();
  if (!entity) return map;

  for (const key of Object.keys(entity)) {
    if (key.includes('@')) continue;
    const raw = entity[key];
    const formatted = entity[`${key}${FORMATTED_SUFFIX}`];
    const hasValue = raw !== null && raw !== undefined && raw !== '';
    const isLookup = /^_.+_value$/.test(key);
    let display: string | null = null;
    if (typeof formatted === 'string' && formatted) {
      display = formatted;
    } else if (!isLookup && hasValue && (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')) {
      display = typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : String(raw);
    }

    const logicalName = /^_(.+)_value$/.exec(key)?.[1] ?? key;
    map.set(logicalName.toLowerCase(), { hasValue, display });
  }
  return map;
}

// ============================================
// Cross-entity stages
// ============================================

/** Lookups on a BPF instance row that never point at a stage's record */
const NON_RECORD_LOOKUPS = new Set([
  'activestageid', 'processid', 'ownerid', 'owninguser', 'owningteam', 'owningbusinessunit',
  'createdby', 'createdonbehalfby', 'modifiedby', 'modifiedonbehalfby', 'organizationid',
  'transactioncurrencyid',
]);

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Collect the record lookups on a BPF instance row: attribute logical name → record id.
 * A BPF entity has one lookup per table its stages run on (e.g. `leadid`,
 * `opportunityid`, or `bpf_<table>id` for custom BPFs).
 */
export function collectRelatedRecordIds(row: Record<string, unknown>): Record<string, string> {
  const related: Record<string, string> = {};
  for (const key of Object.keys(row)) {
    const match = /^_(.+)_value$/.exec(key);
    if (!match) continue;
    const attribute = match[1].toLowerCase();
    if (NON_RECORD_LOOKUPS.has(attribute)) continue;
    const value = row[key];
    if (typeof value === 'string' && GUID_RE.test(value)) {
      related[attribute] = value;
    }
  }
  return related;
}

/**
 * Find the record a stage on `entityName` refers to, using the BPF instance's
 * lookups. Prefers an exact `<entity>id` attribute, then a prefixed one
 * such as `bpf_<entity>id` (custom BPFs). Returns null when ambiguous or absent.
 */
export function findRelatedRecordId(
  related: Record<string, string> | undefined,
  entityName: string
): string | null {
  if (!related) return null;
  const target = `${entityName.toLowerCase()}id`;
  if (related[target]) return related[target];
  const prefixed = Object.keys(related).filter(attr => attr.endsWith(`_${target}`));
  return prefixed.length === 1 ? related[prefixed[0]] : null;
}

// ============================================
// Per-stage timing / status (shared by the hover trigger and card)
// ============================================

export interface IStageTiming {
  processStatus: ProcessStatus;
  /** The process was aborted while this stage was current */
  stopped: boolean;
  /** Days in this stage — only for the current stage of an active process */
  days: number | null;
  severity: AgeSeverity;
}

export function getStageTiming(
  stage: { isActive: boolean },
  instance: IBPFInstance,
  now: number | undefined,
  warningDays: number | null | undefined
): IStageTiming {
  const processStatus = instance.processStatus ?? getProcessStatus(instance.statusCode);
  const days = stage.isActive ? getDaysInActiveStage(instance, now) : null;
  return {
    processStatus,
    stopped: processStatus === 'aborted' && stage.isActive,
    days,
    severity: getAgeSeverity(days, warningDays),
  };
}
