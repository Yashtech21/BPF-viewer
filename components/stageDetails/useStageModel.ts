/**
 * useStageModel
 *
 * Loads and interprets everything the stage hover card says about a stage's
 * fields, so the visible card and the screen-reader summary share one truth.
 *
 * Data sources (nothing is hard-coded):
 * - steps: processstage.clientdata (BPF designer), hidden steps skipped
 * - labels: the BPF step label, else the field's localized display name from metadata
 * - values: the record the stage runs on — the row's record, or for a stage on
 *   another table, the record the BPF instance points at (e.g. its lead)
 * - field security: a secured field with no value is "hidden", never "empty"
 *
 * A required field the card can't verify (secured, or not returned by the
 * record) is never silently treated as filled: it is reported as "couldn't check".
 */

import * as React from 'react';
import type { IBPFStage, IFieldInfo, IFieldValue, IStageStep } from '../../types';
import type { StageStatus } from '../designs/hooks/useBPFDesignHelpers';
import type { IStageDetailsContextValue } from './StageDetailsContext';
import { findRelatedRecordId, getProcessStatus } from '../../utils/stageDetails';

export type FieldState = 'filled' | 'empty' | 'hidden' | 'unknown';

export interface IStageFieldRow {
  step: IStageStep;
  /** Label to show: BPF step label, else metadata display name, else logical name */
  label: string;
  state: FieldState;
  /** Formatted value when filled and displayable */
  display: string | null;
}

/** How the card should frame the stage's fields, by stage + process state */
export type StageFraming =
  | 'current' // fill count, bar, "required to move on"
  | 'completed' // values only; note required fields that are empty now
  | 'upcoming' // values and fill count, no warning
  | 'stopped'; // aborted process stopped here: values only, no "move on"

export type ValuesSource = 'record' | 'related' | 'unavailable-other-table' | 'error' | 'none';

export interface IStageModel {
  loading: boolean;
  /** Steps could not be loaded */
  stepsFailed: boolean;
  framing: StageFraming;
  rows: IStageFieldRow[];
  valuesSource: ValuesSource;
  /** Table the stage runs on, when it differs from the row's table (logical name) */
  otherTable: string | null;
  /** Localized display name of otherTable, when known */
  otherTableName: string | null;
  /** Fields whose fill state is known (excludes hidden/unknown) */
  countable: number;
  filled: number;
  /** Required fields that are empty (not hidden/unknown) */
  requiredEmpty: IStageFieldRow[];
  /**
   * Required fields whose value can't be verified although values loaded:
   * secured without a readable value, or not returned by the record
   */
  requiredUnverified: IStageFieldRow[];
}

export function getFraming(stage: IBPFStage, status: StageStatus, context: IStageDetailsContextValue): StageFraming {
  const processStatus = context.instance.processStatus ?? getProcessStatus(context.instance.statusCode);
  if (processStatus === 'aborted' && stage.isActive) return 'stopped';
  if (status === 'completed') return 'completed';
  if (status === 'active') return 'current';
  return 'upcoming';
}

/** Pure interpretation step (exported for tests) */
export function buildRows(
  steps: IStageStep[],
  values: Map<string, IFieldValue> | null,
  fieldInfo: Map<string, IFieldInfo>
): IStageFieldRow[] {
  return steps.map(step => {
    const key = step.fieldName.toLowerCase();
    const info = key ? fieldInfo.get(key) : undefined;
    const ownLabel = step.displayName && step.displayName.toLowerCase() !== key ? step.displayName : '';
    const label = ownLabel || info?.displayName || step.displayName || step.fieldName;

    if (!key || !values) {
      return { step, label, state: 'unknown' as const, display: null };
    }
    const value = values.get(key);
    if (value?.hasValue) {
      return { step, label, state: 'filled' as const, display: value.display };
    }
    // A secured column comes back empty both when it IS empty and when the user
    // can't read it — the two are indistinguishable, so don't claim either
    if (info?.isSecured) {
      return { step, label, state: 'hidden' as const, display: null };
    }
    // Not returned at all (not a column of this table, or no access): unknown
    if (!value) {
      return { step, label, state: 'unknown' as const, display: null };
    }
    return { step, label, state: 'empty' as const, display: null };
  });
}

interface ILoadState {
  loading: boolean;
  stepsFailed: boolean;
  steps: IStageStep[];
  values: Map<string, IFieldValue> | null;
  fieldInfo: Map<string, IFieldInfo>;
  valuesSource: ValuesSource;
  otherTableName: string | null;
}

const EMPTY_INFO = new Map<string, IFieldInfo>();

/**
 * @param enabled load only while the card is open
 */
export function useStageModel(
  stage: IBPFStage,
  status: StageStatus,
  context: IStageDetailsContextValue | null,
  enabled: boolean
): IStageModel | null {
  const loaders = context?.loaders;
  const rowEntity = context?.entityName ?? '';
  const stageEntity = stage.entityName && stage.entityName !== rowEntity ? stage.entityName : null;
  const valuesRecordId = context
    ? stageEntity
      ? findRelatedRecordId(context.instance.relatedRecordIds, stageEntity)
      : context.recordId
    : null;
  const valuesEntity = stageEntity ?? rowEntity;
  const canLoadSteps = !!stage.steps || !!loaders?.loadStageSteps;

  const [state, setState] = React.useState<ILoadState>({
    loading: canLoadSteps,
    stepsFailed: false,
    steps: stage.steps ?? [],
    values: null,
    fieldInfo: EMPTY_INFO,
    valuesSource: 'none',
    otherTableName: null,
  });

  React.useEffect(() => {
    if (!enabled || !context || !canLoadSteps) return undefined;
    let cancelled = false;
    // (Re)opening = (re)loading: never show a previous failure or stale values while retrying
    setState(prev => ({ ...prev, loading: true, stepsFailed: false, values: null, valuesSource: 'none' }));

    const run = async () => {
      let steps: IStageStep[];
      try {
        steps = stage.steps ?? (await loaders!.loadStageSteps!(stage));
      } catch {
        if (!cancelled) setState(prev => ({ ...prev, loading: false, stepsFailed: true }));
        return;
      }

      const fields = steps.map(s => s.fieldName).filter(Boolean);
      const infoPromise =
        fields.length && loaders?.loadFieldInfo
          ? loaders.loadFieldInfo(valuesEntity, fields).catch(() => EMPTY_INFO)
          : Promise.resolve(EMPTY_INFO);

      let values: Map<string, IFieldValue> | null = null;
      let valuesSource: ValuesSource = 'none';
      if (fields.length && loaders?.loadRecordValues) {
        if (!valuesRecordId) {
          valuesSource = 'unavailable-other-table';
        } else {
          try {
            values = await loaders.loadRecordValues(valuesEntity, valuesRecordId);
            valuesSource = stageEntity ? 'related' : 'record';
          } catch {
            valuesSource = 'error';
          }
        }
      }

      const tableNamePromise =
        stageEntity && loaders?.loadTableName
          ? loaders.loadTableName(stageEntity).catch(() => null)
          : Promise.resolve(null);

      const [fieldInfo, otherTableName] = await Promise.all([infoPromise, tableNamePromise]);
      if (!cancelled) {
        setState({ loading: false, stepsFailed: false, steps, values, fieldInfo, valuesSource, otherTableName });
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [enabled, stage.stageId, stage.steps, loaders, valuesEntity, valuesRecordId]);

  return React.useMemo(() => {
    if (!context) return null;
    const rows = buildRows(state.steps, state.values, state.fieldInfo);
    const known = rows.filter(r => r.state === 'filled' || r.state === 'empty');
    const valuesLoaded = state.valuesSource === 'record' || state.valuesSource === 'related';
    return {
      loading: state.loading,
      stepsFailed: state.stepsFailed,
      framing: getFraming(stage, status, context),
      rows,
      valuesSource: state.valuesSource,
      otherTable: stageEntity,
      otherTableName: state.otherTableName,
      countable: known.length,
      filled: known.filter(r => r.state === 'filled').length,
      requiredEmpty: rows.filter(r => r.step.isRequired && r.state === 'empty'),
      requiredUnverified: valuesLoaded
        ? rows.filter(r => r.step.isRequired && r.step.fieldName && (r.state === 'hidden' || r.state === 'unknown'))
        : [],
    };
  }, [state, stage, status, context, stageEntity]);
}

/** Names list for sentences: "A", "A and B", "A, B and 2 more" */
export function listNames(rows: IStageFieldRow[], max = 2): string {
  const names = rows.map(r => r.label);
  if (names.length <= max) return names.join(' and ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/** One-sentence summary of the stage's fields, for screen readers */
export function describeFields(model: IStageModel): string {
  if (model.loading) return 'Loading fields.';
  if (model.stepsFailed) return "Couldn't load this stage's fields.";
  if (model.rows.length === 0) return 'This stage has no fields.';
  if (model.valuesSource === 'error') return `${model.rows.length} fields. Couldn't load their values.`;
  if (model.valuesSource === 'unavailable-other-table' || model.countable === 0) {
    return `${model.rows.length} fields: ${listNames(model.rows, 3)}.`;
  }
  const count = `${model.filled} of ${model.countable} fields filled.`;
  switch (model.framing) {
    case 'current':
      if (model.requiredEmpty.length) return `${count} Required to move on: ${listNames(model.requiredEmpty)}.`;
      if (model.requiredUnverified.length) {
        return `${count} Couldn't check required ${model.requiredUnverified.length === 1 ? 'field' : 'fields'}: ${listNames(model.requiredUnverified)}.`;
      }
      return `${count} All required fields are filled.`;
    case 'completed':
      return model.requiredEmpty.length
        ? `${count} ${model.requiredEmpty.length} required ${model.requiredEmpty.length === 1 ? 'field is' : 'fields are'} empty on the record now.`
        : count;
    case 'stopped':
      return `${count} The process was stopped at this stage.`;
    default:
      return count;
  }
}

/** Display name for another table: localized name when loaded, else a tidy logical name */
export function tableLabel(model: Pick<IStageModel, 'otherTable' | 'otherTableName'>): string {
  if (model.otherTableName) return model.otherTableName;
  const name = model.otherTable ?? '';
  return name.charAt(0).toUpperCase() + name.slice(1);
}
