/**
 * Stage hover cards (v1.1)
 *
 * Covers: opening on hover/focus for every design, card content (status,
 * time in stage, steps and field completion, process footer), click
 * isolation, and the no-context / disabled fallbacks.
 */

import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { createMockBPFInstance, createMockBPFStage, createMockStageColors } from '../setup/testUtils';
import { StageDetailsContext, IStageDetailsContextValue } from '../../components/stageDetails/StageDetailsContext';
import { ModernDesign } from '../../components/designs/ModernDesign';
import { ChevronDesign } from '../../components/designs/ChevronDesign';
import { CircleDesign } from '../../components/designs/CircleDesign';
import { PillDesign } from '../../components/designs/PillDesign';
import { SegmentedBarDesign } from '../../components/designs/SegmentedBarDesign';
import { StepperDesign } from '../../components/designs/StepperDesign';
import { GradientDesign } from '../../components/designs/GradientDesign';
import { LineDesign } from '../../components/designs/LineDesign';
import { FractionDesign } from '../../components/designs/FractionDesign';
import type { IBPFDesignProps, IFieldValue, IStageStep } from '../../types';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const colors = createMockStageColors();

const stages = [
  createMockBPFStage('s1', 'Qualify', 'Qualify', 0, 0, true, false),
  createMockBPFStage('s2', 'Develop', 'Develop', 1, 1, false, true),
  createMockBPFStage('s3', 'Propose', 'Propose', 2, 2, false, false),
];

const steps: IStageStep[] = [
  { fieldName: 'budgetamount', displayName: 'Est. Budget', isRequired: true },
  { fieldName: 'parentcontactid', displayName: 'Existing Contact?', isRequired: false },
  { fieldName: 'purchasetimeframe', displayName: 'Purchase Timeframe', isRequired: true },
];

const values = new Map<string, IFieldValue>([
  ['budgetamount', { hasValue: true, display: '$5,000.00' }],
  ['parentcontactid', { hasValue: true, display: 'Jane Doe' }],
  ['purchasetimeframe', { hasValue: false, display: null }],
]);

function makeContext(overrides: Partial<IStageDetailsContextValue> = {}): IStageDetailsContextValue {
  return {
    enabled: true,
    instance: {
      ...createMockBPFInstance('p1', 'Opportunity Sales Process', 'opportunitysalesprocess', stages, 's2', 1),
      processStatus: 'active',
      createdOn: '2026-10-01T09:00:00Z',
      modifiedOn: '2026-10-20T15:30:00Z',
      activeStageStartedOn: '2026-10-20T08:00:00Z',
      modifiedByName: 'Jane Doe',
    },
    recordId: '00000000-0000-0000-0000-000000000001',
    recordName: 'Big deal',
    entityName: 'opportunity',
    displayMode: 'stage',
    colors,
    stageAgeWarningDays: 7,
    now: NOW,
    loaders: {
      loadStageSteps: jest.fn().mockResolvedValue(steps),
      loadRecordValues: jest.fn().mockResolvedValue(values),
    },
    ...overrides,
  };
}

const designProps: IBPFDesignProps = { stages, displayMode: 'stage', colors, showPulse: true, isMobile: false };

function renderDesign(
  Design: React.ComponentType<IBPFDesignProps>,
  context: IStageDetailsContextValue | null = makeContext()
) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <StageDetailsContext.Provider value={context}>
        <Design {...designProps} />
      </StageDetailsContext.Provider>
    </FluentProvider>
  );
}

const activeStageElement = () => document.querySelector('[aria-current="step"]') as HTMLElement;
/** The focusable trigger is the active stage element or its nearest wrapper */
const activeTrigger = () => activeStageElement().closest('[data-stage-trigger]') as HTMLElement;

describe('StageHoverCard', () => {
  const designs: Array<[string, React.ComponentType<IBPFDesignProps>]> = [
    ['modern', ModernDesign],
    ['chevron', ChevronDesign],
    ['circles', CircleDesign],
    ['pills', PillDesign],
    ['segmented', SegmentedBarDesign],
    ['stepper', StepperDesign],
    ['gradient', GradientDesign],
    ['line', LineDesign],
  ];

  it.each(designs)('%s: makes every stage focusable and opens the card on focus', async (_name, Design) => {
    renderDesign(Design);

    expect(document.querySelectorAll('[data-stage-trigger]')).toHaveLength(3);

    act(() => {
      activeTrigger().focus();
    });

    const card = await screen.findByTestId('stage-details-card');
    expect(card).toHaveTextContent('Develop');
    expect(card).toHaveTextContent('Stage 2 of 3');
  });

  it('fraction: the single block shows the current stage', async () => {
    renderDesign(FractionDesign);
    const trigger = document.querySelector('[data-stage-trigger]') as HTMLElement;
    act(() => trigger.focus());
    expect(await screen.findByTestId('stage-details-card')).toHaveTextContent('Develop');
  });

  it('opens on hover only after a short delay', async () => {
    jest.useFakeTimers();
    try {
      renderDesign(ModernDesign);
      fireEvent.mouseEnter(activeTrigger());
      expect(screen.queryByTestId('stage-details-card')).not.toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(screen.getByTestId('stage-details-card')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('closes when the stage loses focus', async () => {
    renderDesign(ModernDesign);
    act(() => activeTrigger().focus());
    await screen.findByTestId('stage-details-card');
    act(() => activeTrigger().blur());
    await waitFor(() => expect(screen.queryByTestId('stage-details-card')).not.toBeInTheDocument());
  });

  it('removes the native title tooltip when cards are enabled', () => {
    renderDesign(ChevronDesign);
    expect(activeTrigger()).not.toHaveAttribute('title');
  });

  it('renders the design untouched without a context', () => {
    renderDesign(ChevronDesign, null);
    expect(document.querySelectorAll('[data-stage-trigger]')).toHaveLength(0);
    expect(activeStageElement()).toHaveAttribute('title');
  });

  it('renders the design untouched when disabled', () => {
    renderDesign(PillDesign, makeContext({ enabled: false }));
    expect(document.querySelectorAll('[data-stage-trigger]')).toHaveLength(0);
  });

  it('does not let clicks inside the card bubble to the row', async () => {
    const onRowClick = jest.fn();
    render(
      <FluentProvider theme={webLightTheme}>
        <div onClick={onRowClick}>
          <StageDetailsContext.Provider value={makeContext()}>
            <ModernDesign {...designProps} />
          </StageDetailsContext.Provider>
        </div>
      </FluentProvider>
    );
    act(() => activeTrigger().focus());
    fireEvent.click(await screen.findByTestId('stage-details-card'));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('StageDetailsCard content', () => {
  async function openActive(context = makeContext()) {
    renderDesign(ModernDesign, context);
    act(() => activeTrigger().focus());
    return screen.findByTestId('stage-details-card');
  }

  it('shows time in stage with overdue warning', async () => {
    const card = await openActive();
    expect(card).toHaveTextContent('In this stage for 12 days');
    expect(card).toHaveTextContent('(overdue)');
  });

  it('lists steps with completion, values and missing required fields', async () => {
    const context = makeContext();
    const card = await openActive(context);

    await waitFor(() => expect(card).toHaveTextContent('2/3 filled'));
    expect(card).toHaveTextContent('Est. Budget');
    expect(card).toHaveTextContent('$5,000.00');
    expect(card).toHaveTextContent('Jane Doe');
    expect(card).toHaveTextContent('Required to move on: Purchase Timeframe');
    expect(context.loaders!.loadRecordValues).toHaveBeenCalledWith('opportunity', '00000000-0000-0000-0000-000000000001');
  });

  it('shows the process footer', async () => {
    const card = await openActive();
    expect(card).toHaveTextContent('Opportunity Sales Process · Active');
    expect(card).toHaveTextContent(/Started/);
    expect(card).toHaveTextContent(/Last updated .* by Jane Doe/);
  });

  it('does not load values for stages on another entity (cross-entity BPF)', async () => {
    const context = makeContext();
    context.instance = {
      ...context.instance,
      stages: context.instance.stages.map(s => (s.stageId === 's2' ? { ...s, entityName: 'quote' } : s)),
    };
    render(
      <FluentProvider theme={webLightTheme}>
        <StageDetailsContext.Provider value={context}>
          <ModernDesign {...designProps} stages={context.instance.stages} />
        </StageDetailsContext.Provider>
      </FluentProvider>
    );
    act(() => activeTrigger().focus());
    const card = await screen.findByTestId('stage-details-card');
    await waitFor(() => expect(card).toHaveTextContent('Est. Budget'));
    expect(context.loaders!.loadRecordValues).not.toHaveBeenCalled();
    expect(card).not.toHaveTextContent('filled');
  });

  it('shows "Not started yet" for upcoming stages', async () => {
    renderDesign(ModernDesign);
    const upcoming = screen.getByLabelText(/Stage 3 of 3: Propose/).closest('[data-stage-trigger]') as HTMLElement;
    act(() => upcoming.focus());
    expect(await screen.findByTestId('stage-details-card')).toHaveTextContent('Not started yet');
  });

  it('flags the stage where an aborted process stopped', async () => {
    const context = makeContext();
    context.instance = { ...context.instance, statusCode: 3, processStatus: 'aborted' };
    const card = await openActive(context);
    expect(card).toHaveTextContent('Stopped here');
    expect(card).toHaveTextContent('Aborted');
    expect(card).not.toHaveTextContent('In this stage for');
  });

  it('works without loaders (no steps section)', async () => {
    const card = await openActive(makeContext({ loaders: undefined }));
    expect(card).not.toHaveTextContent('Steps');
    expect(card).toHaveTextContent('Develop');
  });
});

describe('ModernDesign captions', () => {
  it('shows Done / Current · age / Step N', () => {
    renderDesign(ModernDesign);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Current · 12d')).toBeInTheDocument();
    expect(screen.getByText('Step 3')).toBeInTheDocument();
  });

  it('hides captions on mobile', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <ModernDesign {...designProps} isMobile />
      </FluentProvider>
    );
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    expect(screen.getByText('Develop')).toBeInTheDocument();
  });

  it('exposes progress to assistive tech', () => {
    renderDesign(ModernDesign);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
    expect(bar.getAttribute('aria-label')).toContain('Current stage: Develop');
  });
});
