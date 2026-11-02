import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ViewStore } from '../../utils/viewStore';
import { BPFViewer } from '../../components/BPFViewer';
import { createMockRecordBPFData, createMockStageColors } from '../setup/testUtils';
import type { IControlSettings } from '../../types';

describe('ViewStore', () => {
  it('notifies subscribers on change and bumps the version', () => {
    const store = new ViewStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    store.setState({ isLoading: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().isLoading).toBe(false);
    expect(store.getVersion()).toBe(1);

    unsubscribe();
    store.setState({ isLoading: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores no-op updates', () => {
    const store = new ViewStore({ isLoading: false });
    const listener = jest.fn();
    store.subscribe(listener);
    store.setState({ isLoading: false });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getVersion()).toBe(0);
  });

  it('keeps notifying other subscribers if one throws', () => {
    const store = new ViewStore();
    const good = jest.fn();
    store.subscribe(() => { throw new Error('bad'); });
    store.subscribe(good);
    store.setState({ error: 'x' });
    expect(good).toHaveBeenCalled();
  });
});

describe('BPFViewer + ViewStore', () => {
  const settings: IControlSettings = {
    designStyle: 'modern', displayMode: 'stage', recordNameSize: 'medium', showEntityName: false,
    enableNavigation: false, showPulseAnimation: false, usePlatformTheme: false,
  };

  it('re-renders from the store without new props', () => {
    const store = new ViewStore({ records: [], isLoading: true });
    render(
      <BPFViewer store={store} records={[]} settings={settings} colors={createMockStageColors()} isLoading error={null} />
    );
    expect(screen.getByText(/loading records/i)).toBeInTheDocument();

    act(() => {
      store.setState({ records: [createMockRecordBPFData('r1', 'Contoso', 'opportunity', 'Opportunity')], isLoading: false });
    });

    expect(screen.getByText('Contoso')).toBeInTheDocument();
    expect(screen.queryByText(/loading records/i)).not.toBeInTheDocument();
  });

  it('treats a loading platform dataset as loading', () => {
    const store = new ViewStore({ records: [], isLoading: false, datasetLoading: true });
    render(
      <BPFViewer store={store} records={[]} settings={settings} colors={createMockStageColors()} isLoading={false} error={null} />
    );
    expect(screen.getByText(/loading records/i)).toBeInTheDocument();
  });

  it('picks up updates published before it subscribed', () => {
    const store = new ViewStore({ records: [], isLoading: true });
    // Simulate an update landing between render and effect by publishing in a child render
    const Publisher: React.FC = () => {
      React.useLayoutEffect(() => {
        store.setState({ records: [createMockRecordBPFData('r2', 'Fabrikam', 'opportunity', 'Opportunity')], isLoading: false });
      }, []);
      return null;
    };
    render(
      <>
        <BPFViewer store={store} records={[]} settings={settings} colors={createMockStageColors()} isLoading error={null} />
        <Publisher />
      </>
    );
    expect(screen.getByText('Fabrikam')).toBeInTheDocument();
  });
});
