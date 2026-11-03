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
  LockClosedRegular,
  CircleHintRegular,
  ErrorCircleRegular,
} from '@fluentui/react-icons';
import type { IBPFStage } from '../../types';
import type { StageStatus } from '../designs/hooks/useBPFDesignHelpers';
import type { IStageDetailsContextValue } from './StageDetailsContext';
import { IStageModel, IStageFieldRow, listNames, tableLabel } from './useStageModel';
import { useVisuallyHiddenStyles } from './visuallyHidden';
import { sanitizeText } from '../../utils/sanitize';
import {
  PROCESS_STATUS_LABELS,
  daysBetween,
  formatDate,
  formatDays,
  getStageTiming,
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
  hiddenTag: {
    color: tokens.colorNeutralForeground3,
    fontStyle: 'italic',
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
  /** Loaded/interpreted field data, shared with the trigger's spoken summary */
  model: IStageModel;
}

export const StageDetailsCard: React.FC<IStageDetailsCardProps> = ({ stage, status, index, total, context, model }) => {
  const styles = useStyles();
  const { instance, colors, stageAgeWarningDays, now } = context;
  const { loading, stepsFailed, rows, framing, valuesSource, countable, filled, requiredEmpty, requiredUnverified } = model;

  const { processStatus, stopped, days: daysInStage, severity } = getStageTiming(stage, instance, now, stageAgeWarningDays);
  const isAborted = processStatus === 'aborted';
  const badge = stopped ? { label: 'Stopped here', color: 'danger' as const } : STATUS_BADGE[status];

  // ---- Fields ----
  const hasValues = valuesSource === 'record' || valuesSource === 'related';
  // Fill count only where "how much is done" is the question; not for completed/stopped stages
  const showCount = hasValues && countable > 0 && (framing === 'current' || framing === 'upcoming');
  const visibleRows = rows.slice(0, MAX_VISIBLE_STEPS);
  const hiddenCount = rows.length - visibleRows.length;
  const tableName = tableLabel(model);

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
      {(loading || stepsFailed || rows.length > 0) && (
        <>
          <Divider />
          <div className={styles.sectionHeader}>
            <span>Steps</span>
            {showCount && (
              <span>
                {filled}/{countable} filled
              </span>
            )}
          </div>
          {loading ? (
            <Spinner size="extra-tiny" label="Loading steps…" />
          ) : stepsFailed ? (
            <div className={styles.muted} role="status">
              Couldn&apos;t load this stage&apos;s fields. Hover the stage again to retry.
            </div>
          ) : (
            <>
              {showCount && framing === 'current' && (
                <ProgressBar
                  value={filled / countable}
                  thickness="medium"
                  color={requiredEmpty.length > 0 ? 'warning' : 'success'}
                  aria-label={`${filled} of ${countable} fields filled`}
                />
              )}
              {valuesSource === 'related' && (
                <div className={styles.muted}>Values from the related {tableName} record</div>
              )}
              {valuesSource === 'unavailable-other-table' && (
                <div className={styles.muted}>
                  This stage runs on {tableName}; no {tableName} record is linked to this process yet.
                </div>
              )}
              {valuesSource === 'error' && (
                <div className={styles.muted} role="status">
                  Couldn&apos;t load the field values. Hover the stage again to retry.
                </div>
              )}
              <ul className={styles.stepList} aria-label="Stage steps">
                {visibleRows.map(row => (
                  <FieldRow key={`${row.step.fieldName}|${row.step.displayName}`} row={row} showState={hasValues} />
                ))}
              </ul>
              {hiddenCount > 0 && <div className={styles.muted}>+{hiddenCount} more</div>}
              {hasValues && framing === 'current' && requiredEmpty.length > 0 && (
                <div className={mergeClasses(styles.fact, styles.warning)}>
                  <WarningFilled className={styles.factIcon} />
                  <span>Required to move on: {listNames(requiredEmpty)}</span>
                </div>
              )}
              {hasValues && framing === 'current' && requiredEmpty.length === 0 && requiredUnverified.length > 0 && (
                <div className={styles.muted}>
                  Couldn&apos;t check required {requiredUnverified.length === 1 ? 'field' : 'fields'}:{' '}
                  {listNames(requiredUnverified)} (field security or not on this record)
                </div>
              )}
              {hasValues && framing === 'completed' && requiredEmpty.length > 0 && (
                <div className={styles.muted}>
                  {requiredEmpty.length} required {requiredEmpty.length === 1 ? 'field is' : 'fields are'} empty on the
                  record now ({listNames(requiredEmpty)})
                </div>
              )}
              {framing === 'stopped' && (
                <div className={styles.muted}>The process was stopped at this stage.</div>
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

const FieldRow: React.FC<{ row: IStageFieldRow; showState: boolean }> = ({ row, showState }) => {
  const styles = useStyles();
  const hidden = useVisuallyHiddenStyles();
  const { step, label, state, display } = row;
  const name = sanitizeText(label);

  let icon: React.ReactElement;
  let value: string;
  if (!showState || state === 'unknown') {
    icon = <CircleHintRegular className={styles.stepIconTodo} aria-hidden="true" />;
    value = '';
  } else if (state === 'filled') {
    icon = <CheckmarkCircleFilled className={styles.stepIconDone} aria-hidden="true" />;
    value = display ? sanitizeText(display) : 'Set';
  } else if (state === 'failed') {
    icon = <ErrorCircleRegular className={styles.stepIconTodo} aria-hidden="true" />;
    value = "couldn't load";
  } else if (state === 'hidden') {
    icon = <LockClosedRegular className={styles.stepIconTodo} aria-hidden="true" />;
    // Secured + no value: either empty or not readable by this user
    value = 'empty or no access';
  } else {
    icon = <CircleRegular className={styles.stepIconTodo} aria-hidden="true" />;
    value = 'empty';
  }

  return (
    <li className={styles.step}>
      {icon}
      <span className={styles.stepName} title={name}>
        {name}
        {step.isHidden && <span className={styles.hiddenTag}> (hidden in BPF)</span>}
        {step.isRequired && (
          <span className={styles.required}>
            <span aria-hidden="true">*</span>
            <span className={hidden.root}> (required)</span>
          </span>
        )}
      </span>
      <span className={styles.stepValue} title={value || undefined}>
        {value}
      </span>
    </li>
  );
};
