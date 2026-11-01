/**
 * Toolbar, list view model and v1.1 row features
 */

import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import {
  applyListView,
  getStageDistribution,
  getCurrentStageLabel,
  DEFAULT_LIST_VIEW,
} from '../../components/BPFToolbar';
import { BPFViewer } from '../../components/BPFViewer';
import { BPFRow } from '../../components/BPFRow';
import {
  createMockBPFInstance,
  createMockBPFStage,
  createMockRecordBPFData,
  createMockStageColors,
} from '../setup/testUtils';
import type { IBPFInstance, IControlSettings, IRecordBPFData } from '../../types';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const colors = createMockStageColors();

function instanceAt(activeIdx: number | null, opts: Partial<IBPFInstance> = {}): IBPFInstance {
  const names = ['Qualify', 'Develop', 'Propose', 'Close'];
  const stages = names.map((name, i) =>
    createMockBPFStage(`s${i}`, name, name, i, i, activeIdx === null ? true : i < activeIdx, i === activeIdx)
  );
  return {
    ...createMockBPFInstance('p', 'Opportunity Sales Process', 'opportunitysalesprocess', stages, activeIdx === null ? null : `s${activeIdx}`, opts.statusCode ?? 1),
    ...opts,
  };
}

const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();

const records: IRecordBPFData[] = [
  createMockRecordBPFData('r1', 'Contoso deal', 'opportunity', 'Opportunity', instanceAt(1, { activeStageStartedOn: daysAgo(3) })),
  createMockRecordBPFData('r2', 'Adatum renewal', 'opportunity', 'Opportunity', instanceAt(2, { activeStageStartedOn: daysAgo(20) })),
  createMockRecordBPFData('r3', 'Fabrikam expansion', 'opportunity', 'Opportunity', instanceAt(1, { activeStageStartedOn: daysAgo(9) })),
  createMockRecordBPFData('r4', 'Northwind', 'opportunity', 'Opportunity', instanceAt(null, { statusCode: 2 })),
  createMockRecordBPFData('r5', 'Litware', 'opportunity', 'Opportunity', instanceAt(0, { statusCode: 3 })),
  createMockRecordBPFData('r6', 'No process co', 'opportunity', 'Opportunity', null),
];

const ids = (list: IRecordBPFData[]) => list.map(r => r.recordId);

describe('applyListView', () => {
  const run = (view: Partial<typeof DEFAULT_LIST_VIEW>, warningDays: number | null = 7) =>
    ids(applyListView(records, { ...DEFAULT_LIST_VIEW, ...view }, 'stage', warningDays, NOW));

  it('returns everything in view order by default', () => {
    expect(run({})).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
  });

  it('searches record name, process name and current stage', () => {
    expect(run({ query: 'adatum' })).toEqual(['r2']);
    expect(run({ query: 'PROPOSE' })).toEqual(['r2']);
    expect(run({ query: 'sales process' })).toHaveLength(5);
  });

  it('filters by status', () => {
    expect(run({ status: 'active' })).toEqual(['r1', 'r2', 'r3']);
    expect(run({ status: 'finished' })).toEqual(['r4']);
    expect(run({ status: 'aborted' })).toEqual(['r5']);
    expect(run({ status: 'none' })).toEqual(['r6']);
    expect(run({ status: 'overdue' })).toEqual(['r2', 'r3']);
    expect(run({ status: 'overdue' }, null)).toEqual([]);
  });

  it('filters by current stage (active processes only)', () => {
    expect(run({ stage: 'Develop' })).toEqual(['r1', 'r3']);
    expect(run({ stage: 'Qualify' })).toEqual([]); // r5 is aborted
  });

  it('sorts', () => {
    expect(run({ sort: 'name' })).toEqual(['r2', 'r1', 'r3', 'r5', 'r6', 'r4']);
    expect(run({ sort: 'progressDesc' })[0]).toBe('r4');
    expect(run({ sort: 'progressAsc' }).slice(0, 2)).toEqual(['r5', 'r6']);
    expect(run({ sort: 'ageDesc' }).slice(0, 3)).toEqual(['r2', 'r3', 'r1']);
  });

  it('does not mutate the input', () => {
    const copy = [...records];
    run({ sort: 'name' });
    expect(records).toEqual(copy);
  });
});

describe('stage distribution', () => {
  it('counts active records per current stage in stage order', () => {
    expect(getStageDistribution(records, 'stage')).toEqual([
      { label: 'Develop', count: 2 },
      { label: 'Propose', count: 1 },
    ]);
  });

  it('labels the last stage for finished processes', () => {
    expect(getCurrentStageLabel(records[3], 'stage')).toBe('Close');
    expect(getCurrentStageLabel(records[5], 'stage')).toBeNull();
  });
});

const baseSettings: IControlSettings = {
  designStyle: 'modern',
  displayMode: 'stage',
  recordNameSize: 'medium',
  showEntityName: false,
  enableNavigation: true,
  showPulseAnimation: true,
  usePlatformTheme: false,
  enableStageDetails: true,
  showToolbar: true,
  stageAgeWarningDays: 7,
  navigationTarget: 'newWindow',
  density: 'comfortable',
};

describe('BPFViewer toolbar', () => {
  function renderViewer(settings: Partial<IControlSettings> = {}, onRefresh = jest.fn()) {
    render(
      <BPFViewer
        records={records}
        settings={{ ...baseSettings, ...settings }}
        colors={colors}
        isLoading={false}
        error={null}
        onNavigate={jest.fn()}
        onRefresh={onRefresh}
        now={NOW}
      />
    );
    return { onRefresh };
  }

  it('shows summary with overdue count', () => {
    renderViewer();
    expect(screen.getByRole('toolbar')).toHaveTextContent('6 records');
    expect(screen.getByRole('toolbar')).toHaveTextContent('2 overdue');
  });

  it('filters by search text', () => {
    renderViewer();
    fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'fabrikam' } });
    expect(screen.getByText('Fabrikam expansion')).toBeInTheDocument();
    expect(screen.queryByText('Contoso deal')).not.toBeInTheDocument();
    expect(screen.getByRole('toolbar')).toHaveTextContent('1 of 6 records');
  });

  it('filters by stage chip and toggles it off again', () => {
    renderViewer();
    const chips = screen.getByRole('group', { name: 'Records by current stage' });
    fireEvent.click(within(chips).getByRole('button', { name: /Propose: 1 record/ }));
    expect(screen.getByText('Adatum renewal')).toBeInTheDocument();
    expect(screen.queryByText('Contoso deal')).not.toBeInTheDocument();

    fireEvent.click(within(chips).getByRole('button', { name: /Propose: 1 record/ }));
    expect(screen.getByText('Contoso deal')).toBeInTheDocument();
  });

  it('shows an empty state with a clear-filters action', () => {
    renderViewer();
    fireEvent.change(screen.getByLabelText('Search records'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No records match/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Contoso deal')).toBeInTheDocument();
  });

  it('calls refresh', () => {
    const { onRefresh } = renderViewer();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('is hidden when showToolbar is off', () => {
    renderViewer({ showToolbar: false });
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.getByText('Litware')).toBeInTheDocument();
  });
});

describe('BPFRow v1.1', () => {
  function renderRow(record: IRecordBPFData, settings: Partial<IControlSettings> = {}, onNavigate = jest.fn()) {
    const merged = { ...baseSettings, ...settings };
    const utils = render(
      <FluentProvider theme={webLightTheme}>
        {merged.enableNavigation ? (
          <BPFRow record={record} settings={{ ...merged, enableNavigation: true }} colors={colors} isMobile={false} onNavigate={onNavigate} now={NOW} />
        ) : (
          <BPFRow record={record} settings={{ ...merged, enableNavigation: false }} colors={colors} isMobile={false} now={NOW} />
        )}
      </FluentProvider>
    );
    return { ...utils, onNavigate };
  }

  it('shows progress and time-in-stage badge', () => {
    renderRow(records[0]);
    expect(screen.getByLabelText('25% complete')).toBeInTheDocument();
    expect(screen.getByLabelText('3 days in current stage')).toHaveTextContent('3d');
  });

  it('shows Finished / Aborted badges', () => {
    renderRow(records[3]);
    expect(screen.getByText('Finished')).toBeInTheDocument();
  });

  it('shows Aborted badge and no pulse caption age', () => {
    renderRow(records[4]);
    expect(screen.getByText('Aborted')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('with stage details on, the record name (not the row) is the keyboard control', () => {
    const { onNavigate } = renderRow(records[0]);
    expect(screen.queryByRole('button', { name: /with business process flow/ })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Contoso deal' });
    fireEvent.keyDown(link, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('opportunity', 'r1');
  });

  it('with stage details on, the row is still clickable', () => {
    const { onNavigate } = renderRow(records[0]);
    fireEvent.click(screen.getByText('Contoso deal'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('keeps the legacy button row when stage details are off', () => {
    renderRow(records[0], { enableStageDetails: false });
    expect(screen.getByRole('button', { name: /Contoso deal with business process flow/ })).toBeInTheDocument();
  });

  it('has no axe violations with hover cards enabled (no nested interactive)', async () => {
    const { container } = renderRow(records[1]);
    expect(await axe(container)).toHaveNoViolations();
  });
});
