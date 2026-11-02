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
 * Screen readers: each stage is a button described by a summary of its card
 *   ("2 of 4 fields filled. Required to move on: …"). When the focused stage's
 *   fields finish loading, the summary is announced once; hovering announces nothing.
 * Click and Enter/Space do the same thing (toggle the card); neither opens the record.
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
  useId,
} from '@fluentui/react-components';
import type { IBPFStage } from '../../types';
import type { StageStatus } from '../designs/hooks/useBPFDesignHelpers';
import { useStageDetailsContext } from './StageDetailsContext';
import { StageDetailsCard } from './StageDetailsCard';
import { describeFields, useStageModel } from './useStageModel';
import { useVisuallyHiddenStyles } from './visuallyHidden';
import { formatDays, getStageTiming } from '../../utils/stageDetails';

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
});

/** How long the pointer must rest on a stage before the card opens */
const OPEN_DELAY_MS = 250;

/** Marks stage triggers so arrow keys can find the row's other stages */
export const STAGE_TRIGGER_ATTR = 'data-stage-trigger';

/** Marks a record row; arrow-key navigation stays inside it */
export const ROW_ATTR = 'data-bpf-row';

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

/** Selector-safe fragment */
const idPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '');

export const StageHoverCard: React.FC<IStageHoverCardProps> = ({ stage, status, index, total, children }) => {
  const context = useStageDetailsContext();
  const styles = useStyles();
  const hidden = useVisuallyHiddenStyles();
  // Unique per instance: two controls on one form may show the same record
  const summaryId = useId('bpf-stage-summary-');
  const surfaceId = useId('bpf-stage-card-');
  const [open, setOpen] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
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

  // Roving tab stop: the row's current stage (or its last stage when none is current)
  const stages = context.instance.stages;
  const hasActive = stages.some(s => s.isActive);
  const isTabStop = hasActive ? stage.isActive : index === total - 1;

  const { stopped, days, severity } = getStageTiming(stage, context.instance, context.now, context.stageAgeWarningDays);
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
    // Stay inside this record's row (falls back to the document when rendered without one)
    const scope: ParentNode = target.closest(`[${ROW_ATTR}]`) ?? document;
    const row = Array.from(scope.querySelectorAll<HTMLElement>(`[${STAGE_TRIGGER_ATTR}="${rowKey}"]`));
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
    onClick?: React.MouseEventHandler;
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
      setFocused(true);
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      childProps.onBlur?.(e);
      clearTimer();
      setFocused(false);
      setOpen(false);
    },
    // Same action as Enter/Space: toggle the card (handled by PopoverTrigger),
    // and don't let the click reach the row, which would open the record
    onClick: (e: React.MouseEvent) => {
      childProps.onClick?.(e);
      e.stopPropagation();
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
          role="group"
          aria-label={`Details for stage ${stage.stageName}`}
          onClick={stopPropagation}
          onKeyDown={stopPropagation}
          onMouseDown={stopPropagation}
        >
          <StageDetailsCard stage={stage} status={status} index={index} total={total} context={context} model={model} />
        </PopoverSurface>
      </Popover>
      {/* Description of the stage (read with its label on focus); empty while closed */}
      <span id={summaryId} className={hidden.root}>
        {open ? describeFields(model) : ''}
      </span>
      {/* Announce the loaded summary once, only for the keyboard-focused stage.
          Clearing it on blur/close is not announced. */}
      <span className={hidden.root} aria-live="polite">
        {focused && open && !model.loading ? describeFields(model) : ''}
      </span>
    </>
  );
};
