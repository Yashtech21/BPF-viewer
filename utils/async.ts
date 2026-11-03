import { createLogger } from './logger';

const log = createLogger('[BPFViewer]');

/** Resolve with `fallback` if `promise` rejects or takes longer than `ms` */
export function withFallback<T>(promise: Promise<T>, ms: number, fallback: T, what: string): Promise<T> {
  return new Promise<T>(resolve => {
    const timer = setTimeout(() => {
      log.warn(`${what} took over ${ms}ms; continuing without it`);
      resolve(fallback);
    }, ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        log.warn(`${what} failed; continuing without it:`, error);
        resolve(fallback);
      }
    );
  });
}
