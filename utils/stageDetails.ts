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
import { getStageFields, parseDefinition, DefinitionNode } from './processDefinition';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ============================================
// clientdata parsing
// ============================================

/**
 * Parse the step list from a processstage.clientdata JSON document (a single
 * StageStep tree). Same field rules as the process definition parser: every
 * ControlStep `dataFieldName` in the stage, in order. Never throws.
 */
export function parseStageSteps(clientData: string | null | undefined): IStageStep[] {
  const root = parseDefinition(clientData);
  if (!root || typeof root !== 'object') return [];
  return getStageFields(root as DefinitionNode);
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

// ============================================
// Field value formatting
// ============================================

/** null, undefined, '' and [] count as "no value" */
export function isEmptyValue(raw: unknown): boolean {
  return raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Display text for a raw value when the platform gave no formatted value.
 * Formatted values (currency with symbol, option set labels, user date
 * format) always win; this only covers what's left by type.
 */
export function formatRawValue(raw: unknown, attributeType?: string, locale?: string): string {
  if (isEmptyValue(raw)) return '';
  const type = (attributeType ?? '').toLowerCase();
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (raw instanceof Date) return formatDate(raw.toISOString(), type !== 'dateonly', locale);
  if (typeof raw === 'string' && (type === 'datetime' || ISO_DATE_RE.test(raw))) {
    const formatted = formatDate(raw, raw.includes('T'), locale);
    if (formatted) return formatted;
  }
  if (typeof raw === 'number') {
    try {
      return type === 'money'
        ? new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(raw)
        : new Intl.NumberFormat(locale).format(raw);
    } catch {
      return String(raw);
    }
  }
  if (Array.isArray(raw)) {
    return raw.map(item => formatRawValue(item, attributeType, locale)).filter(Boolean).join(', ');
  }
  if (typeof raw === 'object') {
    const named = raw as { name?: unknown; Name?: unknown };
    const name = named.name ?? named.Name;
    return typeof name === 'string' ? name : '';
  }
  return String(raw);
}
