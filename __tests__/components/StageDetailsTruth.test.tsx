/**
 * Stage hover card: data truth + keyboard/screen-reader access
 *
 * Data truth: the card never claims a field is empty when it can't know
 * (field security, failed loads, another table's record), and frames
 * completed / stopped stages correctly.
 * Access: one tab stop per row, arrow keys, Enter, Escape (incl. hover-opened),
 * spoken summary via aria-describedby, no nested-interactive axe violations.
 */

import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { createMockBPFInstance, createMockBPFStage, createMockStageColors } from '../setup/testUtils';
import { StageDetailsContext, IStageDetailsContextValue } from '../../components/stageDetails/StageDetailsContext';
import { ModernDesign } from '../../components/designs/ModernDesign';
import { ChevronDesign } from '../../components/designs/ChevronDesign';
import { buildRows, describeFields, listNames } from '../../components/stageDetails/useStageModel';
import { parseStageSteps, collectRelatedRecordIds, findRelatedRecordId } from '../../utils/stageDetails';
import { readAttributeInfo } from '../../utils/fieldMetadata';
import type { IBPFDesignProps, IBPFStage, IFieldInfo, IFieldValue, IStageStep } from '../../types';

expect.extend(toHaveNoViolations);

const NOW = Date.parse('2026-11-01T12:00:00Z');
const colors = createMockStageColors();
const RECORD = '00000000-0000-0000-0000-000000000001';
const LEAD = '00000000-0000-0000-0000-0000000000aa';

const steps: IStageStep[] = [
  { fieldName: 'budgetamount', displayName: 'Est. Budget', isRequired: true },
  { fieldName: 'parentcontactid', displayName: 'Existing Contact?', isRequired: false },
  { fieldName: 'purchasetimeframe', displayName: 'Purchase Timeframe', isRequired: true },
];
const values = () =>
  new Map<string, IFieldValue>([
    ['budgetamount', { hasValue: true, display: '$5,000.00' }],
    ['parentcontactid', { hasValue: true, display: 'Jane Doe' }],
    ['purchasetimeframe', { hasValue: false, display: null }],
  ]);

/** stages: Qualify (completed), Develop (current), Propose (upcoming) */
function makeStages(activeIdx: number | null): IBPFStage[] {
  return ['Qualify', 'Develop', 'Propose'].map((n, i) =>
    createMockBPFStage(`s${i + 1}`, n, n, i, i, activeIdx === null ? true : i < activeIdx, i === activeIdx)
  );
}

function makeContext(overrides: Partial<IStageDetailsContextValue> = {}, statusCode = 1, activeIdx: number | null = 1): IStageDetailsContextValue {
  const stages = makeStages(activeIdx);
  return {
    enabled: true,
    instance: {
      ...createMockBPFInstance('p1', 'Opportunity Sales Process', 'opportunitysalesprocess', stages, activeIdx === null ? null : `s${activeIdx + 1}`, statusCode),
      processStatus: statusCode === 1 ? 'active' : statusCode === 2 ? 'finished' : 'aborted',
      activeStageStartedOn: '2026-10-28T08:00:00Z',
    },
    recordId: RECORD,
    recordName: 'Big deal',
    entityName: 'opportunity',
    displayMode: 'stage',
    colors,
    stageAgeWarningDays: 7,
    now: NOW,
    loaders: {
      loadStageSteps: jest.fn().mockResolvedValue(steps),
      loadRecordValues: jest.fn().mockImplementation(async () => values()),
      loadFieldInfo: jest.fn().mockResolvedValue(new Map()),
    },
    ...overrides,
  };
}

function renderWith(context: IStageDetailsContextValue, Design: React.ComponentType<IBPFDesignProps> = ModernDesign) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <StageDetailsContext.Provider value={context}>
        <Design stages={context.instance.stages} displayMode="stage" colors={colors} showPulse isMobile={false} />
      </StageDetailsContext.Provider>
    </FluentProvider>
  );
}

const triggers = () => Array.from(document.querySelectorAll<HTMLElement>('[data-stage-trigger]'));

async function openStage(i: number) {
  act(() => triggers()[i].focus());
  const card = await screen.findByTestId('stage-details-card');
  await waitFor(() => expect(card).not.toHaveTextContent('Loading steps'));
  return card;
}

describe('data truth', () => {
  it('current stage names the required fields that block moving on', async () => {
    renderWith(makeContext());
    const card = await openStage(1);
    expect(card).toHaveTextContent('2/3 filled');
    expect(card).toHaveTextContent('Required to move on: Purchase Timeframe');
  });

  it('completed stage lists values without a fill bar and flags required fields empty now', async () => {
    renderWith(makeContext());
    const card = await openStage(0);
    expect(card).toHaveTextContent('$5,000.00');
    expect(card).not.toHaveTextContent('filled');
    expect(card).not.toHaveTextContent('Required to move on');
    expect(card).toHaveTextContent('1 required field is empty on the record now (Purchase Timeframe)');
    expect(screen.queryByRole('progressbar', { name: /fields filled/ })).not.toBeInTheDocument();
  });

  it('aborted process: no "move on" instruction, says it stopped here', async () => {
    renderWith(makeContext({}, 3));
    const card = await openStage(1);
    expect(card).toHaveTextContent('The process was stopped at this stage.');
    expect(card).not.toHaveTextContent('Required to move on');
    expect(card).not.toHaveTextContent('filled');
  });

  it('a secured field without a value shows "No access", not empty, and does not block', async () => {
    const context = makeContext();
    (context.loaders!.loadFieldInfo as jest.Mock).mockResolvedValue(
      new Map<string, IFieldInfo>([['purchasetimeframe', { isSecured: true }]])
    );
    renderWith(context);
    const card = await openStage(1);
    expect(card).toHaveTextContent('No access');
    expect(card).toHaveTextContent('2/2 filled');
    expect(card).not.toHaveTextContent('Required to move on');
  });

  it('uses the localized display name when the BPF step has no label of its own', async () => {
    const context = makeContext();
    (context.loaders!.loadStageSteps as jest.Mock).mockResolvedValue([
      { fieldName: 'budgetamount', displayName: 'budgetamount', isRequired: true },
    ]);
    (context.loaders!.loadFieldInfo as jest.Mock).mockResolvedValue(
      new Map<string, IFieldInfo>([['budgetamount', { displayName: 'Budget Amount' }]])
    );
    renderWith(context);
    const card = await openStage(1);
    expect(card).toHaveTextContent('Budget Amount');
    expect(context.loaders!.loadFieldInfo).toHaveBeenCalledWith('opportunity', ['budgetamount']);
  });

  it("loads a stage on another table from the BPF's own lookup (e.g. the lead)", async () => {
    const context = makeContext();
    context.instance = {
      ...context.instance,
      relatedRecordIds: { leadid: LEAD, opportunityid: RECORD },
      stages: context.instance.stages.map(s => (s.stageId === 's1' ? { ...s, entityName: 'lead' } : s)),
    };
    renderWith(context);
    const card = await openStage(0);
    expect(context.loaders!.loadRecordValues).toHaveBeenCalledWith('lead', LEAD);
    expect(card).toHaveTextContent('Values from the related Lead record');
    expect(card).toHaveTextContent('$5,000.00');
  });

  it('a stage on another table with no linked record lists fields without claiming they are empty', async () => {
    const context = makeContext();
    context.instance = {
      ...context.instance,
      stages: context.instance.stages.map(s => (s.stageId === 's3' ? { ...s, entityName: 'quote' } : s)),
    };
    renderWith(context);
    const card = await openStage(2);
    expect(card).toHaveTextContent('This stage runs on Quote; no Quote record is linked to this process yet.');
    expect(card).toHaveTextContent('Est. Budget');
    expect(card).not.toHaveTextContent('Empty');
    expect(context.loaders!.loadRecordValues).not.toHaveBeenCalled();
  });

  it('a failed value load says so instead of showing every field as empty', async () => {
    const context = makeContext();
    (context.loaders!.loadRecordValues as jest.Mock).mockRejectedValue(new Error('403'));
    renderWith(context);
    const card = await openStage(1);
    expect(card).toHaveTextContent("Couldn't load the field values");
    expect(card).not.toHaveTextContent('Empty');
    expect(card).not.toHaveTextContent('Required to move on');
  });

  it('a failed step load says so instead of hiding the section', async () => {
    const context = makeContext();
    (context.loaders!.loadStageSteps as jest.Mock).mockRejectedValue(new Error('500'));
    renderWith(context);
    const card = await openStage(1);
    expect(card).toHaveTextContent("Couldn't load this stage's fields");
  });

  it('marks fields with no value under "Empty" and uses a word, not a glyph, for set values without text', () => {
    const rows = buildRows(steps, new Map([['budgetamount', { hasValue: true, display: null }]]), new Map());
    expect(rows[0]).toMatchObject({ state: 'filled', display: null });
    // parentcontactid was not returned at all -> unknown, not empty
    expect(rows[1].state).toBe('unknown');
  });
});

describe('model helpers', () => {
  it('lists names compactly', () => {
    const rows = buildRows(steps, values(), new Map());
    expect(listNames(rows.slice(0, 1))).toBe('Est. Budget');
    expect(listNames(rows.slice(0, 2))).toBe('Est. Budget and Existing Contact?');
    expect(listNames(rows)).toBe('Est. Budget, Existing Contact? and 1 more');
  });

  it('describes fields for screen readers by framing', () => {
    const rows = buildRows(steps, values(), new Map());
    const base = {
      loading: false, stepsFailed: false, rows, valuesSource: 'record' as const, otherTable: null,
      countable: 3, filled: 2, requiredEmpty: [rows[2]],
    };
    expect(describeFields({ ...base, framing: 'current' })).toBe('2 of 3 fields filled. Required to move on: Purchase Timeframe.');
    expect(describeFields({ ...base, framing: 'completed' })).toBe('2 of 3 fields filled. 1 required field is empty on the record now.');
    expect(describeFields({ ...base, framing: 'stopped' })).toBe('2 of 3 fields filled. The process was stopped at this stage.');
    expect(describeFields({ ...base, framing: 'current', valuesSource: 'error' })).toBe("3 fields. Couldn't load their values.");
  });

  it('skips steps hidden in the BPF designer', () => {
    const data = JSON.stringify({
      list: [
        { __class: 'StepStep:#X', description: 'Shown', steps: { list: [{ dataFieldName: 'a' }] } },
        { __class: 'StepStep:#X', description: 'Hidden', isHidden: true, steps: { list: [{ dataFieldName: 'b' }] } },
        { __class: 'StepStep:#X', description: 'Hidden control', steps: { list: [{ dataFieldName: 'c', isHidden: true }] } },
      ],
    });
    expect(parseStageSteps(data).map(s => s.fieldName)).toEqual(['a']);
  });

  it('collects record lookups from a BPF instance row and resolves stage tables', () => {
    const related = collectRelatedRecordIds({
      _leadid_value: LEAD,
      _opportunityid_value: RECORD,
      _bpf_quoteid_value: '00000000-0000-0000-0000-0000000000bb',
      _activestageid_value: '00000000-0000-0000-0000-0000000000cc',
      _ownerid_value: '00000000-0000-0000-0000-0000000000dd',
      _processid_value: '00000000-0000-0000-0000-0000000000ee',
      '_leadid_value@OData.Community.Display.V1.FormattedValue': 'Lead name',
      _emptyid_value: null,
    });
    expect(related).toEqual({
      leadid: LEAD,
      opportunityid: RECORD,
      bpf_quoteid: '00000000-0000-0000-0000-0000000000bb',
    });
    expect(findRelatedRecordId(related, 'lead')).toBe(LEAD);
    expect(findRelatedRecordId(related, 'quote')).toBe('00000000-0000-0000-0000-0000000000bb');
    expect(findRelatedRecordId(related, 'invoice')).toBeNull();
    expect(findRelatedRecordId(undefined, 'lead')).toBeNull();
  });

  it('reads attribute metadata in the shapes PCF hosts return', () => {
    expect(readAttributeInfo({ Attributes: { get: (n: string) => (n === 'x' ? { DisplayName: 'X Label', IsSecured: true } : undefined) } }, 'x'))
      .toEqual({ displayName: 'X Label', isSecured: true });
    expect(readAttributeInfo({ Attributes: { _collection: { x: { attributeDescriptor: { DisplayName: 'From descriptor', IsSecured: false } } } } }, 'x'))
      .toEqual({ displayName: 'From descriptor', isSecured: false });
    expect(readAttributeInfo({ Attributes: [{ LogicalName: 'x', DisplayName: { UserLocalizedLabel: { Label: 'Localized' } } }] }, 'x'))
      .toEqual({ displayName: 'Localized', isSecured: false });
    expect(readAttributeInfo({}, 'x')).toBeNull();
    expect(readAttributeInfo({ Attributes: { get: () => undefined } }, 'x')).toBeNull();
  });
});

describe('keyboard and screen reader access', () => {
  it('is one tab stop per row: the current stage', () => {
    renderWith(makeContext());
    expect(triggers().map(t => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('uses the last stage as the tab stop when no stage is current (finished)', () => {
    renderWith(makeContext({}, 2, null));
    expect(triggers().map(t => t.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('arrow keys, Home and End move between stages', () => {
    renderWith(makeContext());
    const t = triggers();
    act(() => t[1].focus());
    fireEvent.keyDown(t[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(t[2]);
    fireEvent.keyDown(t[2], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(t[2]);
    fireEvent.keyDown(t[2], { key: 'Home' });
    expect(document.activeElement).toBe(t[0]);
    fireEvent.keyDown(t[0], { key: 'End' });
    expect(document.activeElement).toBe(t[2]);
    fireEvent.keyDown(t[2], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(t[1]);
  });

  it('stages are labelled buttons described by a spoken summary of the card', async () => {
    renderWith(makeContext());
    const current = screen.getByRole('button', { name: /Stage 2 of 3: Develop, current, 4 days in stage/ });
    act(() => current.focus());
    await waitFor(() =>
      expect(current).toHaveAccessibleDescription('2 of 3 fields filled. Required to move on: Purchase Timeframe.')
    );
  });

  it('Enter toggles the card without bubbling to the row', async () => {
    const onRowKey = jest.fn();
    render(
      <FluentProvider theme={webLightTheme}>
        <div onKeyDown={onRowKey}>
          <StageDetailsContext.Provider value={makeContext()}>
            <ModernDesign stages={makeStages(1)} displayMode="stage" colors={colors} showPulse isMobile={false} />
          </StageDetailsContext.Provider>
        </div>
      </FluentProvider>
    );
    const t = triggers()[1];
    act(() => t.focus());
    await screen.findByTestId('stage-details-card');
    fireEvent.keyDown(t, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByTestId('stage-details-card')).not.toBeInTheDocument());
    fireEvent.keyDown(t, { key: 'Enter' });
    expect(await screen.findByTestId('stage-details-card')).toBeInTheDocument();
    expect(onRowKey).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }));
  });

  it('Escape closes a card opened by hovering, with focus elsewhere (WCAG 1.4.13)', async () => {
    jest.useFakeTimers();
    try {
      renderWith(makeContext());
      fireEvent.mouseEnter(triggers()[1]);
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(screen.getByTestId('stage-details-card')).toBeInTheDocument();
      expect(document.activeElement).toBe(document.body);

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByTestId('stage-details-card')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['modern', ModernDesign],
    ['chevron', ChevronDesign],
  ])('%s: stage buttons are not hidden inside a progressbar; progress is still announced', async (_n, Design) => {
    const { container } = renderWith(makeContext(), Design);
    expect(screen.getByRole('group', { name: 'Business process flow stages' })).toBeInTheDocument();
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress.querySelector('[data-stage-trigger]')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
