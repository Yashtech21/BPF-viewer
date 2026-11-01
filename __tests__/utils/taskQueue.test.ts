import { runQueue } from '../../utils/taskQueue';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('runQueue', () => {
  it('processes items in order, one at a time with concurrency 1', async () => {
    const log: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    await runQueue(['a', 'b', 'c'], 1, async item => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      log.push(`start ${item}`);
      await tick();
      log.push(`end ${item}`);
      inFlight--;
    });
    expect(maxInFlight).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('respects higher concurrency limits', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runQueue([1, 2, 3, 4, 5], 2, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      inFlight--;
    });
    expect(maxInFlight).toBe(2);
  });

  it('continues after a worker rejects', async () => {
    const done: number[] = [];
    await runQueue([1, 2, 3], 1, async n => {
      if (n === 2) throw new Error('boom');
      done.push(n);
    });
    expect(done).toEqual([1, 3]);
  });

  it('stops starting new items once shouldStop returns true', async () => {
    const started: number[] = [];
    let stop = false;
    await runQueue([1, 2, 3], 1, async n => {
      started.push(n);
      stop = true;
    }, () => stop);
    expect(started).toEqual([1]);
  });

  it('handles empty input and bad concurrency values', async () => {
    const worker = jest.fn().mockResolvedValue(undefined);
    await runQueue([], 1, worker);
    await runQueue([1, 2], 0, worker);
    expect(worker).toHaveBeenCalledTimes(2);
  });
});
