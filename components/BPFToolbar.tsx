/**
 * BPF Toolbar
 *
 * Search, filter and sort controls shown above the record list, plus a
 * one-click "current stage" distribution that doubles as a stage filter.
 *
 * The filtering/sorting logic lives in `applyListView` (pure, unit-tested);
 * this file only renders controls.
 */

import * as React from 'react';
import {
  Button,
  Dropdown,
  Input,
  Option,
  ToggleButton,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, DismissRegular, SearchRegular } from '@fluentui/react-icons';
import type { DisplayMode, IRecordBPFData } from '../types';
import { getStageLabel } from '../utils/themeUtils';
import {
  getAgeSeverity,
  getDaysInActiveStage,
  getProcessStatus,
  getProgressPercent,
} from '../utils/stageDetails';

// ============================================
// List view model (pure)
// ============================================

export type StatusFilter = 'all' | 'active' | 'finished' | 'aborted' | 'overdue' | 'none';
export type SortOrder = 'default' | 'name' | 'progressDesc' | 'progressAsc' | 'ageDesc';

export interface IListViewState {
  query: string;
  status: StatusFilter;
  /** Current-stage label to filter on, or null for all */
  stage: string | null;
  sort: SortOrder;
}

export const DEFAULT_LIST_VIEW: IListViewState = { query: '', status: 'all', stage: null, sort: 'default' };

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All statuses',
  active: 'Active',
  finished: 'Finished',
  aborted: 'Aborted',
  overdue: 'Overdue',
  none: 'No process',
};

export const SORT_LABELS: Record<SortOrder, string> = {
  default: 'View order',
  name: 'Name (A–Z)',
  progressDesc: 'Most progress',
  progressAsc: 'Least progress',
  ageDesc: 'Longest in stage',
};

/** Label of the record's current stage (active stage, or last stage when finished) */
export function getCurrentStageLabel(record: IRecordBPFData, displayMode: DisplayMode): string | null {
  const stages = record.bpfInstance?.stages;
  if (!stages || stages.length === 0) return null;
  const current = stages.find(s => s.isActive) ?? stages.find(s => s.stageId === record.bpfInstance?.activeStageId) ?? stages[stages.length - 1];
  return getStageLabel(current.stageName, current.stageCategoryName, displayMode);
}

export interface IStageCount {
  label: string;
  count: number;
}

/** Count records per current stage (only active processes), in first-seen stage order */
export function getStageDistribution(records: IRecordBPFData[], displayMode: DisplayMode): IStageCount[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const record of records) {
    const instance = record.bpfInstance;
    if (!instance || (instance.processStatus ?? getProcessStatus(instance.statusCode)) !== 'active') continue;
    const label = getCurrentStageLabel(record, displayMode);
    if (!label) continue;
    if (!counts.has(label)) order.push(label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return order.map(label => ({ label, count: counts.get(label)! }));
}

/** Apply search, filters and sort to the record list */
export function applyListView(
  records: IRecordBPFData[],
  view: IListViewState,
  displayMode: DisplayMode,
  warningDays: number | null | undefined,
  now: number
): IRecordBPFData[] {
  const query = view.query.trim().toLowerCase();

  const filtered = records.filter(record => {
    const instance = record.bpfInstance;
    const status = instance ? instance.processStatus ?? getProcessStatus(instance.statusCode) : null;

    if (query) {
      const haystack = [record.recordName, instance?.processName, getCurrentStageLabel(record, displayMode)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    switch (view.status) {
      case 'active':
      case 'finished':
      case 'aborted':
        if (status !== view.status) return false;
        break;
      case 'overdue': {
        const severity = getAgeSeverity(getDaysInActiveStage(instance, now), warningDays);
        if (severity !== 'warning' && severity !== 'danger') return false;
        break;
      }
      case 'none':
        if (instance && instance.stages.length > 0) return false;
        break;
      default:
        break;
    }

    if (view.stage) {
      if (status !== 'active' || getCurrentStageLabel(record, displayMode) !== view.stage) return false;
    }

    return true;
  });

  if (view.sort === 'default') return filtered;

  const sorted = [...filtered];
  const age = (r: IRecordBPFData) => getDaysInActiveStage(r.bpfInstance, now) ?? -1;
  switch (view.sort) {
    case 'name':
      sorted.sort((a, b) => a.recordName.localeCompare(b.recordName, undefined, { sensitivity: 'base', numeric: true }));
      break;
    case 'progressDesc':
      sorted.sort((a, b) => getProgressPercent(b.bpfInstance) - getProgressPercent(a.bpfInstance));
      break;
    case 'progressAsc':
      sorted.sort((a, b) => getProgressPercent(a.bpfInstance) - getProgressPercent(b.bpfInstance));
      break;
    case 'ageDesc':
      sorted.sort((a, b) => age(b) - age(a));
      break;
  }
  return sorted;
}

// ============================================
// Component
// ============================================

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    position: 'sticky',
    top: 0,
    zIndex: 3,
  },
  rootMobile: {
    padding: '8px',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  search: {
    flex: '1 1 180px',
    minWidth: '140px',
    maxWidth: '320px',
  },
  dropdown: {
    minWidth: '140px',
  },
  spacer: {
    flex: 1,
  },
  summary: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
  },
  overdue: {
    color: tokens.colorPaletteRedForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  chips: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  chipCount: {
    marginLeft: '6px',
    fontVariantNumeric: 'tabular-nums',
    opacity: 0.8,
  },
});

export interface IBPFToolbarProps {
  view: IListViewState;
  onChange: (view: IListViewState) => void;
  totalCount: number;
  shownCount: number;
  overdueCount: number;
  showOverdueFilter: boolean;
  distribution: IStageCount[];
  isMobile: boolean;
  onRefresh?: () => void;
}

export const BPFToolbar: React.FC<IBPFToolbarProps> = ({
  view,
  onChange,
  totalCount,
  shownCount,
  overdueCount,
  showOverdueFilter,
  distribution,
  isMobile,
  onRefresh,
}) => {
  const styles = useStyles();
  const statusOptions = (Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).filter(
    key => key !== 'overdue' || showOverdueFilter
  );

  return (
    <div className={mergeClasses(styles.root, isMobile && styles.rootMobile)} role="toolbar" aria-label="Filter and sort records">
      <div className={styles.controls}>
        <Input
          className={styles.search}
          size="small"
          value={view.query}
          placeholder="Search records, processes, stages"
          aria-label="Search records"
          contentBefore={<SearchRegular />}
          contentAfter={
            view.query ? (
              <Button
                size="small"
                appearance="transparent"
                icon={<DismissRegular />}
                aria-label="Clear search"
                onClick={() => onChange({ ...view, query: '' })}
              />
            ) : undefined
          }
          onChange={(_e, data) => onChange({ ...view, query: data.value })}
        />
        <Dropdown
          className={styles.dropdown}
          size="small"
          aria-label="Filter by status"
          value={STATUS_FILTER_LABELS[view.status]}
          selectedOptions={[view.status]}
          onOptionSelect={(_e, data) => onChange({ ...view, status: (data.optionValue as StatusFilter) || 'all' })}
        >
          {statusOptions.map(key => (
            <Option key={key} value={key}>
              {STATUS_FILTER_LABELS[key]}
            </Option>
          ))}
        </Dropdown>
        <Dropdown
          className={styles.dropdown}
          size="small"
          aria-label="Sort records"
          value={SORT_LABELS[view.sort]}
          selectedOptions={[view.sort]}
          onOptionSelect={(_e, data) => onChange({ ...view, sort: (data.optionValue as SortOrder) || 'default' })}
        >
          {(Object.keys(SORT_LABELS) as SortOrder[]).map(key => (
            <Option key={key} value={key}>
              {SORT_LABELS[key]}
            </Option>
          ))}
        </Dropdown>
        <span className={styles.spacer} />
        <span className={styles.summary} aria-live="polite">
          {shownCount === totalCount ? `${totalCount} records` : `${shownCount} of ${totalCount} records`}
          {overdueCount > 0 && (
            <>
              {' · '}
              <span className={styles.overdue}>{overdueCount} overdue</span>
            </>
          )}
        </span>
        {onRefresh && (
          <Tooltip content="Refresh" relationship="label">
            <Button size="small" appearance="subtle" icon={<ArrowClockwiseRegular />} onClick={onRefresh} />
          </Tooltip>
        )}
      </div>

      {distribution.length > 1 && !isMobile && (
        <div className={styles.chips} role="group" aria-label="Records by current stage">
          {distribution.map(({ label, count }) => {
            const checked = view.stage === label;
            return (
              <ToggleButton
                key={label}
                size="small"
                shape="circular"
                appearance={checked ? 'primary' : 'outline'}
                checked={checked}
                onClick={() => onChange({ ...view, stage: checked ? null : label })}
                aria-label={`${label}: ${count} record${count === 1 ? '' : 's'}`}
              >
                {label}
                <span className={styles.chipCount}>{count}</span>
              </ToggleButton>
            );
          })}
        </div>
      )}
    </div>
  );
};
