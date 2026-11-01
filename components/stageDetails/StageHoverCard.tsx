/**
 * StageHoverCard
 *
 * Wraps a single stage element of any design. When a StageDetailsContext is
 * present and enabled, hovering (or keyboard-focusing) the stage opens a
 * Fluent Popover with the StageDetailsCard. Without a context it renders the
 * child untouched, so designs keep working stand-alone.
 *
 * Behaviour:
 * - opens on mouse hover (with Fluent's leave delay so the pointer can move into the card)
 * - opens on keyboard focus, closes on blur / Escape
 * - clicks inside the card do not bubble to the row (which would navigate)
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

export interface IStageHoverCardProps {
  stage: IBPFStage;
  status: StageStatus;
  index: number;
  total: number;
  children: React.ReactElement;
}

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export const StageHoverCard: React.FC<IStageHoverCardProps> = ({ stage, status, index, total, children }) => {
  const context = useStageDetailsContext();
  const styles = useStyles();
  const [open, setOpen] = React.useState(false);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };

  React.useEffect(() => clearTimer, []);

  if (!context || !context.enabled) {
    return children;
  }

  const handleOpenChange = (_e: unknown, data: { open: boolean }) => {
    clearTimer();
    if (data.open) {
      // Small delay avoids a flurry of cards when sweeping the mouse across a grid
      openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    } else {
      setOpen(false);
    }
  };

  const childProps = children.props as {
    className?: string;
    onFocus?: React.FocusEventHandler;
    onBlur?: React.FocusEventHandler;
  };

  const trigger = React.cloneElement(children, {
    className: mergeClasses(childProps.className, styles.trigger),
    tabIndex: 0,
    // The card replaces the native tooltip
    title: undefined,
    'aria-haspopup': 'dialog',
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
  } as Record<string, unknown>);

  return (
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
        className={styles.surface}
        role="dialog"
        aria-label={`Details for stage ${stage.stageName}`}
        onClick={stopPropagation}
        onKeyDown={stopPropagation}
        onMouseDown={stopPropagation}
      >
        <StageDetailsCard stage={stage} status={status} index={index} total={total} context={context} />
      </PopoverSurface>
    </Popover>
  );
};
