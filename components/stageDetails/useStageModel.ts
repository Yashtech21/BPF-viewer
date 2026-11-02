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
  /** Table the stage runs on, when it differs from the row's table */
  otherTable: string | null;
  /** Fields whose fill state is known (excludes hidden/unknown) */
  countable: number;
  filled: number;
  /** Required fields that are empty (not hidden/unknown) */
  requiredEmpty: IStageFieldRow[];
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
    // A secured column the user can't read comes back empty: don't claim it is
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
  });

  React.useEffect(() => {
    if (!enabled || !context || !canLoadSteps) return undefined;
    let cancelled = false;

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

      const fieldInfo = await infoPromise;
      if (!cancelled) {
        setState({ loading: false, stepsFailed: false, steps, values, fieldInfo, valuesSource });
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // stage identity is stable per stageId
  }, [enabled, stage.stageId, valuesEntity, valuesRecordId]);

  return React.useMemo(() => {
    if (!context) return null;
    const rows = buildRows(state.steps, state.values, state.fieldInfo);
    const known = rows.filter(r => r.state === 'filled' || r.state === 'empty');
    return {
      loading: state.loading,
      stepsFailed: state.stepsFailed,
      framing: getFraming(stage, status, context),
      rows,
      valuesSource: state.valuesSource,
      otherTable: stageEntity,
      countable: known.length,
      filled: known.filter(r => r.state === 'filled').length,
      requiredEmpty: rows.filter(r => r.step.isRequired && r.state === 'empty'),
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
      return model.requiredEmpty.length
        ? `${count} Required to move on: ${listNames(model.requiredEmpty)}.`
        : `${count} All required fields are filled.`;
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
