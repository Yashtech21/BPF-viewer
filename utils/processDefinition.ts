/**
 * Process definition (workflow.clientdata) parsing
 *
 * A BPF's whole definition is stored on its workflow record as a serialized
 * Workflow ObjectModel tree. Stages are nested under the entity step(s), so
 * they are found by a recursive walk instead of reading a fixed path:
 *
 *   EntityStep -> steps.list[] -> StageStep (stageId)
 *                                   -> steps.list[] -> StepStep (isProcessRequired, description)
 *                                                        -> steps.list[] -> ControlStep (dataFieldName, controlDisplayName)
 *
 * Everything here is pure and never throws on unexpected shapes.
 */

import type { IStageStep } from '../types';

export type DefinitionNode = Record<string, unknown>;

/** Normalize a GUID for comparison: no braces, lower case, trimmed */
export function normGuid(value: string | null | undefined): string {
  return (value ?? '').replace(/[{}]/g, '').trim().toLowerCase();
}

function isObject(value: unknown): value is DefinitionNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Depth-first walk over every object node (document order), bounded for safety */
export function* walk(node: unknown, depth = 0): Generator<DefinitionNode> {
  if (depth > 64) return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child, depth + 1);
    return;
  }
  if (isObject(node)) {
    yield node;
    for (const value of Object.values(node)) yield* walk(value, depth + 1);
  }
}

/** Parse clientdata JSON (string or already-parsed); null when invalid */
export function parseDefinition(clientData: string | unknown): unknown {
  if (typeof clientData !== 'string') return clientData ?? null;
  if (!clientData) return null;
  try {
    return JSON.parse(clientData);
  } catch {
    return null;
  }
}

/** Every stage node in the definition (nodes carrying a string `stageId`), in order */
export function getStages(clientData: string | unknown): DefinitionNode[] {
  const root = parseDefinition(clientData);
  if (!root) return [];
  const stages: DefinitionNode[] = [];
  const seen = new Set<string>();
  for (const node of walk(root)) {
    const id = asString(node.stageId);
    if (!id) continue;
    // stageId is the stage's own id on StageStep nodes; skip repeats/back-references
    const cls = asString(node.__class);
    if (cls && !cls.startsWith('StageStep')) continue;
    const key = normGuid(id);
    if (seen.has(key)) continue;
    seen.add(key);
    stages.push(node);
  }
  return stages;
}

/** The stage node whose stageId matches (GUIDs compared normalized) */
export function findStage(clientData: string | unknown, stageId: string): DefinitionNode | null {
  const target = normGuid(stageId);
  return getStages(clientData).find(stage => normGuid(asString(stage.stageId)) === target) ?? null;
}

/**
 * Every field that belongs to a stage, in definition order.
 * Each field comes from a ControlStep's `dataFieldName`; when it is wrapped in
 * a StepStep, that step supplies the required flag and its description.
 */
export function getStageFields(stage: DefinitionNode | null | undefined): IStageStep[] {
  if (!stage) return [];
  const fields: IStageStep[] = [];

  const byName = new Map<string, IStageStep>();

  const add = (control: DefinitionNode, step: DefinitionNode | null) => {
    const fieldName = asString(control.dataFieldName).trim();
    if (!fieldName) return;
    const isRequired = step?.isProcessRequired === true || control.isProcessRequired === true || control.isRequired === true;
    const isHidden = control.isHidden === true || step?.isHidden === true;

    // Listed once; a repeat can still make it required or visible
    const existing = byName.get(fieldName.toLowerCase());
    if (existing) {
      existing.isRequired = existing.isRequired || isRequired;
      if (existing.isHidden && !isHidden) delete existing.isHidden;
      return;
    }

    const controlDisplayName = asString(control.controlDisplayName).trim();
    const field: IStageStep = {
      fieldName,
      controlDisplayName: controlDisplayName || undefined,
      displayName: controlDisplayName || asString(step?.description).trim() || asString(step?.name).trim() || fieldName,
      isRequired,
      ...(isHidden ? { isHidden: true } : {}),
    };
    byName.set(fieldName.toLowerCase(), field);
    fields.push(field);
  };

  const visit = (node: unknown, step: DefinitionNode | null, depth: number): void => {
    if (depth > 64) return;
    if (Array.isArray(node)) {
      node.forEach(child => visit(child, step, depth + 1));
      return;
    }
    if (!isObject(node)) return;
    const cls = asString(node.__class);
    // A nested stage belongs to itself, not to this one
    if (depth > 0 && typeof node.stageId === 'string' && (!cls || cls.startsWith('StageStep'))) return;
    const currentStep = cls.startsWith('StepStep') ? node : step;
    if (typeof node.dataFieldName === 'string') add(node, currentStep);
    for (const value of Object.values(node)) visit(value, currentStep, depth + 1);
  };

  visit(stage, null, 0);
  return fields;
}

/** Fields of the stage with `stageId` in a process definition */
export function getFieldsForStage(clientData: string | unknown, stageId: string): IStageStep[] | null {
  const stage = findStage(clientData, stageId);
  return stage ? getStageFields(stage) : null;
}

/** The active stage per the instance's traversed path: its last entry (normalized), or null */
export function getActiveStageId(traversedPath: string | null | undefined): string | null {
  const ids = (traversedPath ?? '').split(',').map(normGuid).filter(Boolean);
  return ids.length ? ids[ids.length - 1] : null;
}
