/**
 * Stage details context
 *
 * Supplies per-row information (the BPF instance, the record, loaders, the
 * overdue threshold) to the stage hover cards without threading extra props
 * through every design component. When no provider is present, hover cards
 * are disabled and designs render exactly as before.
 */

import * as React from 'react';
import type { DisplayMode, IBPFInstance, IStageColors, IStageDetailsLoaders } from '../../types';

export interface IStageDetailsContextValue {
  enabled: boolean;
  instance: IBPFInstance;
  recordId: string;
  recordName: string;
  entityName: string;
  displayMode: DisplayMode;
  colors: IStageColors;
  loaders?: IStageDetailsLoaders;
  stageAgeWarningDays?: number | null;
  /** Reference time (ms) used for "time in stage" */
  now?: number;
}

export const StageDetailsContext = React.createContext<IStageDetailsContextValue | null>(null);

export const useStageDetailsContext = (): IStageDetailsContextValue | null =>
  React.useContext(StageDetailsContext);
