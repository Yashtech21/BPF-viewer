import {
  parseStageSteps,
  getProcessStatus,
  getProgressPercent,
  getActiveStagePosition,
  getDaysInActiveStage,
  getAgeSeverity,
  formatDays,
  formatDaysShort,
  formatDate,
  daysBetween,
  toFieldValueMap,
  formatRawValue,
  isEmptyValue,
} from '../../utils/stageDetails';
import { createMockBPFInstance, createMockBPFStage } from '../setup/testUtils';
import { SAMPLE_CLIENT_DATA } from '../setup/fixtures';


describe('parseStageSteps', () => {
  it('extracts steps with field names, labels and required flags', () => {
    expect(parseStageSteps(SAMPLE_CLIENT_DATA)).toEqual([
      { fieldName: 'parentcontactid', displayName: 'Existing Contact?', controlDisplayName: 'Existing Contact?', isRequired: false },
      { fieldName: 'budgetamount', displayName: 'Est. Budget', controlDisplayName: undefined, isRequired: true },
      { fieldName: 'purchasetimeframe', displayName: 'Purchase Timeframe', controlDisplayName: undefined, isRequired: true },
    ]);
  });

  it('handles bare ControlSteps outside a StepStep', () => {
    const data = JSON.stringify({
      steps: { list: [{ __class: 'ControlStep:#X', dataFieldName: 'name', controlDisplayName: 'Topic', isRequired: true }] },
    });
    expect(parseStageSteps(data)).toEqual([{ fieldName: 'name', displayName: 'Topic', controlDisplayName: 'Topic', isRequired: true }]);
  });

  it('de-duplicates repeated steps', () => {
    const step = { __class: 'StepStep:#X', description: 'A', steps: { list: [{ dataFieldName: 'a' }] } };
    expect(parseStageSteps(JSON.stringify({ list: [step, step] }))).toHaveLength(1);
  });

  it.each([null, undefined, '', 'not json', '42', '{"foo":1}'])('returns [] for %p', (input) => {
    expect(parseStageSteps(input as string | null | undefined)).toEqual([]);
  });
});

describe('process status & progress', () => {
  it('maps status codes', () => {
    expect(getProcessStatus(1)).toBe('active');
    expect(getProcessStatus(2)).toBe('finished');
    expect(getProcessStatus(3)).toBe('aborted');
    expect(getProcessStatus(undefined)).toBe('unknown');
  });

  const stages = [
    createMockBPFStage('s1', 'A', 'A', 0, 0, true, false),
    createMockBPFStage('s2', 'B', 'B', 1, 1, false, true),
    createMockBPFStage('s3', 'C', 'C', 2, 2, false, false),
    createMockBPFStage('s4', 'D', 'D', 3, 3, false, false),
  ];

  it('computes progress percent', () => {
    expect(getProgressPercent(createMockBPFInstance('p', 'P', 'e', stages, 's2'))).toBe(25);
    expect(getProgressPercent(null)).toBe(0);
    expect(getProgressPercent(createMockBPFInstance('p', 'P', 'e', [], null))).toBe(0);
  });

  it('computes active stage position', () => {
    expect(getActiveStagePosition(createMockBPFInstance('p', 'P', 'e', stages, 's2'))).toEqual({ index: 2, total: 4 });
    const none = stages.map(s => ({ ...s, isActive: false }));
    expect(getActiveStagePosition(createMockBPFInstance('p', 'P', 'e', none, null))).toEqual({ index: 4, total: 4 });
  });
});

describe('time in stage', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  const base = createMockBPFInstance('p', 'P', 'e', [], null, 1);

  it('counts whole days since the active stage started', () => {
    expect(getDaysInActiveStage({ ...base, activeStageStartedOn: '2026-10-20T08:00:00Z' }, now)).toBe(12);
    expect(getDaysInActiveStage({ ...base, activeStageStartedOn: '2026-11-01T11:00:00Z' }, now)).toBe(0);
  });

  it('returns null when not active or unknown', () => {
    expect(getDaysInActiveStage(null, now)).toBeNull();
    expect(getDaysInActiveStage(base, now)).toBeNull();
    expect(getDaysInActiveStage({ ...base, statusCode: 2, activeStageStartedOn: '2026-10-01T00:00:00Z' }, now)).toBeNull();
    expect(getDaysInActiveStage({ ...base, activeStageStartedOn: 'garbage' }, now)).toBeNull();
  });

  it('never returns negative days for future dates (clock skew)', () => {
    expect(getDaysInActiveStage({ ...base, activeStageStartedOn: '2026-11-03T00:00:00Z' }, now)).toBe(0);
  });

  it('grades severity against the threshold', () => {
    expect(getAgeSeverity(null, 7)).toBe('none');
    expect(getAgeSeverity(10, null)).toBe('none');
    expect(getAgeSeverity(10, 0)).toBe('none');
    expect(getAgeSeverity(6, 7)).toBe('ok');
    expect(getAgeSeverity(7, 7)).toBe('warning');
    expect(getAgeSeverity(14, 7)).toBe('danger');
  });

  it('formats durations', () => {
    expect(formatDays(0)).toBe('Today');
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(12)).toBe('12 days');
    expect(formatDays(90)).toBe('3 mo');
    expect(formatDays(548)).toBe('1.5 yr');
    expect(formatDaysShort(5)).toBe('5d');
    expect(formatDaysShort(90)).toBe('3mo');
    expect(formatDaysShort(800)).toBe('2y');
  });

  it('formats dates and day spans', () => {
    expect(formatDate('2026-10-03T10:00:00Z', false, 'en-US')).toBe('Oct 3, 2026');
    expect(formatDate(null)).toBe('');
    expect(formatDate('nope')).toBe('');
    expect(daysBetween('2026-10-01T00:00:00Z', '2026-10-11T00:00:00Z')).toBe(10);
    expect(daysBetween(null, '2026-10-11T00:00:00Z')).toBeNull();
  });
});

describe('toFieldValueMap', () => {
  it('maps attributes, lookups and formatted values', () => {
    const map = toFieldValueMap({
      name: 'Big deal',
      budgetamount: 5000,
      'budgetamount@OData.Community.Display.V1.FormattedValue': '$5,000.00',
      _parentcontactid_value: '00000000-0000-0000-0000-000000000009',
      '_parentcontactid_value@OData.Community.Display.V1.FormattedValue': 'Jane Doe',
      _owninguser_value: '00000000-0000-0000-0000-000000000010',
      purchasetimeframe: null,
      isrevenuesystemcalculated: false,
      description: '',
    });

    expect(map.get('name')).toEqual({ hasValue: true, display: 'Big deal' });
    expect(map.get('budgetamount')).toEqual({ hasValue: true, display: '$5,000.00' });
    expect(map.get('parentcontactid')).toEqual({ hasValue: true, display: 'Jane Doe' });
    // Lookup without a formatted value never shows a raw GUID
    expect(map.get('owninguser')).toEqual({ hasValue: true, display: null });
    expect(map.get('purchasetimeframe')).toEqual({ hasValue: false, display: null });
    expect(map.get('isrevenuesystemcalculated')).toEqual({ hasValue: true, display: 'No' });
    expect(map.get('description')).toEqual({ hasValue: false, display: null });
  });

  it('returns an empty map for null input', () => {
    expect(toFieldValueMap(null).size).toBe(0);
  });
});

describe('field value formatting', () => {
  it('treats null, undefined, empty string and [] as empty', () => {
    expect([null, undefined, '', []].every(isEmptyValue)).toBe(true);
    expect([0, false, 'x', [1]].some(isEmptyValue)).toBe(false);
  });

  it('formats raw values by type when no formatted value exists', () => {
    expect(formatRawValue(true)).toBe('Yes');
    expect(formatRawValue(false, 'Boolean')).toBe('No');
    expect(formatRawValue(1500, 'Money', 'en-US')).toBe('1,500.00');
    expect(formatRawValue(1500, 'Integer', 'en-US')).toBe('1,500');
    expect(formatRawValue('2026-10-03', 'DateTime', 'en-US')).toBe('Oct 3, 2026');
    expect(formatRawValue('Hello')).toBe('Hello');
    expect(formatRawValue({ name: 'Jane Doe' })).toBe('Jane Doe');
    expect(formatRawValue([{ name: 'A' }, { name: 'B' }])).toBe('A, B');
    expect(formatRawValue(null)).toBe('');
  });
});
