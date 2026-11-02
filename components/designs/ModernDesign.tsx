/**
 * Modern Design - Fluent 2 progress tiles
 *
 * Features:
 * - Each stage is a tile with a rounded progress bar, a status icon,
 *   the stage label and a short caption (Done / Current · 12d / Step 3)
 * - Soft ring pulse on the current stage, hover highlight, focus ring
 * - Captions use the row's BPF instance (via StageDetailsContext) to show
 *   time in the current stage and an overdue tint
 * - Compact layout on narrow containers (caption hidden, labels kept)
 */

import * as React from 'react';
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { CheckmarkCircleFilled, CircleRegular, DismissCircleFilled } from '@fluentui/react-icons';
import type { IBPFDesignProps } from '../../types';
import { useBPFDesignHelpers } from './hooks/useBPFDesignHelpers';
import { StageHoverCard } from '../stageDetails/StageHoverCard';
import { HiddenProgress, useTrackProps } from './shared/StageTrackSemantics';
import { useStageDetailsContext } from '../stageDetails/StageDetailsContext';
import { getStageLabel } from '../../utils/themeUtils';
import { formatDaysShort, getAgeSeverity, getDaysInActiveStage, getProcessStatus } from '../../utils/stageDetails';
import { TRANSITION_DURATION, PULSE_DURATION, PULSE_RING_KEYFRAMES, REDUCED_MOTION } from './designConstants';

const useModernStyles = makeStyles({
  container: {
    display: 'flex',
    alignItems: 'stretch',
    gap: '4px',
    width: '100%',
  },
  tile: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '6px 6px 4px',
    borderRadius: tokens.borderRadiusMedium,
    transitionProperty: 'background-color, transform',
    transitionDuration: TRANSITION_DURATION,
    ':hover': {
      backgroundColor: tokens.colorSubtleBackgroundHover,
    },
    ...REDUCED_MOTION,
  },
  tileMobile: {
    padding: '4px 2px 2px',
    gap: '4px',
  },
  bar: {
    height: '4px',
    borderRadius: tokens.borderRadiusCircular,
    transitionProperty: 'background-color',
    transitionDuration: TRANSITION_DURATION,
  },
  body: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
  },
  icon: {
    flexShrink: 0,
    fontSize: '16px',
    display: 'inline-flex',
  },
  iconMobile: {
    fontSize: '14px',
  },
  dot: {
    width: '12px',
    height: '12px',
    margin: '2px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  pulse: {
    animationName: PULSE_RING_KEYFRAMES,
    animationDuration: PULSE_DURATION,
    animationIterationCount: 'infinite',
    ...REDUCED_MOTION,
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  label: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  labelActive: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  caption: {
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase100,
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  captionWarning: {
    color: tokens.colorPaletteMarigoldForeground2,
    fontWeight: tokens.fontWeightSemibold,
  },
  captionDanger: {
    color: tokens.colorPaletteRedForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
});

const ModernDesignComponent: React.FC<IBPFDesignProps> = ({
  stages,
  displayMode,
  colors,
  showPulse,
  isMobile,
}) => {
  const styles = useModernStyles();
  const details = useStageDetailsContext();
  const { stageMetadata, a11yMetadata } = useBPFDesignHelpers(stages, displayMode, colors, showPulse);

  const processStatus = details ? details.instance.processStatus ?? getProcessStatus(details.instance.statusCode) : 'active';
  const isAborted = processStatus === 'aborted';
  const daysInStage = details ? getDaysInActiveStage(details.instance, details.now) : null;
  const severity = getAgeSeverity(daysInStage, details?.stageAgeWarningDays);

  const progress = {
    min: 0,
    max: a11yMetadata.totalCount,
    now: a11yMetadata.completedCount,
    label: `Business process flow: ${a11yMetadata.completedCount} of ${a11yMetadata.totalCount} stages complete${
        a11yMetadata.activeStage
          ? `. Current stage: ${getStageLabel(
              a11yMetadata.activeStage.stageName,
              a11yMetadata.activeStage.stageCategoryName,
              displayMode
            )}`
          : ''
      }`,
  };
  const trackProps = useTrackProps(progress);

  return (
    <div
      className={styles.container}
      {...trackProps}
    >
      <HiddenProgress progress={progress} />
      {stageMetadata.map(({ stage, status, stageColor, label, shouldPulse }, index) => {
        const isActive = status === 'active';
        const stoppedHere = isAborted && isActive;

        let caption: string;
        if (status === 'completed') caption = 'Done';
        else if (stoppedHere) caption = 'Stopped';
        else if (isActive) caption = daysInStage !== null ? `Current · ${formatDaysShort(daysInStage)}` : 'Current';
        else caption = `Step ${index + 1}`;

        const barColor = stoppedHere ? tokens.colorPaletteRedBorderActive : status === 'inactive' ? colors.track : stageColor.bg;

        const icon =
          status === 'completed' ? (
            <CheckmarkCircleFilled className={mergeClasses(styles.icon, isMobile && styles.iconMobile)} style={{ color: colors.completed }} />
          ) : stoppedHere ? (
            <DismissCircleFilled className={mergeClasses(styles.icon, isMobile && styles.iconMobile)} style={{ color: tokens.colorPaletteRedForeground1 }} />
          ) : isActive ? (
            <span
              className={mergeClasses(styles.dot, shouldPulse && !isAborted && styles.pulse)}
              style={{ backgroundColor: colors.active, boxShadow: `0 0 0 3px ${colors.track}` }}
            />
          ) : (
            <CircleRegular className={mergeClasses(styles.icon, isMobile && styles.iconMobile)} style={{ color: colors.inactiveText }} />
          );

        return (
          <StageHoverCard key={stage.stageId} stage={stage} status={status} index={index} total={stageMetadata.length}>
            <div
              className={mergeClasses(styles.tile, isMobile && styles.tileMobile)}
              role="img"
              aria-label={`Stage ${index + 1}: ${label} - ${stoppedHere ? 'stopped' : status}`}
              aria-current={stage.isActive ? 'step' : undefined}
            >
              <div className={styles.bar} style={{ backgroundColor: barColor }} />
              <div className={styles.body}>
                {icon}
                <div className={styles.text}>
                  <span
                    className={mergeClasses(styles.label, isActive && styles.labelActive)}
                    style={isActive ? undefined : { color: colors.inactiveText }}
                  >
                    {label}
                  </span>
                  {!isMobile && (
                    <span
                      className={mergeClasses(
                        styles.caption,
                        isActive && !isAborted && severity === 'warning' && styles.captionWarning,
                        isActive && !isAborted && severity === 'danger' && styles.captionDanger
                      )}
                    >
                      {caption}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </StageHoverCard>
        );
      })}
    </div>
  );
};

// Memoized export to prevent unnecessary re-renders
export const ModernDesign = React.memo(ModernDesignComponent);
