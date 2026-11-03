import {
  getStages,
  findStage,
  getStageFields,
  getFieldsForStage,
  getActiveStageId,
  normGuid,
  walk,
} from '../../utils/processDefinition';
import { SYNTHETIC_PROCESS_DEFINITION, SYNTH_STAGE_ID } from '../setup/fixtures';

describe('process definition (workflow.clientdata)', () => {
  it('finds every stage, nested under entity steps and condition branches', () => {
    const stages = getStages(SYNTHETIC_PROCESS_DEFINITION);
    expect(stages).toHaveLength(7);
    expect(stages.map(s => s.description)).toEqual([
      'Identify', 'Screen', 'Interview', 'Offer', 'Onboard', 'Licensing', 'Close',
    ]);
  });

  it('matches stage ids regardless of braces and case', () => {
    expect(findStage(SYNTHETIC_PROCESS_DEFINITION, SYNTH_STAGE_ID)?.description).toBe('Offer');
    expect(findStage(SYNTHETIC_PROCESS_DEFINITION, `{${SYNTH_STAGE_ID}}`)?.description).toBe('Offer');
    expect(findStage(SYNTHETIC_PROCESS_DEFINITION, SYNTH_STAGE_ID.toUpperCase())?.description).toBe('Offer');
    expect(findStage(SYNTHETIC_PROCESS_DEFINITION, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it("returns the stage's fields in definition order, once each, with required flags", () => {
    const fields = getFieldsForStage(SYNTHETIC_PROCESS_DEFINITION, SYNTH_STAGE_ID)!;
    expect(fields.map(f => f.fieldName)).toEqual([
      'x_offerlettersent',
      'x_transitionassistance',
      'x_approvedtaamount',
      'x_taterm',
      'x_ipounits',
      'x_startdate',
    ]);
    expect(fields[0]).toEqual({
      fieldName: 'x_offerlettersent',
      controlDisplayName: 'Offer Letter Sent',
      displayName: 'Offer Letter Sent',
      isRequired: true,
    });
    // No controlDisplayName: the step's description is the fallback text
    expect(fields[1]).toMatchObject({ controlDisplayName: undefined, displayName: 'Transition assistance', isRequired: false });
    // Bare ControlStep outside a StepStep
    expect(fields[3]).toMatchObject({ fieldName: 'x_taterm', displayName: 'TA Term', isRequired: false });
  });

  it("does not leak a nested stage's fields into its parent", () => {
    const branch = { steps: { list: [{ dataFieldName: 'own' }, { __class: 'StageStep:#X', stageId: 'abc', steps: { list: [{ dataFieldName: 'nested' }] } }] } };
    expect(getStageFields(branch).map(f => f.fieldName)).toEqual(['own']);
  });

  it('lists a repeated field once, keeping it required if any occurrence is', () => {
    const stage = {
      steps: { list: [
        { __class: 'StepStep:#X', description: 'A', isProcessRequired: false, steps: { list: [{ dataFieldName: 'x_a' }] } },
        { __class: 'StepStep:#X', description: 'A again', isProcessRequired: true, steps: { list: [{ dataFieldName: 'X_A' }] } },
      ] },
    };
    expect(getStageFields(stage)).toEqual([{ fieldName: 'x_a', controlDisplayName: undefined, displayName: 'A', isRequired: true }]);
  });

  it('flags steps hidden in the BPF designer', () => {
    const stage = { steps: { list: [
      { __class: 'StepStep:#X', description: 'Shown', steps: { list: [{ dataFieldName: 'x_shown' }] } },
      { __class: 'StepStep:#X', description: 'Hidden', isHidden: true, steps: { list: [{ dataFieldName: 'x_hidden' }] } },
    ] } };
    expect(getStageFields(stage).map(f => [f.fieldName, !!f.isHidden])).toEqual([['x_shown', false], ['x_hidden', true]]);
  });

  it('works for any stage, not only the active one', () => {
    expect(getFieldsForStage(SYNTHETIC_PROCESS_DEFINITION, '77777777-7777-4777-8777-777777777777')!.map(f => f.fieldName)).toEqual(['x_closed']);
  });

  it('tolerates bad input', () => {
    expect(getStages('not json')).toEqual([]);
    expect(getStages('')).toEqual([]);
    expect(getStages(null)).toEqual([]);
    expect(getFieldsForStage('{}', SYNTH_STAGE_ID)).toBeNull();
    expect(getStageFields(null)).toEqual([]);
    expect([...walk({ a: [{ b: 1 }] })]).toHaveLength(2);
  });

  it('takes the active stage from the last traversedpath entry, normalized', () => {
    expect(getActiveStageId('{AAAAAAAA-0000-0000-0000-000000000001},bbbbbbbb-0000-0000-0000-000000000002')).toBe(
      'bbbbbbbb-0000-0000-0000-000000000002'
    );
    expect(getActiveStageId('{CCCCCCCC-0000-0000-0000-000000000003}')).toBe('cccccccc-0000-0000-0000-000000000003');
    expect(getActiveStageId('a,b,')).toBe('b');
    expect(getActiveStageId('')).toBeNull();
    expect(getActiveStageId(null)).toBeNull();
    expect(normGuid(' {ABC} ')).toBe('abc');
  });

  // The real "Integrity Wealth Recruiting" definition is not in the repo yet.
  // Add its clientdata as __tests__/fixtures/integrity-wealth-recruiting.clientdata.json
  // and replace this with: 7 stages, and stage 60de01b4-8291-43a8-86ca-9a833082e319 → its six fields in order.
  it.todo('real Integrity Wealth Recruiting definition: 7 stages; stage 60de01b4-… returns its six fields in order');
});
