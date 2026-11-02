/**
 * Stage track semantics
 *
 * A `role="progressbar"` makes its children presentational, so focusable
 * stage buttons inside it (hover cards on) would be invisible to screen
 * readers. When stage details are enabled, the track becomes a labelled
 * group and the progress value moves to a visually hidden progressbar.
 * With stage details off, the track keeps its original progressbar role.
 */

import * as React from 'react';
import { useStageDetailsContext } from '../../stageDetails/StageDetailsContext';
import { useVisuallyHiddenStyles } from '../../stageDetails/visuallyHidden';

export interface IProgressAria {
  min: number;
  max: number;
  now: number;
  label: string;
}

/** Props for the track container */
export function useTrackProps(progress: IProgressAria): React.HTMLAttributes<HTMLDivElement> {
  const details = useStageDetailsContext();
  if (details?.enabled) {
    return { role: 'group', 'aria-label': 'Business process flow stages' };
  }
  return {
    role: 'progressbar',
    'aria-valuemin': progress.min,
    'aria-valuemax': progress.max,
    'aria-valuenow': progress.now,
    'aria-label': progress.label,
  };
}

/** Hidden progressbar rendered inside the track when it is a group */
export const HiddenProgress: React.FC<{ progress: IProgressAria }> = ({ progress }) => {
  const details = useStageDetailsContext();
  const hidden = useVisuallyHiddenStyles();
  if (!details?.enabled) return null;
  return (
    <span
      className={hidden.root}
      role="progressbar"
      aria-valuemin={progress.min}
      aria-valuemax={progress.max}
      aria-valuenow={progress.now}
      aria-label={progress.label}
    />
  );
};
