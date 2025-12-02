/**
 * Simple concurrency limiter for parallel async operations.
 * Limits the number of concurrent promises to avoid overwhelming resources.
 */
export function createConcurrencyLimiter(concurrency: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    if (queue.length > 0 && activeCount < concurrency) {
      const next = queue.shift();
      if (next) next();
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        activeCount++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            activeCount--;
            runNext();
          });
      };

      if (activeCount < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}
