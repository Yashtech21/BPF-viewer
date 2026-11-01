/**
 * Stage Details Card
 *
 * Rich content rendered inside the stage hover card:
 * - stage name, category, position and status
 * - time spent in the active stage (with overdue highlighting)
 * - the stage's steps (fields), required markers and — when the stage runs on
 *   the row's entity — whether each field is filled in, with its value
 * - process-level facts: name, status, started / finished / last updated
 */

import * as React from 'react';
import {
  Badge,
  Caption1,
  Divider,
  ProgressBar,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  CheckmarkCircleFilled,
  CircleRegular,
  ClockRegular,
  FlagCheckeredRegular,
  CalendarLtrRegular,
  WarningFilled,
  DismissCircleFilled,
  RecordRegular,
} from '@fluentui/react-icons';
import type { IBPFStage, IFieldValue, IStageStep } from '../../types';
import type { StageStatus } from '../designs/hooks/useBPFDesignHelpers';
import type { IStageDetailsContextValue } from './StageDetailsContext';
import { sanitizeText } from '../../utils/sanitize';
import {
  PROCESS_STATUS_LABELS,
  daysBetween,
  formatDate,
  formatDays,
  getAgeSeverity,
  getDaysInActiveStage,
  getProcessStatus,
} from '../../utils/stageDetails';

/** Max steps listed before collapsing into "+N more" */
const MAX_VISIBLE_STEPS = 8;

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '300px',
    maxWidth: 'calc(100vw - 32px)',
    fontFamily: tokens.fontFamilyBase,
    color: tokens.colorNeutralForeground1,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },
  headerIcon: {
    fontSize: '20px',
    flexShrink: 0,
    marginTop: '1px',
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
  },
  title: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase400,
    overflowWrap: 'anywhere',
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
  },
  fact: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  factIcon: {
    fontSize: '14px',
    flexShrink: 0,
  },
  warning: {
    color: tokens.colorPaletteMarigoldForeground2,
  },
  danger: {
    color: tokens.colorPaletteRedForeground1,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  stepList: {
    listStyleType: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  step: {
    display: 'grid',
    gridTemplateColumns: '16px minmax(0, 1fr) auto',
    alignItems: 'center',
    columnGap: '6px',
    fontSize: tokens.fontSizeBase200,
  },
  stepIconDone: {
    color: tokens.colorPaletteGreenForeground1,
    fontSize: '14px',
  },
  stepIconTodo: {
    color: tokens.colorNeutralForeground3,
    fontSize: '14px',
  },
  stepName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  required: {
    color: tokens.colorPaletteRedForeground1,
    marginLeft: '2px',
  },
  stepValue: {
    color: tokens.colorNeutralForeground3,
    maxWidth: '120px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'right',
  },
  muted: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
});

const STATUS_BADGE: Record<StageStatus, { label: string; color: 'success' | 'brand' | 'informative' }> = {
  completed: { label: 'Completed', color: 'success' },
  active: { label: 'Current', color: 'brand' },
  inactive: { label: 'Upcoming', color: 'informative' },
};

export interface IStageDetailsCardProps {
  stage: IBPFStage;
  status: StageStatus;
  index: number;
  total: number;
  context: IStageDetailsContextValue;
}

interface ILoadState {
  loading: boolean;
  steps: IStageStep[] | null;
  values: Map<string, IFieldValue> | null;
}

/** Lazily loads the steps and record values when the card mounts (i.e. opens) */
function useStageData(stage: IBPFStage, context: IStageDetailsContextValue): ILoadState {
  const { loaders, entityName, recordId } = context;
  const stageEntityMatches = !stage.entityName || stage.entityName === entityName;
  const canLoadSteps = !!loaders?.loadStageSteps || !!stage.steps;

  const [state, setState] = React.useState<ILoadState>({
    loading: canLoadSteps,
    steps: stage.steps ?? null,
    values: null,
  });

  React.useEffect(() => {
    if (!canLoadSteps) return;
    let cancelled = false;

    const stepsPromise = stage.steps
      ? Promise.resolve(stage.steps)
      : loaders!.loadStageSteps!(stage);

    stepsPromise
      .then(steps => {
        const needsValues = stageEntityMatches && steps.some(s => s.fieldName) && !!loaders?.loadRecordValues;
        const valuesPromise = needsValues
          ? loaders!.loadRecordValues!(entityName, recordId)
          : Promise.resolve(null);
        return valuesPromise.then(values => ({ steps, values }));
      })
      .then(({ steps, values }) => {
        if (!cancelled) setState({ loading: false, steps, values });
      })
      .catch(() => {
        if (!cancelled) setState(prev => ({ ...prev, loading: false }));
      });

    return () => {
      cancelled = true;
    };
    // stage identity is stable per stageId
  }, [stage.stageId, entityName, recordId]);

  return state;
}

export const StageDetailsCard: React.FC<IStageDetailsCardProps> = ({ stage, status, index, total, context }) => {
  const styles = useStyles();
  const { instance, colors, stageAgeWarningDays, now } = context;
  const { loading, steps, values } = useStageData(stage, context);

  const processStatus = instance.processStatus ?? getProcessStatus(instance.statusCode);
  const isAborted = processStatus === 'aborted';
  const badge = isAborted && stage.isActive
    ? { label: 'Stopped here', color: 'danger' as const }
    : STATUS_BADGE[status];

  // ---- Time in stage (active stage only) ----
  const daysInStage = stage.isActive ? getDaysInActiveStage(instance, now) : null;
  const severity = getAgeSeverity(daysInStage, stageAgeWarningDays);

  // ---- Steps / completion ----
  const stepRows = (steps ?? []).map(step => {
    const value = step.fieldName && values ? values.get(step.fieldName.toLowerCase()) : undefined;
    return { step, value };
  });
  const canShowCompletion = !!values && stepRows.some(r => r.step.fieldName);
  const filledCount = stepRows.filter(r => r.value?.hasValue).length;
  const requiredMissing = stepRows.filter(r => r.step.isRequired && values && !r.value?.hasValue).length;
  const visibleRows = stepRows.slice(0, MAX_VISIBLE_STEPS);
  const hiddenCount = stepRows.length - visibleRows.length;

  // ---- Header icon ----
  const headerIcon =
    status === 'completed' ? (
      <CheckmarkCircleFilled className={styles.headerIcon} style={{ color: colors.completed }} />
    ) : isAborted && stage.isActive ? (
      <DismissCircleFilled className={mergeClasses(styles.headerIcon, styles.danger)} />
    ) : status === 'active' ? (
      <RecordRegular className={styles.headerIcon} style={{ color: colors.active }} />
    ) : (
      <CircleRegular className={styles.headerIcon} style={{ color: colors.inactiveText }} />
    );

  const startedOn = formatDate(instance.createdOn);
  const completedOn = formatDate(instance.completedOn);
  const modifiedOn = formatDate(instance.modifiedOn, true);
  const totalDays = processStatus === 'finished' ? daysBetween(instance.createdOn, instance.completedOn) : null;

  return (
    <div className={styles.root} data-testid="stage-details-card">
      {/* Header */}
      <div className={styles.header}>
        {headerIcon}
        <div className={styles.headerText}>
          <span className={styles.title}>{sanitizeText(stage.stageName)}</span>
          <Caption1 className={styles.subtitle}>
            Stage {index + 1} of {total}
            {stage.stageCategoryName && stage.stageCategoryName !== stage.stageName
              ? ` · ${sanitizeText(stage.stageCategoryName)}`
              : ''}
          </Caption1>
        </div>
        <Badge appearance="tint" color={badge.color} size="small" shape="rounded">
          {badge.label}
        </Badge>
      </div>

      {/* Time in stage */}
      {stage.isActive && processStatus === 'active' && (
        <div
          className={mergeClasses(
            styles.fact,
            severity === 'warning' && styles.warning,
            severity === 'danger' && styles.danger
          )}
        >
          {severity === 'warning' || severity === 'danger' ? (
            <WarningFilled className={styles.factIcon} />
          ) : (
            <ClockRegular className={styles.factIcon} />
          )}
          <span>
            {daysInStage === null
              ? 'Current stage'
              : daysInStage === 0
                ? 'Entered this stage today'
                : `In this stage for ${formatDays(daysInStage)}`}
            {instance.activeStageStartedOn ? ` · since ${formatDate(instance.activeStageStartedOn)}` : ''}
            {severity === 'danger' || severity === 'warning' ? ' (overdue)' : ''}
          </span>
        </div>
      )}
      {status === 'inactive' && <div className={styles.muted}>Not started yet</div>}

      {/* Steps */}
      {(loading || stepRows.length > 0) && (
        <>
          <Divider />
          <div className={styles.sectionHeader}>
            <span>Steps</span>
            {canShowCompletion && (
              <span>
                {filledCount}/{stepRows.length} filled
              </span>
            )}
          </div>
          {loading ? (
            <Spinner size="extra-tiny" label="Loading steps…" />
          ) : (
            <>
              {canShowCompletion && (
                <ProgressBar
                  value={stepRows.length ? filledCount / stepRows.length : 0}
                  thickness="medium"
                  color={requiredMissing > 0 && stage.isActive ? 'warning' : 'success'}
                  aria-label={`${filledCount} of ${stepRows.length} steps filled`}
                />
              )}
              <ul className={styles.stepList} aria-label="Stage steps">
                {visibleRows.map(({ step, value }) => {
                  const done = !!value?.hasValue;
                  return (
                    <li key={`${step.fieldName}|${step.displayName}`} className={styles.step}>
                      {canShowCompletion && done ? (
                        <CheckmarkCircleFilled className={styles.stepIconDone} aria-label="Filled" />
                      ) : (
                        <CircleRegular className={styles.stepIconTodo} aria-label={canShowCompletion ? 'Empty' : undefined} />
                      )}
                      <span className={styles.stepName} title={sanitizeText(step.displayName)}>
                        {sanitizeText(step.displayName)}
                        {step.isRequired && (
                          <span className={styles.required} aria-label="required">
                            *
                          </span>
                        )}
                      </span>
                      <span className={styles.stepValue}>
                        {canShowCompletion ? (value?.display ? sanitizeText(value.display) : done ? '✓' : '—') : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {hiddenCount > 0 && <div className={styles.muted}>+{hiddenCount} more</div>}
              {requiredMissing > 0 && stage.isActive && (
                <div className={mergeClasses(styles.fact, styles.warning)}>
                  <WarningFilled className={styles.factIcon} />
                  <span>
                    {requiredMissing} required {requiredMissing === 1 ? 'field' : 'fields'} missing to move on
                  </span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Process footer */}
      <Divider />
      <div className={styles.footer}>
        <div className={styles.fact}>
          <FlagCheckeredRegular className={styles.factIcon} />
          <span>
            {sanitizeText(instance.processName)} · {PROCESS_STATUS_LABELS[processStatus]}
          </span>
        </div>
        {startedOn && (
          <div className={styles.fact}>
            <CalendarLtrRegular className={styles.factIcon} />
            <span>
              Started {startedOn}
              {completedOn ? ` · Finished ${completedOn}` : ''}
              {totalDays !== null ? ` (${totalDays === 0 ? 'same day' : formatDays(totalDays)})` : ''}
            </span>
          </div>
        )}
        {modifiedOn && (
          <Caption1 className={styles.subtitle}>
            Last updated {modifiedOn}
            {instance.modifiedByName ? ` by ${sanitizeText(instance.modifiedByName)}` : ''}
          </Caption1>
        )}
      </div>
    </div>
  );
};
