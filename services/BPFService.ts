/**
 * Optimized BPF Service
 * 
 * Optimizations:
 * 1. Batch requests - fetch multiple BPF instances in single call using $filter with OR
 * 2. Cache stage definitions - stages don't change, cache for 5 minutes
 * 3. Parallel fetching - use Promise.all for concurrent requests
 * 4. Select only needed columns - reduce payload size
 * 5. Retry logic - handle transient failures
 */

import {
  IBPFConfiguration,
  IBPFDefinition,
  IBPFInstance,
  IBPFStage,
  IProcessStageResponse,
  IBPFInstanceResponse,
  IWorkflowResponse,
  ICachedStages,
  WebApiClient,
} from '../types';
import { BPFError, ErrorCodes } from '../utils/errorMessages';
import { isValidEntityName, isValidFieldName, isValidGuid, escapeODataValue } from '../utils/sanitize';
import { createLogger } from '../utils/logger';
import type { PerfTracker } from '../utils/perfTracker';
import { parseStageSteps, getProcessStatus, collectRelatedRecordIds, isEmptyValue, formatRawValue } from '../utils/stageDetails';
import { getActiveStageId, getFieldsForStage, normGuid, parseDefinition } from '../utils/processDefinition';
import type { IStageStep, IFieldValue, IBPFInstance as IInstance } from '../types';

const log = createLogger('[BPFService]');

// Request timeout (30 seconds)
const REQUEST_TIMEOUT_MS = 30 * 1000;

// Cache timeout (5 minutes)
const CACHE_TIMEOUT_MS = 5 * 60 * 1000;

// Stage category labels are cosmetic: give up quickly and retry later
const CATEGORY_LABELS_TIMEOUT_MS = 5 * 1000;
const CATEGORY_LABELS_FAILURE_TTL_MS = 60 * 1000;

/**
 * Option set metadata response from Dataverse
 */
interface OptionMetadata {
  Value: number;
  Label: {
    LocalizedLabels: Array<{
      Label: string;
      LanguageCode: number;
    }>;
    UserLocalizedLabel: {
      Label: string;
    };
  };
}

interface AttributeMetadataResponse {
  OptionSet: {
    Options: OptionMetadata[];
  };
}

// Max records per batch (keep it reasonable)
const BATCH_SIZE = 10;

// Record field values are shown in hover cards; keep them fresher than stage metadata
const RECORD_VALUES_CACHE_MS = 60 * 1000;

/** Map a processstage response row to an IBPFStage */
function toStage(stage: IProcessStageResponse, index: number, categoryLabels: Map<number, string>): IBPFStage {
  const mapped: IBPFStage = {
    stageId: stage.processstageid,
    stageName: stage.stagename,
    stageCategory: stage.stagecategory,
    stageCategoryName: categoryLabels.get(stage.stagecategory) || stage.stagename,
    stageOrder: index,
    isActive: false,
    isCompleted: false,
  };
  if (stage.primaryentitytypecode) {
    mapped.entityName = stage.primaryentitytypecode;
  }
  if (typeof stage.clientdata === 'string' && stage.clientdata) {
    // Kept raw: parsed only if the hover card falls back to it
    mapped.clientData = stage.clientdata;
  }
  return mapped;
}

export class BPFService {
  private webApi: WebApiClient;
  private clientUrl: string;
  private stageCache: Map<string, ICachedStages> = new Map();
  private workflowCache: Map<string, string> = new Map(); // bpfEntityName -> processId
  private pendingRequests: Map<string, Promise<IBPFInstance | null>> = new Map();
  private categoryLabelsCache: Map<number, string> | null = null;
  private categoryLabelsCacheTime = 0;
  private categoryLabelsFailed = false;
  private categoryLabelsPending: Promise<Map<number, string>> | null = null;
  private activePathCache: Map<string, { stages: IBPFStage[]; timestamp: number }> = new Map();
  private stageStepsCache: Map<string, Promise<IStageStep[]>> = new Map();
  /** workflow id -> parsed process definition (workflow.clientdata) */
  private definitionCache: Map<string, Promise<unknown>> = new Map();
  private recordValuesCache: Map<string, { promise: Promise<Map<string, IFieldValue>>; timestamp: number }> = new Map();

  constructor(webApi: WebApiClient, clientUrl: string = '') {
    this.webApi = webApi;
    this.clientUrl = clientUrl;
  }

  /**
   * OPTIMIZED: Fetch BPF data for multiple records in batched calls
   * Instead of N calls for N records, we make ceil(N/BATCH_SIZE) calls
   *
   * @param recordIds - Array of record IDs to fetch BPF data for
   * @param config - BPF configuration
   * @param signal - Optional AbortSignal for request cancellation
   */
  public async getBPFDataForRecords(
    recordIds: string[],
    config: IBPFConfiguration,
    signal?: AbortSignal,
    perf?: PerfTracker
  ): Promise<Map<string, IBPFInstance | null>> {
    const results = new Map<string, IBPFInstance | null>();

    if (recordIds.length === 0 || config.bpfs.length === 0) {
      return results;
    }

    // Process each BPF definition
    for (const bpfDef of config.bpfs) {
      // Check if cancelled
      if (signal?.aborted) {
        throw new Error('Request cancelled');
      }

      try {
        // Fetch BPF instances in batches
        const label = `fetchBPF:${bpfDef.bpfEntitySchemaName}`;
        perf?.mark(label);
        const batchResults = await this.fetchBPFInstancesBatched(
          recordIds,
          bpfDef,
          signal,
          perf
        );
        perf?.measure(label);

        // Merge results (first match wins)
        for (const [recordId, instance] of batchResults) {
          if (!results.has(recordId) || results.get(recordId) === null) {
            results.set(recordId, instance);
          }
        }
      } catch (error) {
        log.warn(`Error fetching from ${bpfDef.bpfEntitySchemaName}:`, error);
      }
    }

    // Set null for records without BPF
    for (const recordId of recordIds) {
      if (!results.has(recordId)) {
        results.set(recordId, null);
      }
    }

    return results;
  }

  /**
   * OPTIMIZED: Batch fetch BPF instances using $filter with OR conditions
   */
  private async fetchBPFInstancesBatched(
    recordIds: string[],
    bpfDef: IBPFDefinition,
    signal?: AbortSignal,
    perf?: PerfTracker
  ): Promise<Map<string, IBPFInstance | null>> {
    const results = new Map<string, IBPFInstance | null>();
    const { bpfEntitySchemaName, lookupFieldSchemaName } = bpfDef;

    // Validate entity name and lookup field name
    if (!isValidEntityName(bpfEntitySchemaName)) {
      throw new BPFError(
        `Invalid BPF entity name: ${bpfEntitySchemaName}`,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    if (!isValidFieldName(lookupFieldSchemaName)) {
      throw new BPFError(
        `Invalid lookup field name: ${lookupFieldSchemaName}`,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // Check if cancelled
    if (signal?.aborted) {
      throw new Error('Request cancelled');
    }

    // Validate all record IDs upfront
    const validRecordIds = recordIds.filter(id => {
      if (!isValidGuid(id)) {
        log.warn(`Skipping invalid GUID: ${id}`);
        return false;
      }
      return true;
    });

    if (validRecordIds.length === 0) {
      return results;
    }

    // Build all batch queries
    const batchPromises: Promise<{ entities: ComponentFramework.WebApi.Entity[] }>[] = [];
    for (let i = 0; i < validRecordIds.length; i += BATCH_SIZE) {
      const batch = validRecordIds.slice(i, i + BATCH_SIZE);
      const filterConditions = batch
        .map(id => `${lookupFieldSchemaName} eq ${id}`)
        .join(' or ');

      batchPromises.push(
        this.fetchWithTimeout(
          this.webApi.retrieveMultipleRecords(
            bpfEntitySchemaName,
            `?$filter=${filterConditions}&$orderby=createdon desc&$top=5000`
          ),
          REQUEST_TIMEOUT_MS,
          signal
        )
      );
    }

    // Fetch BPF instances and category labels in parallel
    // (category labels are needed for active path stage name resolution)
    perf?.mark('parallel:instances+categoryLabels');
    const [categoryLabels, ...batchResponses] = await Promise.all([
      this.getStageCategoryLabels(signal),
      ...batchPromises,
    ]);
    perf?.measure('parallel:instances+categoryLabels');

    // Collect all unique BPF instances grouped by parent record ID
    const instancesByRecord = new Map<string, IBPFInstanceResponse>();
    for (const response of batchResponses) {
      for (const entity of response.entities) {
        const recordId = entity[lookupFieldSchemaName] as string;
        if (recordId && !instancesByRecord.has(recordId)) {
          instancesByRecord.set(recordId, entity as IBPFInstanceResponse);
        }
      }
    }

    if (instancesByRecord.size === 0) {
      return results;
    }

    // Fetch active path for each instance in parallel using RetrieveActivePath
    perf?.mark('retrieveActivePaths');
    const activePathEntries = await Promise.all(
      [...instancesByRecord.entries()].map(async ([recordId, bpfRecord]) => {
        const instanceId = bpfRecord.businessprocessflowinstanceid as string;
        if (!instanceId) return { recordId, stages: null as IBPFStage[] | null };

        try {
          const stages = await this.retrieveActivePath(instanceId, categoryLabels, signal);
          return { recordId, stages };
        } catch (error) {
          log.warn(`RetrieveActivePath failed for instance ${instanceId}, will use fallback:`, error);
          return { recordId, stages: null as IBPFStage[] | null };
        }
      })
    );
    perf?.measure('retrieveActivePaths');

    // For any instances where RetrieveActivePath failed, fall back to all stages
    const needsFallback = activePathEntries.some(entry => entry.stages === null);
    let fallbackStages: IBPFStage[] | null = null;
    if (needsFallback) {
      perf?.mark('fallback:getProcessStages');
      try {
        fallbackStages = await this.getProcessStages(bpfEntitySchemaName, signal, perf);
      } catch (error) {
        log.warn('Fallback getProcessStages also failed:', error);
        fallbackStages = [];
      }
      perf?.measure('fallback:getProcessStages');
    }

    // Map each instance using its active-path stages (or fallback)
    for (const { recordId, stages: activePathStages } of activePathEntries) {
      try {
        const bpfRecord = instancesByRecord.get(recordId)!;
        const stageDefinitions = activePathStages || fallbackStages || [];
        if (stageDefinitions.length === 0) continue;

        const instance = this.mapToBPFInstance(bpfRecord, bpfEntitySchemaName, stageDefinitions);
        results.set(recordId, instance);
      } catch (error) {
        log.warn(`Instance mapping error for record ${recordId}:`, error);
      }
    }

    return results;
  }

  /**
   * Map raw response to IBPFInstance
   */
  private mapToBPFInstance(
    bpfRecord: IBPFInstanceResponse,
    bpfEntityName: string,
    stageDefinitions: IBPFStage[]
  ): IBPFInstance {
    const traversedPath = (bpfRecord.traversedpath as string) || '';
    // GUIDs in traversedpath / stage ids can differ in braces or case
    const traversedStageIds = new Set(traversedPath.split(',').map(normGuid).filter(Boolean));
    const stageIds = new Set(stageDefinitions.map(s => normGuid(s.stageId)));
    // Active stage: the instance's activestageid when the traversed path confirms
    // it (D365's own BPF bar follows activestageid); otherwise the path's last
    // entry when it's a stage on this path; otherwise activestageid as-is.
    // Normally all three agree; they differ if activestageid was changed without
    // the path (integrations) or the path wasn't trimmed on "Back".
    const declared = normGuid(bpfRecord._activestageid_value as string) || null;
    const lastTraversed = getActiveStageId(traversedPath);
    const activeKey =
      declared && stageIds.has(declared) && traversedStageIds.has(declared)
        ? declared
        : lastTraversed && stageIds.has(lastTraversed)
          ? lastTraversed
          : declared;
    const activeStage = stageDefinitions.find(s => normGuid(s.stageId) === activeKey);
    const activeStageId = activeStage?.stageId ?? ((bpfRecord._activestageid_value as string) || null);
    const isFinished = (bpfRecord.statuscode as number) === 2;

    // Map stages with completion status
    // When the BPF is finished (statuscode 2 = Inactive/Finished), all stages
    // including the last one are marked as completed with no active stage
    const stages = stageDefinitions.map((stage, index) => {
      const key = normGuid(stage.stageId);
      const isActive = !isFinished && key === activeKey;
      const isCompleted = isFinished
        ? traversedStageIds.has(key) || key === activeKey
        : traversedStageIds.has(key) && !isActive;

      return {
        ...stage,
        isActive,
        isCompleted,
        stageOrder: index,
      };
    });

    // Resolve process name: OOTB BPFs use "name", custom BPFs use "{prefix}_name" (e.g. "bpf_name")
    const processName = (bpfRecord.name as string)
      || Object.keys(bpfRecord).filter(k => /^[a-z]+_name$/i.test(k)).map(k => bpfRecord[k] as string).find(Boolean)
      || bpfEntityName;

    const str = (key: string): string | null => {
      const value = bpfRecord[key];
      return typeof value === 'string' && value ? value : null;
    };

    return {
      processId: bpfRecord.businessprocessflowinstanceid as string || '',
      processName,
      bpfEntityName,
      activeStageId,
      traversedPath,
      statusCode: bpfRecord.statuscode as number || 0,
      stages,
      processStatus: getProcessStatus(bpfRecord.statuscode as number),
      createdOn: str('createdon'),
      modifiedOn: str('modifiedon'),
      completedOn: str('completedon'),
      activeStageStartedOn: str('activestagestartedon'),
      modifiedByName: str('_modifiedby_value@OData.Community.Display.V1.FormattedValue'),
      relatedRecordIds: collectRelatedRecordIds(bpfRecord),
      processDefinitionId: (bpfRecord._processid_value as string) || null,
    };
  }

  /**
   * OPTIMIZED: Get process stages with caching
   * Stage definitions rarely change, so we cache them for 5 minutes
   */
  private async getProcessStages(bpfEntitySchemaName: string, signal?: AbortSignal, perf?: PerfTracker): Promise<IBPFStage[]> {
    // Check cache
    const cached = this.stageCache.get(bpfEntitySchemaName);
    if (cached && Date.now() - cached.timestamp < CACHE_TIMEOUT_MS) {
      perf?.mark('getProcessStages', true);
      perf?.measure('getProcessStages');
      return cached.stages;
    }

    // Check if cancelled
    if (signal?.aborted) {
      throw new Error('Request cancelled');
    }

    try {
      // OPTIMIZED: Fetch processId and category labels in parallel (both are independent)
      perf?.mark('parallel:processId+categoryLabels');
      const [processId, categoryLabels] = await Promise.all([
        this.getProcessId(bpfEntitySchemaName, signal),
        this.getStageCategoryLabels(signal),
      ]);
      perf?.measure('parallel:processId+categoryLabels');

      if (!processId) {
        return [];
      }

      // Fetch stages (depends on processId)
      perf?.mark('query:processstage');
      const response = await this.fetchWithTimeout(
        this.webApi.retrieveMultipleRecords(
          'processstage',
          `?$filter=_processid_value eq ${processId}&$select=processstageid,stagename,stagecategory&$orderby=stagecategory asc&$top=100`
        ),
        REQUEST_TIMEOUT_MS,
        signal
      );
      perf?.measure('query:processstage');

      const stages: IBPFStage[] = (response.entities as IProcessStageResponse[]).map(
        (stage, index) => toStage(stage, index, categoryLabels)
      );

      // Cache the results
      this.stageCache.set(bpfEntitySchemaName, {
        stages,
        timestamp: Date.now(),
        processId,
      });

      return stages;

    } catch (error) {
      log.error(`Failed to get stages for ${bpfEntitySchemaName}:`, error);
      throw new BPFError(
        `Failed to load process flow stages for ${bpfEntitySchemaName}`,
        ErrorCodes.STAGE_NOT_FOUND,
        error
      );
    }
  }

  /**
   * OPTIMIZED: Get workflow process ID with caching
   */
  private async getProcessId(bpfEntitySchemaName: string, signal?: AbortSignal): Promise<string | null> {
    // Validate entity name
    if (!isValidEntityName(bpfEntitySchemaName)) {
      throw new BPFError(
        `Invalid BPF entity name: ${bpfEntitySchemaName}`,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // Check cache
    if (this.workflowCache.has(bpfEntitySchemaName)) {
      return this.workflowCache.get(bpfEntitySchemaName)!;
    }

    // Check if cancelled
    if (signal?.aborted) {
      throw new Error('Request cancelled');
    }

    try {
      // Single query: exact match OR contains (covers BPFs with different uniquename)
      // category eq 4 means Business Process Flow
      const escapedName = escapeODataValue(bpfEntitySchemaName);
      const response = await this.fetchWithTimeout(
        this.webApi.retrieveMultipleRecords(
          'workflow',
          `?$filter=(uniquename eq '${escapedName}' or contains(uniquename,'${escapedName}')) and category eq 4&$select=workflowid,name,uniquename&$top=5`
        ),
        REQUEST_TIMEOUT_MS,
        signal
      );

      if (response.entities && response.entities.length > 0) {
        // Prefer exact match over contains match
        const workflows = response.entities as (IWorkflowResponse & { uniquename?: string })[];
        const exactMatch = workflows.find(w => w.uniquename === bpfEntitySchemaName);
        const processId = (exactMatch || workflows[0]).workflowid;
        this.workflowCache.set(bpfEntitySchemaName, processId);
        return processId;
      }

      return null;

    } catch (error) {
      log.error(`Failed to get process ID for ${bpfEntitySchemaName}:`, error);
      throw new BPFError(
        `Failed to fetch workflow definition for ${bpfEntitySchemaName}`,
        ErrorCodes.FETCH_FAILED,
        error
      );
    }
  }

  /**
   * OPTIMIZED: Fetch stage category labels from Dataverse metadata with caching
   *
   * Retrieves localized labels for the processstage.stagecategory option set.
   * This supports multi-language environments and custom category names.
   *
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Map of category number to localized label
   */
  private getStageCategoryLabels(_signal?: AbortSignal): Promise<Map<number, string>> {
    // Check cache (metadata rarely changes, cache for 5 minutes; failures for 1 minute)
    const ttl = this.categoryLabelsFailed ? CATEGORY_LABELS_FAILURE_TTL_MS : CACHE_TIMEOUT_MS;
    if (this.categoryLabelsCache && Date.now() - this.categoryLabelsCacheTime < ttl) {
      return Promise.resolve(this.categoryLabelsCache);
    }

    // Share one in-flight request between all records. It is deliberately not
    // tied to a per-dataset AbortSignal: it's global metadata, and cancelling it
    // mid-flight used to cache an empty result.
    if (this.categoryLabelsPending) {
      return this.categoryLabelsPending;
    }

    this.categoryLabelsPending = this.loadStageCategoryLabels().finally(() => {
      this.categoryLabelsPending = null;
    });
    return this.categoryLabelsPending;
  }

  private async loadStageCategoryLabels(): Promise<Map<number, string>> {
    try {
      // Fetch attribute metadata for stagecategory field
      // Using Web API: GET [Organization URI]/api/data/v9.2/EntityDefinitions(LogicalName='processstage')/Attributes(LogicalName='stagecategory')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet
      // Labels are cosmetic (stage names are the fallback), so never let this
      // call hold up a record for long.
      const response = await this.fetchWithTimeout(
        this.webApi.retrieveRecord(
          'EntityDefinitions(LogicalName=\'processstage\')/Attributes(LogicalName=\'stagecategory\')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
          '',
          '?$select=LogicalName&$expand=OptionSet'
        ),
        CATEGORY_LABELS_TIMEOUT_MS
      ) as AttributeMetadataResponse;

      const categoryMap = new Map<number, string>();

      // Extract localized labels from option set
      if (response.OptionSet?.Options) {
        for (const option of response.OptionSet.Options) {
          const label = option.Label?.UserLocalizedLabel?.Label ||
                       option.Label?.LocalizedLabels?.[0]?.Label ||
                       'Custom';
          categoryMap.set(option.Value, label);
        }
      }

      // Cache the results
      this.categoryLabelsCache = categoryMap;
      this.categoryLabelsCacheTime = Date.now();
      this.categoryLabelsFailed = false;

      return categoryMap;

    } catch (error) {
      log.warn('Failed to fetch category labels from metadata, using stage names as fallback:', error);

      // Return the last good map (or an empty one); retry after a short TTL
      if (!this.categoryLabelsCache || this.categoryLabelsFailed) {
        this.categoryLabelsCache = this.categoryLabelsCache ?? new Map<number, string>();
        this.categoryLabelsFailed = true;
      }
      this.categoryLabelsCacheTime = Date.now();

      return this.categoryLabelsCache;
    }
  }

  /**
   * Fetch the active path stages for a specific BPF instance using
   * the Dataverse RetrieveActivePath unbound function.
   *
   * This is critical for BPFs with conditional branching — only the
   * stages in the active path should be displayed, not all stages
   * defined in the process.
   *
   * Falls back to null if the function is unavailable so callers
   * can use getProcessStages() as a fallback.
   */
  private async retrieveActivePath(
    instanceId: string,
    categoryLabels: Map<number, string>,
    signal?: AbortSignal
  ): Promise<IBPFStage[]> {
    if (!isValidGuid(instanceId)) {
      throw new BPFError('Invalid BPF instance ID', ErrorCodes.VALIDATION_ERROR);
    }

    // Check cache
    const cached = this.activePathCache.get(instanceId);
    if (cached && Date.now() - cached.timestamp < CACHE_TIMEOUT_MS) {
      return cached.stages;
    }

    if (signal?.aborted) {
      throw new Error('Request cancelled');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Forward parent signal's abort
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const url = `${this.clientUrl}/api/data/v9.2/RetrieveActivePath(ProcessInstanceId=${instanceId})`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new BPFError(
          `RetrieveActivePath failed: ${response.status} ${response.statusText}`,
          ErrorCodes.FETCH_FAILED
        );
      }

      const data = await response.json();
      const stages: IBPFStage[] = ((data.value || []) as IProcessStageResponse[]).map(
        (stage, index) => toStage(stage, index, categoryLabels)
      );

      // Cache the result
      this.activePathCache.set(instanceId, { stages, timestamp: Date.now() });
      return stages;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get BPF data for a single record (with deduplication)
   * Used for lazy loading individual records
   */
  public async getBPFDataForRecord(
    recordId: string,
    entityName: string,
    config: IBPFConfiguration,
    options: { throwOnError?: boolean; signal?: AbortSignal; perf?: PerfTracker } = {}
  ): Promise<IBPFInstance | null> {
    const throwOnError = options.throwOnError === true;

    // Check if already fetching this record
    const pendingKey = `${entityName}_${recordId}_${throwOnError ? 'strict' : 'lenient'}`;
    if (this.pendingRequests.has(pendingKey)) {
      return this.pendingRequests.get(pendingKey)!;
    }

    // Create the request
    const request = this.fetchSingleRecord(recordId, config, throwOnError, options.signal, options.perf);
    this.pendingRequests.set(pendingKey, request);

    try {
      const result = await request;
      return result;
    } finally {
      this.pendingRequests.delete(pendingKey);
    }
  }

  /**
   * Fetch single record (internal)
   */
  private async fetchSingleRecord(
    recordId: string,
    config: IBPFConfiguration,
    throwOnError = false,
    signal?: AbortSignal,
    perf?: PerfTracker
  ): Promise<IBPFInstance | null> {
    let lastError: unknown = null;
    let anySucceeded = false;

    for (const bpfDef of config.bpfs) {
      try {
        const label = `fetchBPF:${bpfDef.bpfEntitySchemaName}`;
        perf?.mark(label);
        const results = await this.fetchBPFInstancesBatched([recordId], bpfDef, signal, perf);
        perf?.measure(label);
        anySucceeded = true;
        const instance = results.get(recordId);
        if (instance) {
          return instance;
        }
      } catch (error) {
        if (signal?.aborted) throw error; // cancelled: don't try the next definition
        lastError = error;
        log.warn(`Error fetching single record:`, error);
      }
    }

    // Strict mode: surface the failure only when no BPF definition could be
    // queried at all (a clean "not found" in any definition still means null).
    if (throwOnError && !anySucceeded && lastError) {
      throw lastError;
    }
    return null;
  }

  /**
   * Wrap a promise with a timeout and optional abort signal to prevent indefinite hangs.
   * When the timeout fires or the signal is aborted, the race rejects immediately
   * so callers don't have to wait for the underlying (non-cancellable) WebAPI call.
   */
  private fetchWithTimeout<T>(promise: Promise<T>, timeoutMs: number = REQUEST_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new BPFError('Request timed out', ErrorCodes.TIMEOUT)),
        timeoutMs
      );

      if (signal) {
        if (signal.aborted) {
          reject(new Error('Request cancelled'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(new Error('Request cancelled'));
        }, { once: true });
      }
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
    });
  }

  /**
   * Every field of a stage, for the hover card — read from the BPF's process
   * definition (workflow.clientdata), where the stage is found by stageId
   * (GUIDs normalized) anywhere in the nested tree. Works for any stage,
   * including ones the record hasn't reached yet.
   *
   * The workflow is the instance's _processid_value, or else the workflow of
   * the instance's BPF table. If the definition can't be read or doesn't
   * contain the stage, falls back to the stage's own processstage.clientdata.
   * Rejects only when neither source can be loaded.
   */
  public async getStageSteps(stage: IBPFStage, instance?: Pick<IInstance, 'processDefinitionId' | 'bpfEntityName'>): Promise<IStageStep[]> {
    let processId = normGuid(instance?.processDefinitionId) || null;
    if (!processId && instance?.bpfEntityName) {
      processId = normGuid(await this.getProcessId(instance.bpfEntityName).catch(() => null)) || null;
    }

    if (processId && isValidGuid(processId)) {
      try {
        const definition = await this.getProcessDefinition(processId);
        const fields = getFieldsForStage(definition, stage.stageId);
        if (fields) return fields;
        log.warn(`Stage ${stage.stageId} not found in process definition ${processId}; using processstage`);
      } catch (error) {
        log.warn(`Process definition ${processId} unavailable; using processstage:`, error);
      }
    }

    return this.getStageStepsFromProcessStage(stage);
  }

  /** Parsed workflow.clientdata for a BPF, fetched once per workflow (failures not cached) */
  private getProcessDefinition(processId: string): Promise<unknown> {
    const cached = this.definitionCache.get(processId);
    if (cached) return cached;

    const request = this.fetchWithTimeout(
      this.webApi.retrieveRecord('workflow', processId, '?$select=clientdata'),
      REQUEST_TIMEOUT_MS
    )
      .then(entity => {
        const definition = parseDefinition((entity as { clientdata?: string | null }).clientdata);
        if (!definition) throw new BPFError('Process definition has no clientdata', ErrorCodes.STAGE_NOT_FOUND);
        return definition;
      })
      .catch(error => {
        this.definitionCache.delete(processId);
        throw error;
      });

    this.definitionCache.set(processId, request);
    return request;
  }

  /** Fallback: a stage's own processstage.clientdata (cached per stage) */
  private getStageStepsFromProcessStage(stage: IBPFStage): Promise<IStageStep[]> {
    if (stage.steps) {
      return Promise.resolve(stage.steps);
    }
    if (stage.clientData) {
      return Promise.resolve(parseStageSteps(stage.clientData));
    }
    if (!isValidGuid(normGuid(stage.stageId))) {
      return Promise.resolve([]);
    }

    const cached = this.stageStepsCache.get(stage.stageId);
    if (cached) return cached;

    const request = this.fetchWithTimeout(
      this.webApi.retrieveRecord('processstage', normGuid(stage.stageId), '?$select=clientdata,primaryentitytypecode'),
      REQUEST_TIMEOUT_MS
    )
      .then(entity => parseStageSteps((entity as IProcessStageResponse).clientdata))
      .catch(error => {
        log.warn(`Failed to load steps for stage ${stage.stageId}:`, error);
        // Don't cache failures — allow a retry on next hover. Rethrow so the
        // card can say it couldn't load, instead of claiming "no fields".
        this.stageStepsCache.delete(stage.stageId);
        throw error;
      });

    this.stageStepsCache.set(stage.stageId, request);
    return request;
  }

  /**
   * Current values of specific columns on a record — only the columns asked
   * for, never the whole record. Each column is { field, select, attributeType }
   * where `select` is the Web API name (`_x_value` for lookups).
   *
   * One request for all columns; if that fails (e.g. one bad column), each
   * column is retried on its own, so one failure doesn't hide the others.
   * A column whose type is unknown is also retried as a lookup. Columns that
   * still fail come back as { failed: true }. Cached briefly per column set.
   */
  public getRecordColumns(
    entityName: string,
    recordId: string,
    columns: Array<{ field: string; select: string; attributeType?: string }>
  ): Promise<Map<string, IFieldValue>> {
    const failedAll = () => new Map(columns.map(c => [c.field.toLowerCase(), { hasValue: false, display: null, failed: true }]));
    const id = normGuid(recordId);
    if (!isValidEntityName(entityName) || !isValidGuid(id) || columns.length === 0) {
      return Promise.resolve(columns.length ? failedAll() : new Map());
    }

    const key = `${entityName}:${id}:${columns.map(c => c.select.toLowerCase()).sort().join(',')}`;
    const cached = this.recordValuesCache.get(key);
    if (cached && Date.now() - cached.timestamp < RECORD_VALUES_CACHE_MS) {
      return cached.promise;
    }

    const read = (entity: Record<string, unknown>, select: string, attributeType?: string): IFieldValue => {
      const raw = entity[select];
      const formatted = entity[`${select}@OData.Community.Display.V1.FormattedValue`];
      const hasValue = !isEmptyValue(raw);
      const display = typeof formatted === 'string' && formatted
        ? formatted
        : hasValue && !/^_.+_value$/.test(select) ? formatRawValue(raw, attributeType) || null : null;
      return { hasValue, display };
    };

    const fetchColumns = (selects: string[]) =>
      this.fetchWithTimeout(
        this.webApi.retrieveRecord(entityName, id, `?$select=${selects.join(',')}`),
        REQUEST_TIMEOUT_MS
      ) as Promise<Record<string, unknown>>;

    const promise = (async () => {
      const result = new Map<string, IFieldValue>();
      const valid = columns.filter(c => isValidFieldName(c.select));
      for (const c of columns) {
        if (!valid.includes(c)) result.set(c.field.toLowerCase(), { hasValue: false, display: null, failed: true });
      }
      if (valid.length === 0) return result;

      try {
        const entity = await fetchColumns(valid.map(c => c.select));
        for (const c of valid) result.set(c.field.toLowerCase(), read(entity, c.select, c.attributeType));
        return result;
      } catch (error) {
        // Only a bad column (400) is worth retrying column by column; for no
        // access, timeouts or network errors every retry would fail the same way
        if (!isBadColumnError(error)) {
          log.warn(`Column load failed for ${entityName} ${id}:`, error);
          for (const c of valid) result.set(c.field.toLowerCase(), { hasValue: false, display: null, failed: true });
          return result;
        }
        log.warn(`Batch column load failed for ${entityName} ${id}; retrying per column:`, error);
      }

      await Promise.all(
        valid.map(async c => {
          const candidates = [c.select];
          // Type unknown and plain name failed: it may be a lookup
          if (!c.attributeType && !/^_.+_value$/.test(c.select)) candidates.push(`_${c.select}_value`);
          for (const select of candidates) {
            try {
              const entity = await fetchColumns([select]);
              result.set(c.field.toLowerCase(), read(entity, select, c.attributeType));
              return;
            } catch {
              // try the next form
            }
          }
          log.warn(`Couldn't load ${entityName}.${c.field}`);
          result.set(c.field.toLowerCase(), { hasValue: false, display: null, failed: true });
        })
      );
      return result;
    })().then(result => {
      // Never keep a failure: the next hover retries any field that couldn't load
      if ([...result.values()].some(v => v.failed)) this.recordValuesCache.delete(key);
      return result;
    });

    this.recordValuesCache.set(key, { promise, timestamp: Date.now() });
    return promise;
  }

  /**
   * Clear all caches
   */
  public clearCache(): void {
    this.stageStepsCache.clear();
    this.definitionCache.clear();
    this.recordValuesCache.clear();
    this.stageCache.clear();
    this.workflowCache.clear();
    this.pendingRequests.clear();
    this.categoryLabelsCache = null;
    this.categoryLabelsCacheTime = 0;
    this.categoryLabelsFailed = false;
    this.activePathCache.clear();
  }

  /**
   * Clear cache for specific BPF
   */
  public clearCacheForBPF(bpfEntitySchemaName: string): void {
    this.stageCache.delete(bpfEntitySchemaName);
    this.workflowCache.delete(bpfEntitySchemaName);
    // Active path cache is per instance ID, not per BPF entity name,
    // so we clear all entries as we can't map instance -> BPF entity
    this.activePathCache.clear();
  }
}

/**
 * A Web API error caused by a column that doesn't exist / isn't selectable
 * (HTTP 400, "Could not find a property named ..."), as opposed to access,
 * timeout or network errors.
 */
export function isBadColumnError(error: unknown): boolean {
  const e = error as { status?: number; statusCode?: number; httpStatusCode?: number; errorCode?: number; message?: string } | null;
  if (!e) return false;
  if (e.status === 400 || e.statusCode === 400 || e.httpStatusCode === 400) return true;
  return /could not find a property|property named|not a valid|invalid column|\b400\b/i.test(String(e.message ?? error));
}
