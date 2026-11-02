/**
 * BPF Viewer Component
 *
 * Main wrapper component with FluentProvider for theming
 */

import * as React from 'react';
import { FluentProvider, webLightTheme, makeStyles, tokens, Spinner, Button, Theme } from '@fluentui/react-components';
import { ArrowClockwiseRegular, ErrorCircleRegular } from '@fluentui/react-icons';
import { IBPFViewerProps } from '../types';
import { BPFRow } from './BPFRow';
import {
  BPFToolbar,
  DEFAULT_LIST_VIEW,
  IListViewState,
  applyListView,
  getStageDistribution,
} from './BPFToolbar';
import { getAgeSeverity, getDaysInActiveStage } from '../utils/stageDetails';
import { ErrorBoundary } from './ErrorBoundary';
import type { ViewStore, IViewState } from '../utils/viewStore';

const MOBILE_BREAKPOINT = 480;

const useStyles = makeStyles({
  container: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    gap: '12px',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    gap: '12px',
    color: tokens.colorStatusDangerForeground1,
    textAlign: 'center',
  },
  errorIcon: {
    fontSize: '32px',
  },
  emptyContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    color: tokens.colorNeutralForeground2,
    textAlign: 'center',
    minHeight: '100px',
    fontSize: '14px',
  },
  recordsList: {
    display: 'flex',
    flexDirection: 'column',
  },
  noMatches: {
    padding: '24px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: '13px',
  },
});

// Hook to detect narrow container using ResizeObserver
// Works correctly inside Dataverse subgrids where the window is wide
// but the control container may be narrow
const useContainerMobile = (ref: React.RefObject<HTMLDivElement | null>): boolean => {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsMobile(entry.contentRect.width < MOBILE_BREAKPOINT);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return isMobile;
};

// Inner component (with Fluent context)
const BPFViewerInner: React.FC<IBPFViewerProps & { containerRef: React.RefObject<HTMLDivElement | null> }> = ({
  records,
  settings,
  colors,
  isLoading,
  error,
  onNavigate,
  onRefresh,
  loaders,
  now: nowProp,
  containerRef,
}) => {
  const styles = useStyles();
  const isMobile = useContainerMobile(containerRef);
  const [view, setView] = React.useState<IListViewState>(DEFAULT_LIST_VIEW);

  // One reference time per data refresh keeps rows memoizable
  const now = React.useMemo(() => nowProp ?? Date.now(), [nowProp, records]);

  const warningDays = settings.stageAgeWarningDays;
  const visibleRecords = React.useMemo(
    () => (settings.showToolbar ? applyListView(records, view, settings.displayMode, warningDays, now) : records),
    [records, view, settings.showToolbar, settings.displayMode, warningDays, now]
  );
  const overdueCount = React.useMemo(
    () =>
      records.filter(r => {
        const severity = getAgeSeverity(getDaysInActiveStage(r.bpfInstance, now), warningDays);
        return severity === 'warning' || severity === 'danger';
      }).length,
    [records, warningDays, now]
  );
  const distribution = React.useMemo(
    () => (settings.showToolbar ? getStageDistribution(records, settings.displayMode) : []),
    [records, settings.showToolbar, settings.displayMode]
  );

  // Global loading state
  if (isLoading && records.length === 0) {
    return (
      <div className={styles.loadingContainer} role="status" aria-live="polite">
        <Spinner size="medium" label="Loading records..." />
      </div>
    );
  }

  // Global error state
  if (error && records.length === 0) {
    return (
      <div className={styles.errorContainer} role="alert" aria-live="polite">
        <ErrorCircleRegular className={styles.errorIcon} />
        <div>{error}</div>
        {onRefresh && (
          <Button
            appearance="secondary"
            icon={<ArrowClockwiseRegular />}
            onClick={onRefresh}
            aria-label="Retry loading records"
          >
            Retry
          </Button>
        )}
      </div>
    );
  }

  // Empty state
  if (records.length === 0) {
    return (
      <div className={styles.emptyContainer} role="status">
        <div>No records to display</div>
      </div>
    );
  }

  // Records list
  return (
    <>
      {settings.showToolbar && (
        <BPFToolbar
          view={view}
          onChange={setView}
          totalCount={records.length}
          shownCount={visibleRecords.length}
          overdueCount={overdueCount}
          showOverdueFilter={!!warningDays && warningDays > 0}
          distribution={distribution}
          isMobile={isMobile}
          onRefresh={onRefresh}
        />
      )}
      <div
        className={styles.recordsList}
        role="list"
        aria-label={`${visibleRecords.length} record${visibleRecords.length !== 1 ? 's' : ''} with business process flow`}
      >
        {visibleRecords.map((record) => (
          <div key={record.recordId} role="listitem">
            {settings.enableNavigation && onNavigate ? (
              <BPFRow
                record={record}
                settings={{ ...settings, enableNavigation: true as const }}
                colors={colors}
                isMobile={isMobile}
                onNavigate={onNavigate}
                loaders={loaders}
                now={now}
              />
            ) : (
              <BPFRow
                record={record}
                settings={{ ...settings, enableNavigation: false as const }}
                colors={colors}
                isMobile={isMobile}
                loaders={loaders}
                now={now}
              />
            )}
          </div>
        ))}
      </div>
      {visibleRecords.length === 0 && (
        <div className={styles.noMatches} role="status">
          No records match the current filters.{' '}
          <Button size="small" appearance="transparent" onClick={() => setView(DEFAULT_LIST_VIEW)}>
            Clear filters
          </Button>
        </div>
      )}
    </>
  );
};

// Main component with FluentProvider
export interface IBPFViewerWithProviderProps extends IBPFViewerProps {
  platformTheme?: Theme;
  allocatedWidth?: number;
  allocatedHeight?: number;
  /**
   * Live state from the PCF control. When provided, the viewer re-renders as
   * soon as the control publishes new data, without waiting for the host to
   * call updateView() again.
   */
  store?: ViewStore;
}

/**
 * Subscribe to the control's view store (React 16 compatible — no
 * useSyncExternalStore). Returns the latest state, or null without a store.
 */
function useViewStore(store: ViewStore | undefined): IViewState | null {
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
  const renderedVersion = store ? store.getVersion() : 0;

  React.useEffect(() => {
    if (!store) return undefined;
    const unsubscribe = store.subscribe(forceRender);
    // Catch updates published between render and subscription
    if (store.getVersion() !== renderedVersion) {
      forceRender();
    }
    return unsubscribe;
    // renderedVersion intentionally read once per subscription
  }, [store]);

  return store ? store.getState() : null;
}

export const BPFViewer: React.FC<IBPFViewerWithProviderProps> = ({
  platformTheme,
  allocatedWidth,
  allocatedHeight,
  store,
  ...viewProps
}) => {
  const live = useViewStore(store);
  // Live store state wins over (possibly stale) props from the last updateView
  const props: IBPFViewerProps = live
    ? {
        ...viewProps,
        records: live.records,
        isLoading: live.isLoading || live.datasetLoading,
        error: live.error,
      }
    : viewProps;

  const styles = useStyles();
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Use platform theme if available, otherwise detect system preference
  const theme = platformTheme || webLightTheme;

  // Use explicit pixel dimensions from the PCF framework so the control
  // fills the full allocated space in the subgrid container
  const rootStyle: React.CSSProperties = {
    width: allocatedWidth ? `${allocatedWidth}px` : '100%',
    height: allocatedHeight ? `${allocatedHeight}px` : '100%',
  };

  return (
    <FluentProvider theme={theme} style={rootStyle}>
      <ErrorBoundary>
        <div className={styles.container} ref={containerRef}>
          <BPFViewerInner {...props} containerRef={containerRef} />
        </div>
      </ErrorBoundary>
    </FluentProvider>
  );
};
