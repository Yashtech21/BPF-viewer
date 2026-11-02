/**
 * BusinessProcessFlowViewer v2 - Type Definitions
 */

// ============================================
// Configuration Types
// ============================================

/**
 * Top-level BPF configuration parsed from the control's JSON parameter.
 * Defines which business process flows to query for each record.
 */
export interface IBPFConfiguration {
  bpfs: IBPFDefinition[];
}

/**
 * A single BPF definition mapping a BPF entity to its parent-record lookup field.
 *
 * @example
 * ```json
 * { "bpfEntitySchemaName": "opportunitysalesprocess", "lookupFieldSchemaName": "_opportunityid_value" }
 * ```
 */
export interface IBPFDefinition {
  /** Dataverse schema name of the BPF entity (e.g. "opportunitysalesprocess") */
  bpfEntitySchemaName: string;
  /** Schema name of the lookup field that links BPF instances to parent records */
  lookupFieldSchemaName: string;
}

// ============================================
// Design & Display Types
// ============================================

/** Visual design style for rendering BPF stages */
export type DesignStyle = 'modern' | 'chevron' | 'circles' | 'pills' | 'segmented' | 'stepper' | 'gradient' | 'line' | 'fraction';

/** Where a record opens when a row is clicked */
export type NavigationTarget = 'newWindow' | 'sameWindow' | 'dialog';

/** Row spacing preset */
export type Density = 'comfortable' | 'compact';

/** Lifecycle status of a BPF instance (derived from statuscode) */
export type ProcessStatus = 'active' | 'finished' | 'aborted' | 'unknown';

/** Whether stage labels show the stage name or the stage category name */
export type DisplayMode = 'stage' | 'category';

/** Font size preset for the record name header */
export type RecordNameSize = 'small' | 'medium' | 'large';

// ============================================
// Color Types
// ============================================

/**
 * Color palette applied to stage elements. When `usePlatformTheme` is enabled,
 * colors are derived from Fluent tokens; otherwise custom hex values are used.
 */
export interface IStageColors {
  /** Background color for completed stages */
  completed: string;
  /** Text color for completed stages */
  completedText: string;
  /** Background color for the active (current) stage */
  active: string;
  /** Text color for the active stage */
  activeText: string;
  /** Background color for inactive (future) stages */
  inactive: string;
  /** Text color for inactive stages and labels */
  inactiveText: string;
  /** Color for the progress track / connector lines */
  track: string;
}

// ============================================
// BPF Data Types
// ============================================

/**
 * A single stage within a business process flow.
 *
 * Note: stageCategoryName is fetched from Dataverse metadata and supports
 * localization and custom category names, so it's typed as string.
 */
export interface IBPFStage {
  /** Unique stage identifier (GUID) */
  stageId: string;
  /** Display name of the stage */
  stageName: string;
  /** Numeric category code (e.g. 0 = Qualify, 1 = Develop) */
  stageCategory: number;
  /** Localized category label from Dataverse metadata */
  stageCategoryName: string;
  /** Zero-based order of the stage within the process */
  stageOrder: number;
  /** Whether this stage is the currently active step */
  isActive: boolean;
  /** Whether this stage has been completed */
  isCompleted: boolean;
  /** Logical name of the entity this stage runs on (cross-entity BPFs), when known */
  entityName?: string;
  /**
   * Steps (fields) defined in the stage, parsed from processstage.clientdata.
   * Undefined means "not loaded yet" — they are fetched lazily on hover.
   */
  steps?: IStageStep[];
}

/** A single step (data field) inside a BPF stage */
export interface IStageStep {
  /** Logical name of the bound attribute, e.g. "budgetamount" (may be empty for non-field steps) */
  fieldName: string;
  /** Label shown in the BPF for this step */
  displayName: string;
  /** Whether the step is required to move to the next stage */
  isRequired: boolean;
}

/** Value of a record attribute as shown in a stage hover card */
export interface IFieldValue {
  hasValue: boolean;
  /** Formatted (display) value when available, otherwise a string form of the raw value */
  display: string | null;
}

/**
 * A resolved BPF instance with its stages, representing one record's
 * active business process flow.
 */
export interface IBPFInstance {
  /** BPF instance record ID (businessprocessflowinstanceid) */
  processId: string;
  /** Human-readable process name from the workflow definition */
  processName: string;
  /** Schema name of the BPF entity */
  bpfEntityName: string;
  /** GUID of the currently active stage, or null if none */
  activeStageId: string | null;
  /** Comma-separated list of traversed stage IDs */
  traversedPath: string;
  /** BPF instance status code (1 = Active, 2 = Finished, 3 = Aborted) */
  statusCode: number;
  /** Ordered array of stages with computed status */
  stages: IBPFStage[];
  /** Lifecycle status derived from statusCode */
  processStatus?: ProcessStatus;
  /** ISO timestamp the process instance was created (process started) */
  createdOn?: string | null;
  /** ISO timestamp the process instance was last modified */
  modifiedOn?: string | null;
  /** ISO timestamp the process was finished (only for finished processes) */
  completedOn?: string | null;
  /** ISO timestamp the current active stage was entered */
  activeStageStartedOn?: string | null;
  /** Display name of the user who last modified the process instance, if returned */
  modifiedByName?: string | null;
  /**
   * Record lookups on the BPF instance (attribute logical name → record id),
   * used to load values for stages that run on another table.
   */
  relatedRecordIds?: Record<string, string>;
}

// ============================================
// Record Types
// ============================================

/**
 * Combined record + BPF data passed to the UI layer for rendering.
 * Each entry represents one row in the dataset grid.
 */
export interface IRecordBPFData {
  /** Dataverse record ID */
  recordId: string;
  /** Primary name of the record */
  recordName: string;
  /** Logical entity name (e.g. "opportunity") */
  entityName: string;
  /** Localized entity display name (e.g. "Opportunity") */
  entityDisplayName: string;
  /** Resolved BPF instance, or null if not found / not applicable */
  bpfInstance: IBPFInstance | null;
  /** Whether BPF data is still being fetched for this record */
  isLoading: boolean;
  /** Error message if BPF fetch failed, or null */
  error: string | null;
}

// ============================================
// Component Props
// ============================================

/** Control-level settings derived from the PCF manifest parameters */
export interface IControlSettings {
  designStyle: DesignStyle;
  displayMode: DisplayMode;
  recordNameSize: RecordNameSize;
  showEntityName: boolean;
  enableNavigation: boolean;
  showPulseAnimation: boolean;
  usePlatformTheme: boolean;
  /** Show the rich stage details card when hovering/focusing a stage */
  enableStageDetails?: boolean;
  /** Show the search / filter / sort toolbar above the list */
  showToolbar?: boolean;
  /** Days in the active stage after which a record is flagged as overdue (null/0 = off) */
  stageAgeWarningDays?: number | null;
  /** Where a record opens when clicked */
  navigationTarget?: NavigationTarget;
  /** Row spacing */
  density?: Density;
}

/** Metadata about a field, used to label steps and interpret empty values */
export interface IFieldInfo {
  /** Localized display name from table metadata */
  displayName?: string;
  /** Field-level security is enabled on the column */
  isSecured?: boolean;
}

/** Async loaders used by stage hover cards (provided by the PCF host) */
export interface IStageDetailsLoaders {
  /** Localized display name of a table (e.g. "Lead"), cached by the host */
  loadTableName?: (entityName: string) => Promise<string>;
  /** Field metadata (display names, field security) for a table, cached by the host */
  loadFieldInfo?: (entityName: string, fieldNames: string[]) => Promise<Map<string, IFieldInfo>>;
  /** Resolve the steps for a stage (from clientdata), cached by the service */
  loadStageSteps?: (stage: IBPFStage) => Promise<IStageStep[]>;
  /** Load attribute values for a record so step completion can be shown */
  loadRecordValues?: (entityName: string, recordId: string) => Promise<Map<string, IFieldValue>>;
}

/** Props for the top-level BPFViewer component (without FluentProvider wrapper) */
export interface IBPFViewerProps {
  records: IRecordBPFData[];
  settings: IControlSettings;
  colors: IStageColors;
  isLoading: boolean;
  error: string | null;
  onNavigate?: (entityName: string, recordId: string) => void;
  onRefresh?: () => void;
  /** Loaders for lazily fetched stage details shown in hover cards */
  loaders?: IStageDetailsLoaders;
  /** Reference "now" (ms) — injectable for deterministic tests */
  now?: number;
}

interface IBPFRowBaseProps {
  record: IRecordBPFData;
  colors: IStageColors;
  isMobile: boolean;
  /** Reference "now" (ms) used to compute time in stage */
  now?: number;
  /** Loaders for lazily fetched stage details shown in hover cards */
  loaders?: IStageDetailsLoaders;
}

interface IBPFRowNavigableProps extends IBPFRowBaseProps {
  settings: IControlSettings & { enableNavigation: true };
  onNavigate: (entityName: string, recordId: string) => void;
}

interface IBPFRowStaticProps extends IBPFRowBaseProps {
  settings: IControlSettings & { enableNavigation: false };
  onNavigate?: undefined;
}

/**
 * Discriminated union props for BPFRow. When `enableNavigation` is true,
 * `onNavigate` is required; when false, it must be omitted.
 */
export type IBPFRowProps = IBPFRowNavigableProps | IBPFRowStaticProps;

/** Props passed to each design component for rendering BPF stages */
export interface IBPFDesignProps {
  /** Ordered stages to render */
  stages: IBPFStage[];
  /** Whether to show stage names or category names */
  displayMode: DisplayMode;
  /** Color palette for stage elements */
  colors: IStageColors;
  /** Whether to animate the active stage with a pulse effect */
  showPulse: boolean;
  /** Whether to use compact mobile layout */
  isMobile: boolean;
}

// ============================================
// Service Types
// ============================================

/** Configuration for the BPFService instance */
export interface IBPFServiceConfig {
  /** Dataverse WebApi client for making OData queries */
  webApi: ComponentFramework.WebApi;
  /** Cache timeout in milliseconds (default: 5 minutes) */
  cacheTimeout?: number;
}

/** A single batch request item pairing a record ID with a BPF definition */
export interface IBatchRequest {
  recordId: string;
  bpfDef: IBPFDefinition;
}

/** Cached process stages with TTL metadata */
export interface ICachedStages {
  stages: IBPFStage[];
  timestamp: number;
  processId: string;
}

// ============================================
// WebAPI Response Types
// ============================================

/** Raw Dataverse response shape for a process stage record */
export interface IProcessStageResponse {
  processstageid: string;
  stagename: string;
  stagecategory: number;
  _processid_value: string;
  /** JSON definition of the stage (steps/fields) — may be absent depending on the API */
  clientdata?: string | null;
  /** Logical name of the entity the stage belongs to */
  primaryentitytypecode?: string | null;
}

/** Raw Dataverse response shape for a BPF instance record (index signature for dynamic lookup fields) */
export interface IBPFInstanceResponse {
  [key: string]: unknown;
  businessprocessflowinstanceid?: string;
  name?: string;
  _activestageid_value?: string;
  traversedpath?: string;
  statuscode?: number;
  createdon?: string;
  modifiedon?: string;
  completedon?: string;
  activestagestartedon?: string;
}

/** Raw Dataverse response shape for a workflow definition record */
export interface IWorkflowResponse {
  workflowid: string;
  name: string;
  uniquename: string;
}

// ============================================
// Utility Types
// ============================================

/** Alias for the PCF WebApi client type */
export type WebApiClient = ComponentFramework.WebApi;

/**
 * Abstraction over PCF dataset records. The optional `getNamedReference()`
 * method is available at runtime but not always declared in PCF type definitions.
 */
export interface IDatasetRecord {
  getRecordId(): string;
  getFormattedValue(columnName: string): string;
  getValue(columnName: string): unknown;
  getNamedReference?(): {
    id: string;
    name: string;
    entityType: string;
  };
}
