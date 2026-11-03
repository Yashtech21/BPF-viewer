/**
 * Tests for BPFViewerPlus (index.ts) - PCF Control Entry Point
 */

import * as React from 'react';
import { BPFViewerPlus } from '../index';
import { BPFService } from '../services/BPFService';
import { act, render, screen } from '@testing-library/react';
import type { ViewStore } from '../utils/viewStore';
import type { IInputs } from '../generated/ManifestTypes';

// Helper to create mock context
function createControlContext(overrides?: Partial<Record<string, unknown>>): ComponentFramework.Context<IInputs> {
  const mockDataset: ComponentFramework.PropertyTypes.DataSet = {
    sortedRecordIds: [],
    records: {},
    loading: false,
    error: false,
    errorMessage: '',
    paging: {
      totalResultCount: 0,
      hasNextPage: false,
      hasPreviousPage: false,
      pageSize: 25,
      loadNextPage: jest.fn(),
      loadPreviousPage: jest.fn(),
      setPageSize: jest.fn(),
      reset: jest.fn(),
      loadExactPage: jest.fn(),
    },
    filtering: {
      getFilter: jest.fn(),
      setFilter: jest.fn(),
      clearFilter: jest.fn(),
    },
    sorting: [],
    linking: {
      getLinkedEntities: jest.fn().mockReturnValue([]),
    },
    columns: [],
    refresh: jest.fn(),
    ...overrides?.records as object,
  } as unknown as ComponentFramework.PropertyTypes.DataSet;

  return {
    parameters: {
      records: mockDataset,
      parametersBPF: {
        raw: '{"bpfs":[{"bpfEntitySchemaName":"opportunitysalesprocess","lookupFieldSchemaName":"_opportunityid_value"}]}',
        type: 'SingleLine.Text',
      },
      designStyle: { raw: 'chevron' },
      displayMode: { raw: 'stage' },
      recordNameSize: { raw: 'medium' },
      showEntityName: { raw: 'yes' },
      enableNavigation: { raw: 'yes' },
      showPulseAnimation: { raw: 'yes' },
      usePlatformTheme: { raw: 'no' },
      completedColor: { raw: null },
      completedTextColor: { raw: null },
      activeColor: { raw: null },
      activeTextColor: { raw: null },
      inactiveColor: { raw: null },
      inactiveTextColor: { raw: null },
    },
    mode: {
      allocatedHeight: 500,
      allocatedWidth: 800,
      isControlDisabled: false,
      isVisible: true,
      label: 'BPF Viewer',
      trackContainerResize: jest.fn(),
    },
    navigation: {
      openForm: jest.fn().mockResolvedValue(undefined),
      openUrl: jest.fn(),
    },
    webAPI: {
      retrieveMultipleRecords: jest.fn().mockResolvedValue({ entities: [] }),
      retrieveRecord: jest.fn().mockResolvedValue({}),
      createRecord: jest.fn(),
      updateRecord: jest.fn(),
      deleteRecord: jest.fn(),
    },
    utils: {
      getEntityMetadata: jest.fn().mockRejectedValue(new Error('metadata not available')),
      hasEntityPrivilege: jest.fn().mockReturnValue(true),
      lookupObjects: jest.fn(),
    },
    factory: {
      requestRender: jest.fn(),
      getPopupService: jest.fn(),
    },
    formatting: {
      formatCurrency: jest.fn(),
      formatDateAsFilterStringInUTC: jest.fn(),
      formatDateLong: jest.fn(),
      formatDateShort: jest.fn(),
      formatDecimal: jest.fn(),
      formatInteger: jest.fn(),
      formatLanguage: jest.fn(),
      formatTime: jest.fn(),
      formatUserInput: jest.fn(),
      getWeekOfYear: jest.fn(),
    },
    resources: {
      getString: jest.fn((key: string) => key),
      getResource: jest.fn(),
    },
    fluentDesignLanguage: undefined,
  } as unknown as ComponentFramework.Context<IInputs>;
}

describe('BPFViewerPlus', () => {
  let control: BPFViewerPlus;
  let context: ComponentFramework.Context<IInputs>;
  const notifyOutputChanged = jest.fn();

  beforeEach(() => {
    control = new BPFViewerPlus();
    context = createControlContext();
    jest.clearAllMocks();
  });

  describe('init', () => {
    it('initializes the control without errors', () => {
      expect(() => control.init(context, notifyOutputChanged)).not.toThrow();
    });

    it('tracks container resize', () => {
      control.init(context, notifyOutputChanged);
      expect(context.mode.trackContainerResize).toHaveBeenCalledWith(true);
    });

    it('parses BPF configuration', () => {
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);
      // Should render without error since config is valid
      expect(element).toBeDefined();
      expect(element.props.error).toBeNull();
    });

    it('handles invalid JSON configuration', () => {
      context.parameters.parametersBPF = { raw: 'not-valid-json' } as ComponentFramework.PropertyTypes.StringProperty;
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);
      // Should have an error from invalid JSON
      expect(element.props.error).not.toBeNull();
    });

    it('handles invalid BPF config structure', () => {
      context.parameters.parametersBPF = { raw: '{"wrong":"structure"}' } as ComponentFramework.PropertyTypes.StringProperty;
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);
      expect(element.props.error).not.toBeNull();
    });

    it('handles empty BPF config', () => {
      context.parameters.parametersBPF = { raw: null } as unknown as ComponentFramework.PropertyTypes.StringProperty;
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);
      // No error but also no config - just renders empty
      expect(element).toBeDefined();
    });
  });

  describe('updateView', () => {
    beforeEach(() => {
      control.init(context, notifyOutputChanged);
    });

    it('returns a React element', () => {
      const element = control.updateView(context);
      expect(element).toBeDefined();
      expect(React.isValidElement(element)).toBe(true);
    });

    it('passes settings to BPFViewer', () => {
      const element = control.updateView(context);
      expect(element.props.settings).toBeDefined();
      expect(element.props.settings.designStyle).toBe('chevron');
      expect(element.props.settings.displayMode).toBe('stage');
      expect(element.props.settings.recordNameSize).toBe('medium');
      expect(element.props.settings.showEntityName).toBe(true);
      expect(element.props.settings.enableNavigation).toBe(true);
      expect(element.props.settings.showPulseAnimation).toBe(true);
    });

    it('passes colors to BPFViewer', () => {
      const element = control.updateView(context);
      expect(element.props.colors).toBeDefined();
      expect(element.props.colors.completed).toBeDefined();
      expect(element.props.colors.active).toBeDefined();
      expect(element.props.colors.inactive).toBeDefined();
    });

    it('sets loading state from dataset', () => {
      (context.parameters.records as unknown as { loading: boolean }).loading = true;
      const element = control.updateView(context);
      expect(element.props.isLoading).toBe(true);
    });

    it('passes onNavigate callback', () => {
      const element = control.updateView(context);
      expect(element.props.onNavigate).toBeDefined();
    });

    it('passes onRefresh callback', () => {
      const element = control.updateView(context);
      expect(element.props.onRefresh).toBeDefined();
    });

    it('does not reprocess dataset when version unchanged', () => {
      // First call
      control.updateView(context);
      // Second call with same dataset version
      const spy = jest.spyOn(context.webAPI, 'retrieveMultipleRecords');
      control.updateView(context);
      // No new API calls since dataset version is the same
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('processDataset', () => {
    beforeEach(() => {
      control.init(context, notifyOutputChanged);
    });

    it('handles dataset with records', async () => {
      const recordId = '00000000-0000-0000-0000-000000000001';
      const mockRecord = {
        getRecordId: () => recordId,
        getValue: jest.fn().mockReturnValue('Test Record'),
        getFormattedValue: jest.fn().mockReturnValue('Test Record'),
        getNamedReference: jest.fn().mockReturnValue({
          id: recordId,
          name: 'Test Record',
          entityType: 'opportunity',
        }),
      };

      const datasetWithRecords = {
        ...context.parameters.records,
        sortedRecordIds: [recordId],
        records: { [recordId]: mockRecord },
        loading: false,
        columns: [{ name: 'name', isPrimary: true, displayName: 'Name', dataType: 'SingleLine.Text', alias: 'name', order: 0, visualSizeFactor: 1 }],
      };

      const newContext = {
        ...context,
        parameters: {
          ...context.parameters,
          records: datasetWithRecords,
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      const element = control.updateView(newContext);
      expect(element).toBeDefined();
    });

    it('handles empty dataset', () => {
      const emptyContext = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [],
            records: {},
            loading: false,
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      // Trigger a dataset version change
      const element = control.updateView(emptyContext);
      expect(element.props.records).toEqual([]);
    });

    it('reuses cached record data on subsequent calls', async () => {
      const recordId = '00000000-0000-0000-0000-000000000001';
      const mockRecord = {
        getRecordId: () => recordId,
        getValue: jest.fn().mockReturnValue('Test'),
        getFormattedValue: jest.fn().mockReturnValue('Test'),
        getNamedReference: jest.fn().mockReturnValue({
          id: recordId,
          name: 'Test',
          entityType: 'opportunity',
        }),
      };

      // Mock successful BPF data fetch
      context.webAPI.retrieveMultipleRecords = jest.fn()
        .mockImplementation((entityName: string) => {
          if (entityName === 'workflow') {
            return Promise.resolve({
              entities: [{ workflowid: 'p1', name: 'Process', uniquename: 'opportunitysalesprocess' }],
            });
          }
          if (entityName === 'processstage') {
            return Promise.resolve({
              entities: [{ processstageid: 'stage1', stagename: 'S1', stagecategory: 0 }],
            });
          }
          if (entityName === 'opportunitysalesprocess') {
            return Promise.resolve({
              entities: [{
                businessprocessflowinstanceid: 'bpf-001',
                _opportunityid_value: recordId,
                _activestageid_value: 'stage1',
                traversedpath: '',
                statuscode: 1,
              }],
            });
          }
          return Promise.resolve({ entities: [] });
        });
      context.webAPI.retrieveRecord = jest.fn().mockResolvedValue({
        OptionSet: { Options: [{ Value: 0, Label: { UserLocalizedLabel: { Label: 'Qualify' } } }] },
      });

      const datasetCtx = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId],
            records: { [recordId]: mockRecord },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      // First call triggers fetch
      control.updateView(datasetCtx);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second call with same records should reuse cache
      const spy = jest.spyOn(context.webAPI, 'retrieveMultipleRecords');
      spy.mockClear();

      // Force dataset version change to trigger reprocessing
      const datasetCtx2 = {
        ...datasetCtx,
        parameters: {
          ...datasetCtx.parameters,
          records: {
            ...datasetCtx.parameters.records,
            loading: true, // Change loading to force version change
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;
      control.updateView(datasetCtx2);

      // Now back to not loading - triggers processDataset, should reuse cache
      control.updateView(datasetCtx);
      const element = control.updateView(datasetCtx);
      expect(element).toBeDefined();
    });

    it('marks records with error when BPF fetch fails', async () => {
      const recordId = '00000000-0000-0000-0000-000000000001';
      const mockRecord = {
        getRecordId: () => recordId,
        getValue: jest.fn().mockReturnValue('Test'),
        getFormattedValue: jest.fn().mockReturnValue('Test'),
        getNamedReference: jest.fn().mockReturnValue({
          id: recordId,
          name: 'Test',
          entityType: 'opportunity',
        }),
      };

      // Mock getBPFDataForRecord to reject (triggers processDataset catch block)
      jest.spyOn(BPFService.prototype, 'getBPFDataForRecord')
        .mockRejectedValue(new Error('Network error'));

      const datasetCtx = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId],
            records: { [recordId]: mockRecord },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      control.updateView(datasetCtx);

      // Wait for async processDataset to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const element = control.updateView(datasetCtx);
      // Records should have error messages from the catch block
      expect(element.props.records.length).toBeGreaterThan(0);
      expect(element.props.records[0].error).toBeTruthy();
      expect(element.props.records[0].isLoading).toBe(false);
    });

    it('discards stale results when a newer request starts', async () => {
      const recordId1 = '00000000-0000-0000-0000-000000000001';
      const recordId2 = '00000000-0000-0000-0000-000000000002';

      const createMockRecord = (id: string, name: string) => ({
        getRecordId: () => id,
        getValue: jest.fn().mockReturnValue(name),
        getFormattedValue: jest.fn().mockReturnValue(name),
        getNamedReference: jest.fn().mockReturnValue({
          id,
          name,
          entityType: 'opportunity',
        }),
      });

      // First getBPFDataForRecord call: slow (never resolves until we resolve it)
      // Second call: fast
      let resolveFirst!: (value: null) => void;
      let callCount = 0;
      jest.spyOn(BPFService.prototype, 'getBPFDataForRecord')
        .mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return new Promise<null>(resolve => { resolveFirst = resolve; });
          }
          return Promise.resolve(null);
        });

      // First dataset with record1
      const ctx1 = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId1],
            records: { [recordId1]: createMockRecord(recordId1, 'Record 1') },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      control.updateView(ctx1);

      // Wait for async getEntityDisplayName to resolve before second updateView
      await new Promise(resolve => setTimeout(resolve, 20));

      // Second dataset with TWO records so datasetVersion differs ("2_false" vs "1_false")
      const ctx2 = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId1, recordId2],
            records: {
              [recordId1]: createMockRecord(recordId1, 'Record 1'),
              [recordId2]: createMockRecord(recordId2, 'Record 2'),
            },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      control.updateView(ctx2);

      // Wait for async getEntityDisplayName in second call
      await new Promise(resolve => setTimeout(resolve, 20));

      // Resolve the first request (should be discarded as stale since generation moved on)
      resolveFirst(null);

      await new Promise(resolve => setTimeout(resolve, 100));

      // The view should reflect ctx2 records, not stale ctx1 results
      const element = control.updateView(ctx2);
      expect(element.props.records.length).toBeLessThanOrEqual(2);
    });

    it('discards stale errors when a newer request starts', async () => {
      const recordId1 = '00000000-0000-0000-0000-000000000001';
      const recordId2 = '00000000-0000-0000-0000-000000000002';

      const createMockRecord = (id: string, name: string) => ({
        getRecordId: () => id,
        getValue: jest.fn().mockReturnValue(name),
        getFormattedValue: jest.fn().mockReturnValue(name),
        getNamedReference: jest.fn().mockReturnValue({
          id,
          name,
          entityType: 'opportunity',
        }),
      });

      // First call: slow rejection. Second call: fast success.
      let rejectFirst!: (error: Error) => void;
      let callCount = 0;
      jest.spyOn(BPFService.prototype, 'getBPFDataForRecord')
        .mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return new Promise<null>((_resolve, reject) => { rejectFirst = reject; });
          }
          return Promise.resolve(null);
        });

      const ctx1 = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId1],
            records: { [recordId1]: createMockRecord(recordId1, 'Record 1') },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      control.updateView(ctx1);

      // Wait for async getEntityDisplayName to resolve before second updateView
      await new Promise(resolve => setTimeout(resolve, 20));

      // Trigger second processDataset with different version
      const ctx2 = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId1, recordId2],
            records: {
              [recordId1]: createMockRecord(recordId1, 'Record 1'),
              [recordId2]: createMockRecord(recordId2, 'Record 2'),
            },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      control.updateView(ctx2);

      // Wait for async getEntityDisplayName in second call
      await new Promise(resolve => setTimeout(resolve, 20));

      // Reject the first request (should be discarded as stale error)
      rejectFirst(new Error('Network error'));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Records should not have error from the stale first request
      const element = control.updateView(ctx2);
      const hasError = element.props.records.some((r: { error: string | null }) => r.error);
      expect(hasError).toBe(false);
    });

    it('preserves cached records when fetching new ones succeeds', async () => {
      const recordId1 = '00000000-0000-0000-0000-000000000001';
      const recordId2 = '00000000-0000-0000-0000-000000000002';

      const createMockRecord = (id: string, name: string) => ({
        getRecordId: () => id,
        getValue: jest.fn().mockReturnValue(name),
        getFormattedValue: jest.fn().mockReturnValue(name),
        getNamedReference: jest.fn().mockReturnValue({
          id,
          name,
          entityType: 'opportunity',
        }),
      });

      // First call succeeds for record1, second call for record2
      jest.spyOn(BPFService.prototype, 'getBPFDataForRecord')
        .mockResolvedValue(null);

      // First dataset: record1 only
      const ctx1 = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId1],
            records: { [recordId1]: createMockRecord(recordId1, 'Record 1') },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      control.updateView(ctx1);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second dataset: record1 (cached) + record2 (new)
      const ctx2 = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId1, recordId2],
            records: {
              [recordId1]: createMockRecord(recordId1, 'Record 1'),
              [recordId2]: createMockRecord(recordId2, 'Record 2'),
            },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      control.updateView(ctx2);
      await new Promise(resolve => setTimeout(resolve, 100));

      const element = control.updateView(ctx2);
      // Should have both records — record1 cached, record2 newly fetched
      expect(element.props.records.length).toBe(2);
    });

    it('preserves cached records when fetching new ones fails', async () => {
      const recordId1 = '00000000-0000-0000-0000-000000000001';
      const recordId2 = '00000000-0000-0000-0000-000000000002';

      const createMockRecord = (id: string, name: string) => ({
        getRecordId: () => id,
        getValue: jest.fn().mockReturnValue(name),
        getFormattedValue: jest.fn().mockReturnValue(name),
        getNamedReference: jest.fn().mockReturnValue({
          id,
          name,
          entityType: 'opportunity',
        }),
      });

      const spy = jest.spyOn(BPFService.prototype, 'getBPFDataForRecord');

      // First call succeeds for record1
      spy.mockResolvedValueOnce(null);

      const ctx1 = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId1],
            records: { [recordId1]: createMockRecord(recordId1, 'Record 1') },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      control.updateView(ctx1);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second call fails when fetching record2
      spy.mockRejectedValueOnce(new Error('Network error'));

      const ctx2 = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId1, recordId2],
            records: {
              [recordId1]: createMockRecord(recordId1, 'Record 1'),
              [recordId2]: createMockRecord(recordId2, 'Record 2'),
            },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      control.updateView(ctx2);
      await new Promise(resolve => setTimeout(resolve, 100));

      const element = control.updateView(ctx2);
      // Both records should exist — record1 cached, record2 with error
      expect(element.props.records.length).toBe(2);
      // The new record should have an error, cached one should not
      const rec2 = element.props.records.find((r: { recordId: string }) => r.recordId === recordId2);
      expect(rec2?.error).toBeTruthy();
    });

    it('falls back to getEntityNameFromConfig and extracts entity from lookup field', async () => {
      const recordId = '00000000-0000-0000-0000-000000000001';
      const mockRecord = {
        getRecordId: () => recordId,
        getValue: jest.fn().mockReturnValue('Test'),
        getFormattedValue: jest.fn().mockReturnValue('Test'),
        // No getNamedReference — forces fallback to getEntityNameFromConfig
        getNamedReference: undefined,
      };

      jest.spyOn(BPFService.prototype, 'getBPFDataForRecord')
        .mockResolvedValue(null);

      // Lookup field with pattern that matches /_(.+)id_value/ while passing validation
      // (starts with letter, so isValidEntityName accepts it)
      const configCtx = {
        ...context,
        parameters: {
          ...context.parameters,
          parametersBPF: {
            raw: '{"bpfs":[{"bpfEntitySchemaName":"opportunitysalesprocess","lookupFieldSchemaName":"bpf_opportunityid_value"}]}',
            type: 'SingleLine.Text',
          },
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId],
            records: { [recordId]: mockRecord },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      const ctrl = new BPFViewerPlus();
      ctrl.init(configCtx, notifyOutputChanged);
      ctrl.updateView(configCtx);
      await new Promise(resolve => setTimeout(resolve, 100));

      const element = ctrl.updateView(configCtx);
      // Regex extracts "opportunity" from "bpf_opportunityid_value"
      expect(element.props.records.length).toBeGreaterThan(0);
      expect(element.props.records[0].entityName).toBe('opportunity');
    });

    it('returns "unknown" from getEntityNameFromConfig when lookup field has no match', async () => {
      const recordId = '00000000-0000-0000-0000-000000000001';
      const mockRecord = {
        getRecordId: () => recordId,
        getValue: jest.fn().mockReturnValue('Test'),
        getFormattedValue: jest.fn().mockReturnValue('Test'),
        getNamedReference: undefined,
      };

      jest.spyOn(BPFService.prototype, 'getBPFDataForRecord')
        .mockResolvedValue(null);

      // Lookup field that won't match /_(.+)id_value/ regex
      const configCtx = {
        ...context,
        parameters: {
          ...context.parameters,
          parametersBPF: {
            raw: '{"bpfs":[{"bpfEntitySchemaName":"opportunitysalesprocess","lookupFieldSchemaName":"customfield"}]}',
            type: 'SingleLine.Text',
          },
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId],
            records: { [recordId]: mockRecord },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      const ctrl = new BPFViewerPlus();
      ctrl.init(configCtx, notifyOutputChanged);
      ctrl.updateView(configCtx);
      await new Promise(resolve => setTimeout(resolve, 100));

      const element = ctrl.updateView(configCtx);
      expect(element.props.records.length).toBeGreaterThan(0);
      expect(element.props.records[0].entityName).toBe('unknown');
    });

    describe('incremental per-record loading', () => {
      const ids = [
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
      ];

      const mockRecord = (id: string, name: string) => ({
        getRecordId: () => id,
        getValue: jest.fn().mockReturnValue(name),
        getFormattedValue: jest.fn().mockReturnValue(name),
        getNamedReference: jest.fn().mockReturnValue({ id, name, entityType: 'opportunity' }),
      });

      const ctxFor = (recordIds: string[]) =>
        ({
          ...context,
          parameters: {
            ...context.parameters,
            records: {
              ...context.parameters.records,
              sortedRecordIds: recordIds,
              records: Object.fromEntries(recordIds.map((id, i) => [id, mockRecord(id, `Record ${i + 1}`)])),
              loading: false,
              columns: [{ name: 'name', isPrimary: true }],
            },
          },
        }) as unknown as ComponentFramework.Context<IInputs>;

      const instanceFor = (id: string) => ({
        processId: `bpf-${id.slice(-1)}`,
        processName: 'Opportunity Sales Process',
        bpfEntityName: 'opportunitysalesprocess',
        activeStageId: 's1',
        traversedPath: '',
        statusCode: 1,
        stages: [],
      });

      /** Lets queued promise callbacks run */
      const flush = async () => {
        for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
      };

      /** Spy that hands back a controllable promise per call */
      function deferredSpy() {
        const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
        const spy = jest.spyOn(BPFService.prototype, 'getBPFDataForRecord').mockImplementation(
          (recordId: string) =>
            new Promise((resolve, reject) => {
              pending.set(recordId, { resolve: resolve as (v: unknown) => void, reject });
            }) as ReturnType<BPFService['getBPFDataForRecord']>
        );
        return { spy, pending };
      }

      type Row = { recordId: string; isLoading: boolean; error: string | null; bpfInstance: unknown };
      const rows = (ctx: ComponentFramework.Context<IInputs>) =>
        control.updateView(ctx).props.records as Row[];

      const strict = expect.objectContaining({ throwOnError: true, signal: expect.anything() });

      it('renders every row as loading first, then updates each row as its own data arrives', async () => {
        const { spy, pending } = deferredSpy();
        const ctx = ctxFor(ids);

        // Like D365 here: updateView is called once and NOT again afterwards.
        // Everything below reads the live store the React tree subscribes to.
        const store = control.updateView(ctx).props.store as ViewStore;
        const live = () => store.getState().records as Row[];
        await flush();

        // All rows exist and are loading before any BPF data arrives
        const initial = live();
        expect(initial.map(r => r.recordId)).toEqual(ids);
        expect(initial.every(r => r.isLoading)).toBe(true);
        expect(context.factory.requestRender).toHaveBeenCalled();

        // 3 records < concurrency limit: all requested up front, in order
        expect(spy.mock.calls.map(c => c[0])).toEqual(ids);
        expect(spy).toHaveBeenCalledWith(ids[0], 'opportunity', expect.anything(), strict);

        // Responses arrive out of order -> only that row updates
        const versionBefore = store.getVersion();
        pending.get(ids[1])!.resolve(instanceFor(ids[1]));
        await flush();

        let current = live();
        expect(current[1]).toMatchObject({ isLoading: false, bpfInstance: expect.objectContaining({ processId: 'bpf-2' }) });
        expect(current[0].isLoading).toBe(true);
        expect(current[2].isLoading).toBe(true);
        expect(store.getState().isLoading).toBe(true);
        expect(store.getVersion()).toBeGreaterThan(versionBefore);

        pending.get(ids[0])!.resolve(null);
        await flush();
        expect(live()[0]).toMatchObject({ isLoading: false, bpfInstance: null, error: null });
        expect(store.getState().isLoading).toBe(true);

        pending.get(ids[2])!.resolve(instanceFor(ids[2]));
        await flush();

        // Queue drained -> global loading cleared, without any further updateView
        current = live();
        expect(current.every(r => !r.isLoading)).toBe(true);
        expect(store.getState().isLoading).toBe(false);
        expect(spy).toHaveBeenCalledTimes(3);

        // And updateView (if the host does call it) agrees with the store
        expect(rows(ctx).every(r => !r.isLoading)).toBe(true);
      });

      it('regression: the rendered grid shows fetched data without another updateView or refresh', async () => {
        const { pending } = deferredSpy();
        const ctx = ctxFor([ids[0]]);

        // Render the element from the ONLY updateView call (the host never calls it again)
        const element = control.updateView(ctx);
        render(element);
        await act(async () => {
          await flush();
        });
        expect(screen.getByText('Loading BPF...')).toBeInTheDocument();

        const withStage = {
          ...instanceFor(ids[0]),
          stages: [{ stageId: 's1', stageName: 'Qualify', stageCategory: 0, stageCategoryName: 'Qualify', stageOrder: 0, isActive: true, isCompleted: false }],
        };
        await act(async () => {
          pending.get(ids[0])!.resolve(withStage);
          await flush();
        });

        expect(screen.queryByText('Loading BPF...')).not.toBeInTheDocument();
        expect(screen.getByText('Qualify')).toBeInTheDocument();
      });

      it('never has more than 4 requests in flight', async () => {
        const many = Array.from({ length: 7 }, (_, i) => `00000000-0000-0000-0000-00000000001${i}`);
        const { spy, pending } = deferredSpy();
        const ctx = ctxFor(many);

        control.updateView(ctx);
        await flush();
        expect(spy).toHaveBeenCalledTimes(4);

        // Finishing one frees one slot
        pending.get(many[2])!.resolve(null);
        await flush();
        expect(spy).toHaveBeenCalledTimes(5);
        expect(spy).toHaveBeenLastCalledWith(many[4], 'opportunity', expect.anything(), strict);

        many.forEach(id => pending.get(id)?.resolve(null));
        await flush();
        many.forEach(id => pending.get(id)?.resolve(null));
        await flush();
        expect(spy).toHaveBeenCalledTimes(7);
        expect(control.updateView(ctx).props.isLoading).toBe(false);
      });

      it('marks only the failing row with an error and keeps going', async () => {
        const spy = jest.spyOn(BPFService.prototype, 'getBPFDataForRecord').mockImplementation(async (recordId: string) => {
          if (recordId === ids[1]) throw new Error('Network error');
          return instanceFor(recordId) as Awaited<ReturnType<BPFService['getBPFDataForRecord']>>;
        });
        const ctx = ctxFor(ids);

        control.updateView(ctx);
        await flush();

        const current = rows(ctx);
        expect(spy).toHaveBeenCalledTimes(3);
        expect(current[0]).toMatchObject({ isLoading: false, error: null });
        expect(current[1].isLoading).toBe(false);
        expect(current[1].error).toBeTruthy();
        expect(current[2]).toMatchObject({ isLoading: false, error: null });
        expect(control.updateView(ctx).props.isLoading).toBe(false);
      });

      it('retries a failed row on the next dataset change but not the successful ones', async () => {
        const spy = jest.spyOn(BPFService.prototype, 'getBPFDataForRecord')
          .mockImplementation(async (recordId: string) => {
            if (recordId === ids[1]) throw new Error('Network error');
            return null;
          });
        control.updateView(ctxFor(ids));
        await flush();
        spy.mockClear();
        spy.mockResolvedValue(null);

        // Same records, different order -> dataset version changes
        const reordered = ctxFor([ids[1], ids[0], ids[2]]);
        control.updateView(reordered);
        await flush();

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(ids[1], 'opportunity', expect.anything(), strict);
        expect(rows(reordered).find(r => r.recordId === ids[1])?.error).toBeNull();
      });

      const six = Array.from({ length: 6 }, (_, i) => `00000000-0000-0000-0000-00000000002${i}`);

      it('stops the old queue when a newer dataset arrives', async () => {
        const { spy, pending } = deferredSpy();
        const other = '00000000-0000-0000-0000-000000000009';

        control.updateView(ctxFor(six));
        await flush();
        expect(spy).toHaveBeenCalledTimes(4); // six[4], six[5] still queued

        // New view with a different record
        const ctx2 = ctxFor([other]);
        control.updateView(ctx2);
        await flush();

        // The old in-flight requests were cancelled via the signal
        const oldSignal = (spy.mock.calls[0][3] as { signal: AbortSignal }).signal;
        expect(oldSignal.aborted).toBe(true);

        // Old requests settle late: must not touch the new rows or start the queued ones
        six.slice(0, 4).forEach(id => pending.get(id)!.resolve(instanceFor(id)));
        await flush();

        const requested = spy.mock.calls.map(c => c[0]);
        expect(requested).toEqual([...six.slice(0, 4), other]);
        expect(rows(ctx2).map(r => r.recordId)).toEqual([other]);
        expect(rows(ctx2)[0].isLoading).toBe(true);
        expect(control.updateView(ctx2).props.isLoading).toBe(true);

        pending.get(other)!.resolve(null);
        await flush();
        expect(control.updateView(ctx2).props.isLoading).toBe(false);
      });

      it('stops the queue on destroy', async () => {
        const { spy, pending } = deferredSpy();
        control.updateView(ctxFor(six));
        await flush();

        control.destroy();
        six.slice(0, 4).forEach(id => pending.get(id)!.resolve(null));
        await flush();

        expect(spy).toHaveBeenCalledTimes(4);
      });
    });

    it('returns "unknown" from getEntityNameFromConfig when config is missing', () => {
      // Create control with empty BPF config
      const noConfigContext = {
        ...context,
        parameters: {
          ...context.parameters,
          parametersBPF: { raw: null, type: 'SingleLine.Text' },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      const ctrl = new BPFViewerPlus();
      ctrl.init(noConfigContext, notifyOutputChanged);

      // processDataset will return early because bpfConfig is null
      const element = ctrl.updateView(noConfigContext);
      expect(element).toBeDefined();
    });
  });

  describe('handleNavigate', () => {
    it('calls navigation.openForm when invoked with valid params', () => {
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      element.props.onNavigate('opportunity', '00000000-0000-0000-0000-000000000001');

      expect(context.navigation.openForm).toHaveBeenCalledWith({
        entityName: 'opportunity',
        entityId: '00000000-0000-0000-0000-000000000001',
        openInNewWindow: true,
      });
    });

    it('opens in the same window when navigationTarget is sameWindow', () => {
      (context.parameters as unknown as Record<string, unknown>).navigationTarget = { raw: 'sameWindow' };
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      element.props.onNavigate('opportunity', '00000000-0000-0000-0000-000000000001');

      expect(context.navigation.openForm).toHaveBeenCalledWith(
        expect.objectContaining({ openInNewWindow: false })
      );
    });

    it('opens a modal dialog via Xrm.Navigation.navigateTo and refreshes on close', async () => {
      (context.parameters as unknown as Record<string, unknown>).navigationTarget = { raw: 'dialog' };
      const navigateTo = jest.fn().mockResolvedValue(undefined);
      const g = globalThis as unknown as { Xrm?: unknown };
      const previousXrm = g.Xrm;
      g.Xrm = { Navigation: { navigateTo } };
      try {
        control.init(context, notifyOutputChanged);
        const element = control.updateView(context);

        element.props.onNavigate('opportunity', '00000000-0000-0000-0000-000000000001');
        await Promise.resolve();
        await Promise.resolve();

        expect(navigateTo).toHaveBeenCalledWith(
          { pageType: 'entityrecord', entityName: 'opportunity', entityId: '00000000-0000-0000-0000-000000000001' },
          expect.objectContaining({ target: 2 })
        );
        expect(context.navigation.openForm).not.toHaveBeenCalled();
        expect(context.parameters.records.refresh).toHaveBeenCalled();
      } finally {
        g.Xrm = previousXrm;
      }
    });

    it('falls back to openForm when dialog navigation is unavailable', () => {
      (context.parameters as unknown as Record<string, unknown>).navigationTarget = { raw: 'dialog' };
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      element.props.onNavigate('opportunity', '00000000-0000-0000-0000-000000000001');

      expect(context.navigation.openForm).toHaveBeenCalledWith(
        expect.objectContaining({ openInNewWindow: true })
      );
    });

    it('rejects invalid entity name', () => {
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      element.props.onNavigate('123invalid', '00000000-0000-0000-0000-000000000001');
      expect(context.navigation.openForm).not.toHaveBeenCalled();
    });

    it('rejects invalid record ID', () => {
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      element.props.onNavigate('opportunity', 'not-a-guid');
      expect(context.navigation.openForm).not.toHaveBeenCalled();
    });

    it('handles empty entity name', () => {
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      element.props.onNavigate('', '00000000-0000-0000-0000-000000000001');
      expect(context.navigation.openForm).not.toHaveBeenCalled();
    });

    it('handles empty record ID', () => {
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      element.props.onNavigate('opportunity', '');
      expect(context.navigation.openForm).not.toHaveBeenCalled();
    });
  });

  describe('handleRefresh', () => {
    it('clears cache and triggers dataset refresh', () => {
      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      // Invoke the refresh callback
      element.props.onRefresh();

      expect(context.parameters.records.refresh).toHaveBeenCalled();
    });

    it('resets error and loading state, forces reprocess', async () => {
      control.init(context, notifyOutputChanged);
      const recordId = '00000000-0000-0000-0000-000000000001';
      const mockRecord = {
        getRecordId: () => recordId,
        getValue: jest.fn().mockReturnValue('Test'),
        getFormattedValue: jest.fn().mockReturnValue('Test'),
        getNamedReference: jest.fn().mockReturnValue({
          id: recordId,
          name: 'Test',
          entityType: 'opportunity',
        }),
      };

      // Make BPF fetch fail to set an error
      jest.spyOn(BPFService.prototype, 'getBPFDataForRecord')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(null);

      const datasetCtx = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId],
            records: { [recordId]: mockRecord },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      control.updateView(datasetCtx);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Now trigger refresh — should clear error and refetch
      const element = control.updateView(datasetCtx);
      element.props.onRefresh();

      // After refresh, lastDatasetVersion is reset, so next updateView reprocesses
      const afterRefresh = control.updateView(datasetCtx);
      expect(afterRefresh.props.isLoading).toBe(true);
    });
  });

  describe('getOutputs', () => {
    it('returns empty object', () => {
      control.init(context, notifyOutputChanged);
      expect(control.getOutputs()).toEqual({});
    });
  });

  describe('destroy', () => {
    it('cleans up without errors', () => {
      control.init(context, notifyOutputChanged);
      expect(() => control.destroy()).not.toThrow();
    });

    it('can be called before init', () => {
      expect(() => control.destroy()).not.toThrow();
    });

    it('aborts pending requests on destroy', async () => {
      control.init(context, notifyOutputChanged);
      const recordId = '00000000-0000-0000-0000-000000000001';
      const mockRecord = {
        getRecordId: () => recordId,
        getValue: jest.fn().mockReturnValue('Test'),
        getFormattedValue: jest.fn().mockReturnValue('Test'),
        getNamedReference: jest.fn().mockReturnValue({
          id: recordId,
          name: 'Test',
          entityType: 'opportunity',
        }),
      };

      // Make BPF fetch slow so abortController is set — use resolvable promise
      let resolvePending!: (value: null) => void;
      jest.spyOn(BPFService.prototype, 'getBPFDataForRecord')
        .mockReturnValue(new Promise(resolve => { resolvePending = resolve; }));

      const datasetCtx = {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId],
            records: { [recordId]: mockRecord },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;

      // Trigger async processDataset (sets abortController)
      control.updateView(datasetCtx);

      // Destroy while request is pending — should abort without error
      expect(() => control.destroy()).not.toThrow();

      // Cleanup: resolve pending promise to avoid worker leak
      resolvePending(null);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  });

  describe('getSettings edge cases', () => {
    it('uses default values for missing parameters', () => {
      context.parameters.designStyle = { raw: null } as unknown as ComponentFramework.PropertyTypes.EnumProperty<string>;
      context.parameters.displayMode = { raw: null } as unknown as ComponentFramework.PropertyTypes.EnumProperty<string>;
      context.parameters.recordNameSize = { raw: null } as unknown as ComponentFramework.PropertyTypes.EnumProperty<string>;
      context.parameters.showEntityName = { raw: 'no' } as unknown as ComponentFramework.PropertyTypes.EnumProperty<string>;
      context.parameters.enableNavigation = { raw: 'no' } as unknown as ComponentFramework.PropertyTypes.EnumProperty<string>;
      context.parameters.showPulseAnimation = { raw: 'no' } as unknown as ComponentFramework.PropertyTypes.EnumProperty<string>;

      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      expect(element.props.settings.designStyle).toBe('modern');
      expect(element.props.settings.displayMode).toBe('stage');
      expect(element.props.settings.recordNameSize).toBe('medium');
      expect(element.props.settings.showEntityName).toBe(false);
      expect(element.props.settings.enableNavigation).toBe(false);
      expect(element.props.settings.showPulseAnimation).toBe(false);
      // v1.1 properties missing on forms configured with v1.0 fall back to defaults
      expect(element.props.settings.enableStageDetails).toBe(true);
      expect(element.props.settings.showToolbar).toBe(true);
      expect(element.props.settings.stageAgeWarningDays).toBeNull();
      expect(element.props.settings.navigationTarget).toBe('newWindow');
      expect(element.props.settings.density).toBe('comfortable');
    });

    it('reads v1.1 settings', () => {
      const params = context.parameters as unknown as Record<string, unknown>;
      params.enableStageDetails = { raw: 'no' };
      params.showToolbar = { raw: 'no' };
      params.stageAgeWarningDays = { raw: 7 };
      params.navigationTarget = { raw: 'dialog' };
      params.density = { raw: 'compact' };

      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      expect(element.props.settings.enableStageDetails).toBe(false);
      expect(element.props.settings.showToolbar).toBe(false);
      expect(element.props.settings.stageAgeWarningDays).toBe(7);
      expect(element.props.settings.navigationTarget).toBe('dialog');
      expect(element.props.settings.density).toBe('compact');
      expect(typeof element.props.loaders.loadStageSteps).toBe('function');
      expect(typeof element.props.loaders.loadRecordValues).toBe('function');
    });

    it('caches field metadata, including fields metadata cannot describe', async () => {
      const getEntityMetadata = jest.fn().mockResolvedValue({
        Attributes: { get: (n: string) => (n === 'budgetamount' ? { DisplayName: 'Budget', IsSecured: false } : undefined) },
      });
      (context.utils as unknown as { getEntityMetadata: jest.Mock }).getEntityMetadata = getEntityMetadata;
      control.init(context, notifyOutputChanged);
      const { loaders } = control.updateView(context).props;

      const first = await loaders.loadFieldInfo('opportunity', ['budgetamount', 'notonthistable']);
      const second = await loaders.loadFieldInfo('opportunity', ['budgetamount', 'notonthistable']);

      expect(getEntityMetadata).toHaveBeenCalledTimes(1);
      expect(first.get('budgetamount')).toEqual({ displayName: 'Budget', isSecured: false });
      expect(second.get('notonthistable')).toEqual({});
    });

    it("reads stage field values from the grid's row and fetches only the missing columns", async () => {
      const recordId = '00000000-0000-0000-0000-000000000001';
      const row = {
        getRecordId: () => recordId,
        getNamedReference: () => ({ id: recordId, name: 'Deal', entityType: 'opportunity' }),
        getValue: jest.fn((c: string) => ({ budgetamount: 5000, closedate: null, isprivate: false } as Record<string, unknown>)[c]),
        getFormattedValue: jest.fn((c: string) => ({ budgetamount: '$5,000.00', isprivate: 'No' } as Record<string, string>)[c] ?? ''),
      };
      const records = context.parameters.records as unknown as Record<string, unknown>;
      records.records = { [recordId]: row };
      records.columns = [{ name: 'budgetamount' }, { name: 'closedate' }, { name: 'isprivate' }];
      (context.utils as unknown as { getEntityMetadata: jest.Mock }).getEntityMetadata = jest.fn().mockResolvedValue({
        Attributes: { get: (n: string) => (n === 'parentcontactid' ? { DisplayName: 'Contact', AttributeType: 6 } : { DisplayName: n, AttributeType: 14 }) },
      });
      const retrieveRecord = jest.fn().mockResolvedValue({
        _parentcontactid_value: 'guid',
        '_parentcontactid_value@OData.Community.Display.V1.FormattedValue': 'Jane Doe',
        x_offerlettersent: null,
      });
      (context.webAPI as unknown as { retrieveRecord: jest.Mock }).retrieveRecord = retrieveRecord;

      control.init(context, notifyOutputChanged);
      const { loaders } = control.updateView(context).props;
      const values = await loaders.loadRecordValues('opportunity', recordId, [
        'budgetamount', 'closedate', 'isprivate', 'parentcontactid', 'x_offerlettersent',
      ]);

      // From the dataset row
      expect(values.get('budgetamount')).toEqual({ hasValue: true, display: '$5,000.00' });
      expect(values.get('closedate')).toEqual({ hasValue: false, display: null });
      expect(values.get('isprivate')).toEqual({ hasValue: true, display: 'No' });
      expect(row.getValue).toHaveBeenCalledWith('budgetamount');
      // Only the two missing columns were requested; the lookup as _x_value
      expect(retrieveRecord).toHaveBeenCalledTimes(1);
      expect(retrieveRecord).toHaveBeenCalledWith('opportunity', recordId, '?$select=_parentcontactid_value,x_offerlettersent');
      expect(values.get('parentcontactid')).toEqual({ hasValue: true, display: 'Jane Doe' });
      expect(values.get('x_offerlettersent')).toEqual({ hasValue: false, display: null });
    });

    it('provides localized table names to the hover card', async () => {
      (context.utils as unknown as { getEntityMetadata: jest.Mock }).getEntityMetadata = jest
        .fn()
        .mockResolvedValue({ DisplayName: 'Potential Customer' });
      control.init(context, notifyOutputChanged);
      const { loaders } = control.updateView(context).props;
      await expect(loaders.loadTableName('lead')).resolves.toBe('Potential Customer');
    });

    it('ignores non-positive overdue thresholds', () => {
      (context.parameters as unknown as Record<string, unknown>).stageAgeWarningDays = { raw: 0 };
      control.init(context, notifyOutputChanged);
      expect(control.updateView(context).props.settings.stageAgeWarningDays).toBeNull();
    });
  });

  describe('getColors with custom colors', () => {
    it('uses custom colors when provided', () => {
      context.parameters.completedColor = { raw: '#FF0000' } as ComponentFramework.PropertyTypes.StringProperty;
      context.parameters.activeColor = { raw: '#00FF00' } as ComponentFramework.PropertyTypes.StringProperty;
      context.parameters.inactiveColor = { raw: '#0000FF' } as ComponentFramework.PropertyTypes.StringProperty;

      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      expect(element.props.colors.completed).toBe('#FF0000');
      expect(element.props.colors.active).toBe('#00FF00');
      expect(element.props.colors.inactive).toBe('#0000FF');
    });

    it('uses platform theme when available and enabled', () => {
      context.parameters.usePlatformTheme = { raw: 'yes' } as unknown as ComponentFramework.PropertyTypes.EnumProperty<string>;
      (context as unknown as { fluentDesignLanguage: unknown }).fluentDesignLanguage = {
        tokenTheme: {
          colorStatusSuccessBackground3: '#platform_completed',
          colorNeutralForegroundOnBrand: '#platform_text',
          colorBrandBackground: '#platform_active',
          colorNeutralBackground3: '#platform_inactive',
          colorNeutralForeground2: '#platform_inactive_text',
        },
      };

      control.init(context, notifyOutputChanged);
      const element = control.updateView(context);

      expect(element.props.colors.completed).toBe('#platform_completed');
      expect(element.props.colors.active).toBe('#platform_active');
    });
  });

  describe('getEntityDisplayName', () => {
    function createContextWithEntity(entityType: string) {
      const recordId = '00000000-0000-0000-0000-000000000001';
      const mockRecord = {
        getRecordId: () => recordId,
        getValue: jest.fn(),
        getFormattedValue: jest.fn().mockReturnValue('Test'),
        getNamedReference: jest.fn().mockReturnValue({
          id: recordId,
          name: 'Test',
          entityType,
        }),
      };

      return {
        ...context,
        parameters: {
          ...context.parameters,
          records: {
            ...context.parameters.records,
            sortedRecordIds: [recordId],
            records: { [recordId]: mockRecord },
            loading: false,
            columns: [{ name: 'name', isPrimary: true }],
          },
        },
      } as unknown as ComponentFramework.Context<IInputs>;
    }

    it('uses Dataverse metadata for entity display name when available', async () => {
      const metadataContext = { ...context };
      (metadataContext.utils as { getEntityMetadata: jest.Mock }).getEntityMetadata =
        jest.fn().mockResolvedValue({ DisplayName: 'Case' });

      control.init(metadataContext, notifyOutputChanged);
      const newContext = createContextWithEntity('incident');
      // Copy the metadata mock to the new context
      (newContext.utils as { getEntityMetadata: jest.Mock }).getEntityMetadata =
        jest.fn().mockResolvedValue({ DisplayName: 'Case' });
      control.updateView(newContext);
      await new Promise(resolve => setTimeout(resolve, 50));
      const element = control.updateView(newContext);
      expect(element.props.records.length).toBeGreaterThan(0);
      expect(element.props.records[0].entityDisplayName).toBe('Case');
    });

    it('falls back to camelCase splitter when metadata is unavailable', async () => {
      control.init(context, notifyOutputChanged);
      const newContext = createContextWithEntity('incident');
      control.updateView(newContext);
      await new Promise(resolve => setTimeout(resolve, 50));
      const element = control.updateView(newContext);
      expect(element.props.records.length).toBeGreaterThan(0);
      expect(element.props.records[0].entityDisplayName).toBe('Incident');
    });

    it('capitalizes simple entity names like "lead"', async () => {
      control.init(context, notifyOutputChanged);
      const newContext = createContextWithEntity('lead');
      control.updateView(newContext);
      await new Promise(resolve => setTimeout(resolve, 50));
      const element = control.updateView(newContext);
      expect(element.props.records.length).toBeGreaterThan(0);
      expect(element.props.records[0].entityDisplayName).toBe('Lead');
    });

    it('splits camelCase entity names', async () => {
      control.init(context, notifyOutputChanged);
      const newContext = createContextWithEntity('customEntity');
      control.updateView(newContext);
      await new Promise(resolve => setTimeout(resolve, 50));
      const element = control.updateView(newContext);
      expect(element.props.records.length).toBeGreaterThan(0);
      expect(element.props.records[0].entityDisplayName).toBe('Custom Entity');
    });

    it('splits underscored entity names', async () => {
      control.init(context, notifyOutputChanged);
      const newContext = createContextWithEntity('my_custom_entity');
      control.updateView(newContext);
      await new Promise(resolve => setTimeout(resolve, 50));
      const element = control.updateView(newContext);
      expect(element.props.records.length).toBeGreaterThan(0);
      expect(element.props.records[0].entityDisplayName).toBe('My Custom Entity');
    });
  });
});
