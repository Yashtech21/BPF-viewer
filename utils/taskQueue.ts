/**
 * Minimal promise work queue.
 *
 * Runs `worker` over `items` with at most `concurrency` tasks in flight.
 * Before starting each item it calls `shouldStop()`; once that returns true
 * no further items are started (in-flight ones are allowed to settle).
 * Worker errors are the worker's responsibility — a rejected worker is
 * swallowed here so one failing item never blocks the rest of the queue.
 */
export async function runQueue<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false
): Promise<void> {
  let next = 0;
  const lanes = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));

  const lane = async (): Promise<void> => {
    while (next < items.length && !shouldStop()) {
      const index = next++;
      try {
        await worker(items[index], index);
      } catch {
        // Intentionally ignored: see doc comment
      }
    }
  };

  await Promise.all(Array.from({ length: lanes }, lane));
}
