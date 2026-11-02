/**
 * View store
 *
 * Bridges the PCF control class and the React tree.
 *
 * Why: in a dataset (grid/subgrid) control, `notifyOutputChanged()` does not
 * reliably make the platform call `updateView()` again — the control has no
 * output properties, so the host often skips the re-render. Data fetched
 * asynchronously would then sit in memory until something else (Refresh, a
 * form reload) triggered `updateView()`.
 *
 * The control writes its live state here; the React tree subscribes and
 * re-renders itself immediately, independent of the host's render cycle.
 */

import type { IRecordBPFData } from '../types';

export interface IViewState {
  records: IRecordBPFData[];
  /** BPF data still being fetched by the control */
  isLoading: boolean;
  /** The platform dataset itself is loading (paging, view switch) */
  datasetLoading: boolean;
  error: string | null;
}

export type Listener = () => void;

export class ViewStore {
  private state: IViewState;
  private listeners = new Set<Listener>();
  private version = 0;

  constructor(initial?: Partial<IViewState>) {
    this.state = { records: [], isLoading: true, datasetLoading: false, error: null, ...initial };
  }

  getState(): IViewState {
    return this.state;
  }

  /** Monotonic counter, bumped on every change (lets subscribers detect missed updates) */
  getVersion(): number {
    return this.version;
  }

  /** Merge a partial update and notify subscribers if anything changed */
  setState(patch: Partial<IViewState>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof IViewState)[]) {
      if (this.state[key] !== patch[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    this.state = { ...this.state, ...patch };
    this.version++;
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch {
        // A failing subscriber must not break the control or other subscribers
      }
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
