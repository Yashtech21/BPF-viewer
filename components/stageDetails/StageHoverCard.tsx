/**
 * StageHoverCard
 *
 * Wraps a single stage element of any design. When a StageDetailsContext is
 * present and enabled, hovering (or keyboard-focusing) the stage opens a
 * Fluent Popover with the StageDetailsCard. Without a context it renders the
 * child untouched, so designs keep working stand-alone.
 *
 * Mouse: opens after a short rest on the stage; the pointer can move into the card.
 * Keyboard (one tab stop per row, roving):
 *   - Tab lands on the row's current stage; ←/→ (and Home/End) move between stages
 *   - focusing a stage opens its card; Enter/Space toggles it; Escape closes it
 * Screen readers: each stage is a button whose description is a live summary
 *   of the card ("2 of 4 fields filled. Required to move on: …"), so the card's
 *   content is announced without moving focus into it.
 * Escape closes the card from anywhere, including when it was opened by
 * hovering (WCAG 1.4.13 "dismissible").
 */

import * as React from 'react';
import {
  Popover,
  PopoverSurface,
  PopoverTrigger,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import type { IBPFStage } from '../../types';
import type { StageStatus } from '../designs/hooks/useBPFDesignHelpers';
import { useStageDetailsContext } from './StageDetailsContext';
import { StageDetailsCard } from './StageDetailsCard';
import { describeFields, useStageModel } from './useStageModel';
import { formatDays, getAgeSeverity, getDaysInActiveStage, getProcessStatus } from '../../utils/stageDetails';

const useStyles = makeStyles({
  trigger: {
    cursor: 'help',
    outlineStyle: 'none',
    ':focus-visible': {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: tokens.colorStrokeFocus2,
      outlineOffset: '2px',
    },
  },
  surface: {
    padding: '12px 14px',
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow16,
  },
  visuallyHidden: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
});

/** How long the pointer must rest on a stage before the card opens */
const OPEN_DELAY_MS = 250;

/** Marks stage triggers so arrow keys can find the row's other stages */
export const STAGE_TRIGGER_ATTR = 'data-stage-trigger';

const STATUS_WORD: Record<StageStatus, string> = {
  completed: 'completed',
  active: 'current',
  inactive: 'upcoming',
};

export interface IStageHoverCardProps {
  stage: IBPFStage;
  status: StageStatus;
  index: number;
  total: number;
  children: React.ReactElement;
}

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

/** Stable, selector-safe id fragment */
const idPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '');

export const StageHoverCard: React.FC<IStageHoverCardProps> = ({ stage, status, index, total, children }) => {
  const context = useStageDetailsContext();
  const styles = useStyles();
  const [open, setOpen] = React.useState(false);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = !!context && context.enabled;
  const model = useStageModel(stage, status, enabled ? context : null, enabled && open);

  const clearTimer = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };

  React.useEffect(() => clearTimer, []);

  // Escape dismisses the card however it was opened (hover leaves focus elsewhere)
  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearTimer();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!context || !enabled || !model) {
    return children;
  }

  const rowKey = idPart(context.recordId);
  const summaryId = `bpf-stage-summary-${rowKey}-${idPart(stage.stageId)}`;
  const surfaceId = `bpf-stage-card-${rowKey}-${idPart(stage.stageId)}`;

  // Roving tab stop: the row's current stage (or its last stage when none is current)
  const stages = context.instance.stages;
  const hasActive = stages.some(s => s.isActive);
  const isTabStop = hasActive ? stage.isActive : index === total - 1;

  const processStatus = context.instance.processStatus ?? getProcessStatus(context.instance.statusCode);
  const stopped = processStatus === 'aborted' && stage.isActive;
  const days = stage.isActive ? getDaysInActiveStage(context.instance, context.now) : null;
  const severity = getAgeSeverity(days, context.stageAgeWarningDays);
  const label =
    `Stage ${index + 1} of ${total}: ${stage.stageName}, ${stopped ? 'stopped' : STATUS_WORD[status]}` +
    (days !== null && !stopped ? `, ${days === 0 ? 'entered today' : `${formatDays(days)} in stage`}` : '') +
    (severity === 'warning' || severity === 'danger' ? ', overdue' : '');

  const handleOpenChange = (_e: unknown, data: { open: boolean }) => {
    clearTimer();
    if (data.open) {
      // Small delay avoids a flurry of cards when sweeping the mouse across a grid
      openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    } else {
      setOpen(false);
    }
  };

  const moveFocus = (target: HTMLElement, key: string) => {
    const row = Array.from(
      document.querySelectorAll<HTMLElement>(`[${STAGE_TRIGGER_ATTR}="${rowKey}"]`)
    );
    const at = row.indexOf(target);
    if (at < 0) return;
    const next =
      key === 'Home' ? 0 : key === 'End' ? row.length - 1 : key === 'ArrowLeft' ? Math.max(0, at - 1) : Math.min(row.length - 1, at + 1);
    row[next]?.focus();
  };

  const childProps = children.props as {
    className?: string;
    role?: string;
    onFocus?: React.FocusEventHandler;
    onBlur?: React.FocusEventHandler;
    onKeyDown?: React.KeyboardEventHandler;
  };
  // A design whose single element *is* the progress indicator keeps that role
  const keepRole = childProps.role === 'progressbar';

  const trigger = React.cloneElement(children, {
    className: mergeClasses(childProps.className, styles.trigger),
    tabIndex: isTabStop ? 0 : -1,
    [STAGE_TRIGGER_ATTR]: rowKey,
    // The card replaces the native tooltip
    title: undefined,
    ...(keepRole ? {} : { role: 'button', 'aria-label': label }),
    'aria-describedby': summaryId,
    'aria-controls': open ? surfaceId : undefined,
    onFocus: (e: React.FocusEvent) => {
      childProps.onFocus?.(e);
      clearTimer();
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      childProps.onBlur?.(e);
      clearTimer();
      setOpen(false);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      childProps.onKeyDown?.(e);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        moveFocus(e.currentTarget, e.key);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation(); // don't open the record
        clearTimer();
        setOpen(o => !o);
      }
    },
  } as Record<string, unknown>);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
        openOnHover
        mouseLeaveDelay={150}
        withArrow
        positioning={{ position: 'above', autoSize: true }}
        size="small"
      >
        <PopoverTrigger disableButtonEnhancement>{trigger}</PopoverTrigger>
        <PopoverSurface
          id={surfaceId}
          className={styles.surface}
          aria-label={`Details for stage ${stage.stageName}`}
          onClick={stopPropagation}
          onKeyDown={stopPropagation}
          onMouseDown={stopPropagation}
        >
          <StageDetailsCard stage={stage} status={status} index={index} total={total} context={context} model={model} />
        </PopoverSurface>
      </Popover>
      {/* Spoken summary of the card; updates (politely) once the fields load */}
      <span id={summaryId} className={styles.visuallyHidden} aria-live="polite">
        {open ? describeFields(model) : 'Press Enter for stage details.'}
      </span>
    </>
  );
};
