/**
 * BPF Row Component
 *
 * Displays a single record with its BPF stages.
 *
 * Header: record name (+ entity badge) on the left; process name, process
 * status, time-in-stage and progress on the right.
 * Body: the selected design, wrapped in a StageDetailsContext so every stage
 * can show a rich hover card.
 */

import * as React from 'react';
import { IBPFRowProps } from '../types';
import { getDesignComponent } from './designs';
import { ErrorBoundary } from './ErrorBoundary';
import { StageDetailsContext, IStageDetailsContextValue } from './stageDetails/StageDetailsContext';
import { RECORD_NAME_SIZES } from '../utils/themeUtils';
import { sanitizeText } from '../utils/sanitize';
import {
  formatDays,
  formatDaysShort,
  getAgeSeverity,
  getDaysInActiveStage,
  getProcessStatus,
  getProgressPercent,
} from '../utils/stageDetails';
import { Badge, makeStyles, mergeClasses, Spinner, Tooltip, tokens } from '@fluentui/react-components';
import { OpenRegular, ErrorCircleRegular, ClockRegular, WarningFilled } from '@fluentui/react-icons';

const useStyles = makeStyles({
  row: {
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    transitionProperty: 'background-color, box-shadow',
    transitionDuration: '0.15s',
    cursor: 'default',
    position: 'relative',
  },
  rowCompact: {
    padding: '6px 12px',
  },
  rowMobile: {
    padding: '6px 8px',
  },
  rowClickable: {
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    ':focus-visible': {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: tokens.colorStrokeFocus2,
      outlineOffset: '-2px',
    },
  },
  // Accent stripe on the left edge for overdue records
  accentWarning: {
    boxShadow: `inset 3px 0 0 ${tokens.colorPaletteMarigoldBorderActive}`,
  },
  accentDanger: {
    boxShadow: `inset 3px 0 0 ${tokens.colorPaletteRedBorderActive}`,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '6px',
    gap: '8px',
  },
  headerCompact: {
    marginBottom: '2px',
  },
  headerMobile: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
  },
  nameWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    flex: 1,
  },
  recordName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground1,
  },
  recordNameLink: {
    borderRadius: tokens.borderRadiusSmall,
    outlineStyle: 'none',
    ':hover': {
      color: tokens.colorBrandForegroundLinkHover,
      textDecorationLine: 'underline',
    },
    ':focus-visible': {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: tokens.colorStrokeFocus2,
    },
  },
  entityBadge: {
    fontSize: '10px',
    padding: '2px 6px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  metaWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  processName: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    maxWidth: '220px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  progress: {
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    fontVariantNumeric: 'tabular-nums',
    minWidth: '32px',
    textAlign: 'right',
  },
  navIcon: {
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
  },
  loadingWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px',
  },
  errorWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorStatusDangerBackground1,
    color: tokens.colorStatusDangerForeground1,
    fontSize: '12px',
  },
  noBpfWrapper: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
  },
  aborted: {
    opacity: 0.75,
  },
});

export const BPFRow: React.FC<IBPFRowProps> = React.memo(({
  record,
  settings,
  colors,
  isMobile,
  onNavigate,
  now,
  loaders,
}) => {
  const styles = useStyles();
  const DesignComponent = getDesignComponent(settings.designStyle);
  const nameSize = RECORD_NAME_SIZES[settings.recordNameSize] || RECORD_NAME_SIZES.medium;
  const compact = settings.density === 'compact';
  const detailsEnabled = !!settings.enableStageDetails;

  const instance = record.bpfInstance;
  const processStatus = instance ? instance.processStatus ?? getProcessStatus(instance.statusCode) : 'unknown';
  const daysInStage = getDaysInActiveStage(instance, now);
  const severity = getAgeSeverity(daysInStage, settings.stageAgeWarningDays);
  const progress = getProgressPercent(instance);

  // When stages are focusable (hover cards), the row itself must not be a
  // button (nested interactive controls). The record name becomes the
  // keyboard "open" control and the row stays clickable for mouse users.
  const rowIsButton = settings.enableNavigation && !detailsEnabled;
  const nameIsButton = settings.enableNavigation && detailsEnabled;

  const handleClick = () => {
    if (settings.enableNavigation && onNavigate) {
      onNavigate(record.entityName, record.recordId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return; // ignore keys from focusable children (stages)
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Prevent scroll on Space key
      handleClick();
    }
  };

  const contextValue = React.useMemo<IStageDetailsContextValue | null>(
    () =>
      instance
        ? {
            enabled: detailsEnabled,
            instance,
            recordId: record.recordId,
            recordName: record.recordName,
            entityName: record.entityName,
            displayMode: settings.displayMode,
            colors,
            loaders,
            stageAgeWarningDays: settings.stageAgeWarningDays,
            now,
          }
        : null,
    [instance, detailsEnabled, record.recordId, record.recordName, record.entityName, settings.displayMode, colors, loaders, settings.stageAgeWarningDays, now]
  );

  // Render BPF content based on state
  const renderBPFContent = () => {
    // Loading state
    if (record.isLoading) {
      return (
        <div className={styles.loadingWrapper}>
          <Spinner size="tiny" label="Loading BPF..." />
        </div>
      );
    }

    // Error state
    if (record.error) {
      return (
        <div className={styles.errorWrapper} role="alert">
          <ErrorCircleRegular />
          <span>{record.error}</span>
        </div>
      );
    }

    // No BPF instance
    if (!instance || instance.stages.length === 0) {
      return (
        <div className={styles.noBpfWrapper} role="status">
          <span>No active business process flow</span>
        </div>
      );
    }

    // Render design component with error boundary and suspense
    return (
      <ErrorBoundary>
        <StageDetailsContext.Provider value={contextValue}>
          <React.Suspense fallback={<div className={styles.loadingWrapper}><Spinner size="tiny" label="Loading design..." /></div>}>
            <div className={processStatus === 'aborted' ? styles.aborted : undefined}>
              <DesignComponent
                stages={instance.stages}
                displayMode={settings.displayMode}
                colors={colors}
                showPulse={settings.showPulseAnimation && processStatus !== 'aborted'}
                isMobile={isMobile}
              />
            </div>
          </React.Suspense>
        </StageDetailsContext.Provider>
      </ErrorBoundary>
    );
  };

  const safeName = sanitizeText(record.recordName);

  const nameNode = nameIsButton ? (
    <span
      className={mergeClasses(styles.recordName, styles.recordNameLink)}
      style={{ fontSize: nameSize.fontSize, fontWeight: nameSize.fontWeight }}
      title={`Open ${safeName}`}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          handleClick();
        }
      }}
    >
      {safeName}
    </span>
  ) : (
    <span
      className={styles.recordName}
      style={{ fontSize: nameSize.fontSize, fontWeight: nameSize.fontWeight }}
      title={safeName}
    >
      {safeName}
    </span>
  );

  const showMeta = !!instance && !record.isLoading && !record.error;
  const ageBadge =
    showMeta && daysInStage !== null ? (
      <Tooltip
        relationship="description"
        content={`In the current stage for ${daysInStage === 0 ? 'less than a day' : formatDays(daysInStage)}${
          severity === 'warning' || severity === 'danger' ? ` — over the ${settings.stageAgeWarningDays}-day threshold` : ''
        }`}
      >
        <Badge
          size="small"
          appearance={severity === 'warning' || severity === 'danger' ? 'filled' : 'tint'}
          color={severity === 'danger' ? 'danger' : severity === 'warning' ? 'warning' : 'informative'}
          shape="rounded"
          icon={severity === 'warning' || severity === 'danger' ? <WarningFilled /> : <ClockRegular />}
          aria-label={`${daysInStage} days in current stage`}
        >
          {formatDaysShort(daysInStage)}
        </Badge>
      </Tooltip>
    ) : null;

  return (
    <div
      className={mergeClasses(
        styles.row,
        compact && styles.rowCompact,
        isMobile && styles.rowMobile,
        settings.enableNavigation && styles.rowClickable,
        severity === 'warning' && styles.accentWarning,
        severity === 'danger' && styles.accentDanger
      )}
      onClick={handleClick}
      onKeyDown={rowIsButton ? handleKeyDown : undefined}
      role={rowIsButton ? 'button' : 'article'}
      tabIndex={rowIsButton ? 0 : undefined}
      aria-label={`${safeName} with business process flow`}
    >
      {/* Header */}
      <div className={mergeClasses(styles.header, compact && styles.headerCompact, isMobile && styles.headerMobile)}>
        <div className={styles.nameWrapper}>
          {nameNode}
          {settings.showEntityName && (
            <span className={styles.entityBadge} aria-label={`Entity type: ${sanitizeText(record.entityDisplayName)}`}>
              {sanitizeText(record.entityDisplayName)}
            </span>
          )}
        </div>
        <div className={styles.metaWrapper}>
          {instance && !isMobile && (
            <span className={styles.processName} aria-label={`Process: ${sanitizeText(instance.processName)}`}>
              {sanitizeText(instance.processName)}
            </span>
          )}
          {showMeta && processStatus === 'finished' && (
            <Badge size="small" appearance="tint" color="success" shape="rounded">
              Finished
            </Badge>
          )}
          {showMeta && processStatus === 'aborted' && (
            <Badge size="small" appearance="tint" color="danger" shape="rounded">
              Aborted
            </Badge>
          )}
          {ageBadge}
          {showMeta && (
            <span className={styles.progress} aria-label={`${progress}% complete`}>
              {progress}%
            </span>
          )}
          {settings.enableNavigation && !isMobile && (
            <OpenRegular className={styles.navIcon} aria-hidden="true" />
          )}
        </div>
      </div>

      {/* BPF Content */}
      {renderBPFContent()}
    </div>
  );
});
