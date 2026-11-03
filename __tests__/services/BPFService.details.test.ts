/**
 * BPFService — stage details features (v1.1)
 *  - instance enrichment (dates, process status, modified by)
 *  - steps parsed from clientdata / lazily fetched
 *  - record values for step completion
 */

import { BPFService, isBadColumnError } from '../../services/BPFService';
import { createMockWebAPI } from '../setup/testUtils';
import { SAMPLE_CLIENT_DATA, SYNTHETIC_PROCESS_DEFINITION, SYNTH_STAGE_ID } from '../setup/fixtures';
import type { IBPFConfiguration, IBPFStage } from '../../types';

const RECORD_ID = '00000000-0000-0000-0000-000000000001';
const INSTANCE_ID = '10000000-0000-0000-0000-000000000001';
const STAGE_ID = '20000000-0000-0000-0000-000000000001';

const config: IBPFConfiguration = {
  bpfs: [{ bpfEntitySchemaName: 'opportunitysalesprocess', lookupFieldSchemaName: '_opportunityid_value' }],
};

function stage(overrides: Partial<IBPFStage> = {}): IBPFStage {
  return {
    stageId: STAGE_ID,
    stageName: 'Qualify',
    stageCategory: 0,
    stageCategoryName: 'Qualify',
    stageOrder: 0,
    isActive: true,
    isCompleted: false,
    ...overrides,
  };
}

describe('BPFService stage details', () => {
  let webApi: ReturnType<typeof createMockWebAPI>;
  let service: BPFService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    webApi = createMockWebAPI();
    webApi.retrieveRecord = jest.fn().mockImplementation((entity: string) => {
      if (entity.includes('stagecategory')) {
        return Promise.resolve({ OptionSet: { Options: [{ Value: 0, Label: { UserLocalizedLabel: { Label: 'Qualify' } } }] } });
      }
      return Promise.resolve({});
    });
    service = new BPFService(webApi as unknown as ComponentFramework.WebApi, 'https://org.crm.dynamics.com');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    service.clearCache();
  });

  describe('instance enrichment', () => {
    function mockInstance(extra: Record<string, unknown>) {
      webApi.retrieveMultipleRecords.mockResolvedValue({
        entities: [
          {
            businessprocessflowinstanceid: INSTANCE_ID,
            name: 'Opportunity Sales Process',
            _opportunityid_value: RECORD_ID,
            _activestageid_value: STAGE_ID,
            traversedpath: STAGE_ID,
            ...extra,
          },
        ],
      });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            value: [
              {
                processstageid: STAGE_ID,
                stagename: 'Qualify',
                stagecategory: 0,
                primaryentitytypecode: 'opportunity',
                clientdata: SAMPLE_CLIENT_DATA,
              },
            ],
          }),
      }) as unknown as typeof fetch;
    }

    it('exposes dates, status and modified-by name', async () => {
      mockInstance({
        statuscode: 1,
        createdon: '2026-10-01T09:00:00Z',
        modifiedon: '2026-10-20T15:30:00Z',
        activestagestartedon: '2026-10-15T08:00:00Z',
        '_modifiedby_value@OData.Community.Display.V1.FormattedValue': 'Jane Doe',
      });

      const instance = (await service.getBPFDataForRecords([RECORD_ID], config)).get(RECORD_ID)!;

      expect(instance.processStatus).toBe('active');
      expect(instance.createdOn).toBe('2026-10-01T09:00:00Z');
      expect(instance.modifiedOn).toBe('2026-10-20T15:30:00Z');
      expect(instance.activeStageStartedOn).toBe('2026-10-15T08:00:00Z');
      expect(instance.completedOn).toBeNull();
      expect(instance.modifiedByName).toBe('Jane Doe');
    });

    it('keeps RetrieveActivePath clientdata unparsed until the card falls back to it', async () => {
      mockInstance({ statuscode: 1 });
      const instance = (await service.getBPFDataForRecords([RECORD_ID], config)).get(RECORD_ID)!;

      expect(instance.stages[0].entityName).toBe('opportunity');
      expect(instance.stages[0].steps).toBeUndefined(); // not parsed on load
      expect(instance.stages[0].clientData).toBe(SAMPLE_CLIENT_DATA);

      // Fallback path (no process definition available) parses it, without a request
      (webApi.retrieveRecord as jest.Mock).mockClear();
      const steps = await service.getStageSteps(instance.stages[0]);
      expect(steps[1]).toMatchObject({ fieldName: 'budgetamount', displayName: 'Est. Budget', isRequired: true });
      expect(webApi.retrieveRecord).not.toHaveBeenCalledWith('processstage', expect.anything(), expect.anything());
    });

    it('marks aborted processes', async () => {
      mockInstance({ statuscode: 3 });
      const instance = (await service.getBPFDataForRecords([RECORD_ID], config)).get(RECORD_ID)!;
      expect(instance.processStatus).toBe('aborted');
    });
  });

  describe('getBPFDataForRecord throwOnError', () => {
    it('keeps the lenient default: errors resolve to null', async () => {
      webApi.retrieveMultipleRecords.mockRejectedValue(new Error('API Error'));
      await expect(service.getBPFDataForRecord(RECORD_ID, 'opportunity', config)).resolves.toBeNull();
    });

    it('rethrows when every BPF definition failed', async () => {
      webApi.retrieveMultipleRecords.mockRejectedValue(new Error('API Error'));
      await expect(
        service.getBPFDataForRecord(RECORD_ID, 'opportunity', config, { throwOnError: true })
      ).rejects.toThrow('API Error');
    });

    it('returns null (no throw) when one definition succeeded without a match', async () => {
      const twoBpfs: IBPFConfiguration = {
        bpfs: [
          { bpfEntitySchemaName: 'opportunitysalesprocess', lookupFieldSchemaName: '_opportunityid_value' },
          { bpfEntitySchemaName: 'leadtoopportunitysalesprocess', lookupFieldSchemaName: '_opportunityid_value' },
        ],
      };
      webApi.retrieveMultipleRecords
        .mockRejectedValueOnce(new Error('No privilege'))
        .mockResolvedValueOnce({ entities: [] });
      await expect(
        service.getBPFDataForRecord(RECORD_ID, 'opportunity', twoBpfs, { throwOnError: true })
      ).resolves.toBeNull();
    });
  });

  describe('stage category labels (performance guards)', () => {
    const instanceRow = {
      businessprocessflowinstanceid: INSTANCE_ID,
      name: 'Opportunity Sales Process',
      _opportunityid_value: RECORD_ID,
      _activestageid_value: STAGE_ID,
      traversedpath: '',
      statuscode: 1,
    };

    function mockActivePath() {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ value: [{ processstageid: STAGE_ID, stagename: 'Qualify', stagecategory: 0 }] }),
      }) as unknown as typeof fetch;
    }

    const labelCalls = () =>
      (webApi.retrieveRecord as jest.Mock).mock.calls.filter(c => String(c[0]).includes('stagecategory')).length;

    it('gives up on a hanging label lookup after 5s instead of 30s', async () => {
      jest.useFakeTimers();
      try {
        webApi.retrieveRecord = jest.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
        webApi.retrieveMultipleRecords.mockResolvedValue({ entities: [instanceRow] });
        mockActivePath();

        let done = false;
        const result = service.getBPFDataForRecord(RECORD_ID, 'opportunity', config, { throwOnError: true })
          .then(r => { done = true; return r; });

        await jest.advanceTimersByTimeAsync(4900);
        expect(done).toBe(false);
        await jest.advanceTimersByTimeAsync(200);
        expect(done).toBe(true);

        // Falls back to the stage name as category label
        const instance = await result;
        expect(instance?.stages[0].stageCategoryName).toBe('Qualify');
      } finally {
        jest.useRealTimers();
      }
    });

    it('shares one in-flight label request across concurrent records', async () => {
      const second = '00000000-0000-0000-0000-000000000002';
      webApi.retrieveMultipleRecords.mockImplementation((_e: string, q: string) =>
        Promise.resolve({ entities: [{ ...instanceRow, _opportunityid_value: q.includes(second) ? second : RECORD_ID }] })
      );
      mockActivePath();

      await Promise.all([
        service.getBPFDataForRecord(RECORD_ID, 'opportunity', config),
        service.getBPFDataForRecord(second, 'opportunity', config),
      ]);

      expect(labelCalls()).toBe(1);
    });

    it('retries a failed label lookup after the short failure TTL', async () => {
      jest.useFakeTimers();
      try {
        webApi.retrieveRecord = jest.fn().mockRejectedValue(new Error('metadata 404'));
        webApi.retrieveMultipleRecords.mockResolvedValue({ entities: [instanceRow] });
        mockActivePath();

        await service.getBPFDataForRecord(RECORD_ID, 'opportunity', config);
        await service.getBPFDataForRecord(RECORD_ID, 'opportunity', config);
        expect(labelCalls()).toBe(1); // cached failure, no retry storm

        jest.setSystemTime(Date.now() + 61 * 1000);
        await service.getBPFDataForRecord(RECORD_ID, 'opportunity', config);
        expect(labelCalls()).toBe(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not try further BPF definitions once the request is cancelled', async () => {
      const twoBpfs: IBPFConfiguration = {
        bpfs: [
          { bpfEntitySchemaName: 'opportunitysalesprocess', lookupFieldSchemaName: '_opportunityid_value' },
          { bpfEntitySchemaName: 'leadtoopportunitysalesprocess', lookupFieldSchemaName: '_opportunityid_value' },
        ],
      };
      const controller = new AbortController();
      controller.abort();

      await expect(
        service.getBPFDataForRecord(RECORD_ID, 'opportunity', twoBpfs, { throwOnError: true, signal: controller.signal })
      ).rejects.toThrow('Request cancelled');
      expect(webApi.retrieveMultipleRecords).not.toHaveBeenCalled();
    });
  });

  describe('stage fields from the process definition (workflow.clientdata)', () => {
    const WORKFLOW = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const instance = { processDefinitionId: `{${WORKFLOW.toUpperCase()}}`, bpfEntityName: 'opportunitysalesprocess' };

    beforeEach(() => {
      webApi.retrieveRecord = jest.fn().mockImplementation((entity: string) =>
        entity === 'workflow'
          ? Promise.resolve({ clientdata: SYNTHETIC_PROCESS_DEFINITION })
          : Promise.reject(new Error(`unexpected ${entity}`))
      );
    });

    it("reads the hovered stage's fields from the workflow, once per process", async () => {
      const first = await service.getStageSteps(stage({ stageId: SYNTH_STAGE_ID }), instance);
      const other = await service.getStageSteps(stage({ stageId: '77777777-7777-4777-8777-777777777777', isActive: false }), instance);

      expect(first.map(f => f.fieldName)).toEqual([
        'x_offerlettersent', 'x_transitionassistance', 'x_approvedtaamount', 'x_taterm', 'x_ipounits', 'x_startdate',
      ]);
      expect(other.map(f => f.fieldName)).toEqual(['x_closed']); // a stage not reached yet
      expect(webApi.retrieveRecord).toHaveBeenCalledTimes(1);
      expect(webApi.retrieveRecord).toHaveBeenCalledWith('workflow', WORKFLOW, '?$select=clientdata');
    });

    it('prefers the definition over steps parsed from processstage', async () => {
      const fields = await service.getStageSteps(
        stage({ stageId: SYNTH_STAGE_ID, steps: [{ fieldName: 'stale', displayName: 'Stale', isRequired: false }] }),
        instance
      );
      expect(fields[0].fieldName).toBe('x_offerlettersent');
    });

    it("falls back to the stage's processstage.clientdata when the definition lacks the stage or fails", async () => {
      webApi.retrieveRecord = jest.fn().mockImplementation((entity: string) =>
        entity === 'workflow'
          ? Promise.reject(new Error('403 on workflow'))
          : Promise.resolve({ clientdata: SAMPLE_CLIENT_DATA })
      );
      const fields = await service.getStageSteps(stage(), instance);
      expect(fields.map(f => f.fieldName)).toEqual(['parentcontactid', 'budgetamount', 'purchasetimeframe']);
      expect(webApi.retrieveRecord).toHaveBeenCalledWith('processstage', STAGE_ID, expect.any(String));
    });
  });

  describe('active stage from traversedpath', () => {
    it('uses the last traversed stage when activestageid is not on the traversed path (GUIDs normalized)', async () => {
      const A = 'aaaaaaaa-0000-4000-8000-000000000001';
      const B = 'bbbbbbbb-0000-4000-8000-000000000002';
      const C = 'cccccccc-0000-4000-8000-000000000003';
      webApi.retrieveMultipleRecords.mockResolvedValue({
        entities: [{
          businessprocessflowinstanceid: INSTANCE_ID,
          _opportunityid_value: RECORD_ID,
          // activestageid points at a stage the path doesn't contain: the path's last entry wins
          _activestageid_value: C,
          traversedpath: `{${A.toUpperCase()}},{${B.toUpperCase()}}`,
          statuscode: 1,
          _processid_value: 'dddddddd-0000-4000-8000-000000000004',
        }],
      });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ value: [A, B, C].map((id, i) => ({ processstageid: id, stagename: `S${i + 1}`, stagecategory: 0 })) }),
      }) as unknown as typeof fetch;

      const instance = (await service.getBPFDataForRecords([RECORD_ID], config)).get(RECORD_ID)!;
      expect(instance.stages.map(s => [s.isCompleted, s.isActive])).toEqual([[true, false], [false, true], [false, false]]);
      expect(instance.activeStageId).toBe(B);
      expect(instance.processDefinitionId).toBe('dddddddd-0000-4000-8000-000000000004');
    });
  });

  describe('active stage when the path was not trimmed on "Back"', () => {
    it("prefers activestageid when the traversed path contains it (D365's BPF bar follows it)", async () => {
      const A = 'aaaaaaaa-0000-4000-8000-000000000001';
      const B = 'bbbbbbbb-0000-4000-8000-000000000002';
      const C = 'cccccccc-0000-4000-8000-000000000003';
      webApi.retrieveMultipleRecords.mockResolvedValue({
        entities: [{
          businessprocessflowinstanceid: INSTANCE_ID,
          _opportunityid_value: RECORD_ID,
          _activestageid_value: `{${B.toUpperCase()}}`, // moved back to B
          traversedpath: `${A},${B},${C}`, // path still ends with C
          statuscode: 1,
        }],
      });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ value: [A, B, C].map((id, i) => ({ processstageid: id, stagename: `S${i + 1}`, stagecategory: 0 })) }),
      }) as unknown as typeof fetch;

      const instance = (await service.getBPFDataForRecords([RECORD_ID], config)).get(RECORD_ID)!;
      expect(instance.stages.map(s => s.isActive)).toEqual([false, true, false]);
      expect(instance.activeStageId).toBe(B);
    });
  });

  describe('getRecordColumns', () => {
    it('requests only the given columns and formats by type', async () => {
      webApi.retrieveRecord = jest.fn().mockResolvedValue({
        x_amount: 1500,
        'x_amount@OData.Community.Display.V1.FormattedValue': '$1,500.00',
        x_sent: true,
        x_start: '2026-10-03',
        _x_owner_value: '00000000-0000-0000-0000-0000000000ff',
        '_x_owner_value@OData.Community.Display.V1.FormattedValue': 'Jane Doe',
        x_note: null,
      });
      const values = await service.getRecordColumns('opportunity', RECORD_ID, [
        { field: 'x_amount', select: 'x_amount', attributeType: 'Money' },
        { field: 'x_sent', select: 'x_sent', attributeType: 'Boolean' },
        { field: 'x_start', select: 'x_start', attributeType: 'DateTime' },
        { field: 'x_owner', select: '_x_owner_value', attributeType: 'Lookup' },
        { field: 'x_note', select: 'x_note', attributeType: 'Memo' },
      ]);
      expect(webApi.retrieveRecord).toHaveBeenCalledTimes(1);
      expect(webApi.retrieveRecord).toHaveBeenCalledWith('opportunity', RECORD_ID, '?$select=x_amount,x_sent,x_start,_x_owner_value,x_note');
      expect(values.get('x_amount')).toEqual({ hasValue: true, display: '$1,500.00' });
      expect(values.get('x_sent')).toEqual({ hasValue: true, display: 'Yes' });
      expect(values.get('x_start')?.display).toMatch(/2026/);
      expect(values.get('x_owner')).toEqual({ hasValue: true, display: 'Jane Doe' });
      expect(values.get('x_note')).toEqual({ hasValue: false, display: null });
    });

    it('isolates a column that fails: the others still load', async () => {
      webApi.retrieveRecord = jest.fn().mockImplementation((_e: string, _id: string, query: string) => {
        if (query.includes('x_broken')) return Promise.reject(new Error('400 Could not find a property named x_broken'));
        return Promise.resolve({ x_ok: 'fine' });
      });
      const values = await service.getRecordColumns('opportunity', RECORD_ID, [
        { field: 'x_ok', select: 'x_ok', attributeType: 'String' },
        { field: 'x_broken', select: 'x_broken', attributeType: 'String' },
      ]);
      expect(values.get('x_ok')).toEqual({ hasValue: true, display: 'fine' });
      expect(values.get('x_broken')).toEqual({ hasValue: false, display: null, failed: true });
    });

    it('does not retry column by column on access/timeout errors', async () => {
      webApi.retrieveRecord = jest.fn().mockRejectedValue(Object.assign(new Error('Principal user is missing prvReadx_thing privilege'), { status: 403 }));
      const values = await service.getRecordColumns('opportunity', RECORD_ID, [
        { field: 'a', select: 'a' },
        { field: 'b', select: 'b' },
        { field: 'c', select: 'c' },
      ]);
      expect(webApi.retrieveRecord).toHaveBeenCalledTimes(1);
      expect([...values.values()].every(v => v.failed)).toBe(true);
    });

    it('never caches a result with a failed column: the next hover retries it', async () => {
      let broken = true;
      webApi.retrieveRecord = jest.fn().mockImplementation((_e: string, _id: string, query: string) => {
        if (broken && query.includes('x_flaky')) return Promise.reject(new Error('400 Could not find a property named x_flaky'));
        return Promise.resolve({ x_ok: 'fine', x_flaky: 'now ok' });
      });
      const cols = [
        { field: 'x_ok', select: 'x_ok', attributeType: 'String' },
        { field: 'x_flaky', select: 'x_flaky', attributeType: 'String' },
      ];
      expect((await service.getRecordColumns('opportunity', RECORD_ID, cols)).get('x_flaky')?.failed).toBe(true);
      broken = false;
      expect((await service.getRecordColumns('opportunity', RECORD_ID, cols)).get('x_flaky')).toEqual({ hasValue: true, display: 'now ok' });
    });

    it('retries a column of unknown type as a lookup', async () => {
      webApi.retrieveRecord = jest.fn().mockImplementation((_e: string, _id: string, query: string) =>
        query === '?$select=_x_contact_value'
          ? Promise.resolve({ _x_contact_value: 'guid', '_x_contact_value@OData.Community.Display.V1.FormattedValue': 'Ann' })
          : Promise.reject(new Error('400'))
      );
      const values = await service.getRecordColumns('opportunity', RECORD_ID, [{ field: 'x_contact', select: 'x_contact' }]);
      expect(values.get('x_contact')).toEqual({ hasValue: true, display: 'Ann' });
    });

    it('marks every column failed for invalid input without calling the API', async () => {
      const values = await service.getRecordColumns('bad name!', RECORD_ID, [{ field: 'x', select: 'x' }]);
      expect(values.get('x')).toEqual({ hasValue: false, display: null, failed: true });
      expect(webApi.retrieveRecord).not.toHaveBeenCalled();
    });
  });

  describe('getStageSteps', () => {
    it('returns steps already on the stage without a request', async () => {
      const steps = [{ fieldName: 'name', displayName: 'Topic', isRequired: true }];
      await expect(service.getStageSteps(stage({ steps }))).resolves.toBe(steps);
      expect(webApi.retrieveRecord).not.toHaveBeenCalled();
    });

    it('fetches clientdata once and caches it', async () => {
      (webApi.retrieveRecord as jest.Mock).mockResolvedValue({ clientdata: SAMPLE_CLIENT_DATA });

      const first = await service.getStageSteps(stage());
      const second = await service.getStageSteps(stage());

      expect(first).toHaveLength(3);
      expect(second).toBe(first);
      expect(webApi.retrieveRecord).toHaveBeenCalledTimes(1);
      expect(webApi.retrieveRecord).toHaveBeenCalledWith('processstage', STAGE_ID, '?$select=clientdata,primaryentitytypecode');
    });

    it('rejects on failure (so the card can say so) and retries next time', async () => {
      (webApi.retrieveRecord as jest.Mock)
        .mockRejectedValueOnce(new Error('403'))
        .mockResolvedValueOnce({ clientdata: SAMPLE_CLIENT_DATA });

      await expect(service.getStageSteps(stage())).rejects.toThrow('403');
      await expect(service.getStageSteps(stage())).resolves.toHaveLength(3);
    });

    it('ignores invalid stage ids', async () => {
      await expect(service.getStageSteps(stage({ stageId: "x' or 1 eq 1" }))).resolves.toEqual([]);
      expect(webApi.retrieveRecord).not.toHaveBeenCalled();
    });
  });

});

describe('isBadColumnError', () => {
  it('recognizes bad-column errors only', () => {
    expect(isBadColumnError({ status: 400 })).toBe(true);
    expect(isBadColumnError(new Error("Could not find a property named 'x_typo' on type 'Microsoft.Dynamics.CRM.opportunity'"))).toBe(true);
    expect(isBadColumnError({ status: 403, message: 'no privilege' })).toBe(false);
    expect(isBadColumnError(new Error('Request timed out'))).toBe(false);
    expect(isBadColumnError(null)).toBe(false);
  });
});
