/**
 * BPFService — stage details features (v1.1)
 *  - instance enrichment (dates, process status, modified by)
 *  - steps parsed from clientdata / lazily fetched
 *  - record values for step completion
 */

import { BPFService } from '../../services/BPFService';
import { createMockWebAPI } from '../setup/testUtils';
import { SAMPLE_CLIENT_DATA } from '../setup/fixtures';
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

    it('parses steps and entity from RetrieveActivePath clientdata', async () => {
      mockInstance({ statuscode: 1 });
      const instance = (await service.getBPFDataForRecords([RECORD_ID], config)).get(RECORD_ID)!;

      expect(instance.stages[0].entityName).toBe('opportunity');
      expect(instance.stages[0].steps).toHaveLength(3);
      expect(instance.stages[0].steps![1]).toEqual({ fieldName: 'budgetamount', displayName: 'Est. Budget', isRequired: true });
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

    it('returns [] on failure and retries next time', async () => {
      (webApi.retrieveRecord as jest.Mock)
        .mockRejectedValueOnce(new Error('403'))
        .mockResolvedValueOnce({ clientdata: SAMPLE_CLIENT_DATA });

      await expect(service.getStageSteps(stage())).resolves.toEqual([]);
      await expect(service.getStageSteps(stage())).resolves.toHaveLength(3);
    });

    it('ignores invalid stage ids', async () => {
      await expect(service.getStageSteps(stage({ stageId: "x' or 1 eq 1" }))).resolves.toEqual([]);
      expect(webApi.retrieveRecord).not.toHaveBeenCalled();
    });
  });

  describe('getRecordValues', () => {
    it('loads and caches the record values', async () => {
      (webApi.retrieveRecord as jest.Mock).mockResolvedValue({
        budgetamount: 10,
        'budgetamount@OData.Community.Display.V1.FormattedValue': '$10.00',
      });

      const values = await service.getRecordValues('opportunity', RECORD_ID);
      await service.getRecordValues('opportunity', RECORD_ID);

      expect(values.get('budgetamount')).toEqual({ hasValue: true, display: '$10.00' });
      expect(webApi.retrieveRecord).toHaveBeenCalledTimes(1);
      expect(webApi.retrieveRecord).toHaveBeenCalledWith('opportunity', RECORD_ID);
    });

    it('returns an empty map on failure or invalid input', async () => {
      (webApi.retrieveRecord as jest.Mock).mockRejectedValue(new Error('nope'));
      await expect(service.getRecordValues('opportunity', RECORD_ID)).resolves.toEqual(new Map());
      await expect(service.getRecordValues('bad name!', RECORD_ID)).resolves.toEqual(new Map());
      await expect(service.getRecordValues('opportunity', 'not-a-guid')).resolves.toEqual(new Map());
    });

    it('is cleared by clearCache', async () => {
      (webApi.retrieveRecord as jest.Mock).mockResolvedValue({});
      await service.getRecordValues('opportunity', RECORD_ID);
      service.clearCache();
      await service.getRecordValues('opportunity', RECORD_ID);
      expect(webApi.retrieveRecord).toHaveBeenCalledTimes(2);
    });
  });
});
