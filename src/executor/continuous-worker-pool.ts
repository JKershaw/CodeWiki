/**
 * Continuous Worker Pool
 *
 * A worker pool that maintains maxConcurrency active workers at all times.
 * Unlike Promise.allSettled() batch processing, this immediately claims new work
 * when any slot opens, maximizing throughput.
 *
 * Key features:
 * - Never exceeds maxConcurrency
 * - Immediately replenishes when a slot opens
 * - Fast jobs don't wait for slow jobs
 * - Supports graceful stopping
 * - Error isolation (one failure doesn't affect others)
 */

/**
 * Options for running a continuous worker pool.
 */
export interface ContinuousPoolOptions<TWork, TResult> {
  /** Maximum number of concurrent workers */
  maxConcurrency: number;

  /** Maximum number of items to process (optional, unlimited if not set) */
  maxIterations?: number;

  /**
   * Async function to claim the next work item.
   * Returns null when no more work is available.
   */
  claimWork: () => Promise<TWork | null>;

  /**
   * Async function to execute a work item.
   * Should return a result or throw an error.
   */
  executeWork: (item: TWork) => Promise<TResult>;

  /**
   * Callback when a work item completes successfully.
   * Called after executeWork returns.
   */
  onComplete: (item: TWork, result: TResult) => Promise<void>;

  /**
   * Callback when a work item fails.
   * Called when executeWork throws an error.
   */
  onError: (item: TWork, error: Error) => Promise<void>;

  /**
   * Optional callback to check if the pool should stop.
   * Checked before claiming new work. In-flight work will complete.
   */
  shouldStop?: () => boolean;
}

/**
 * Result of running a continuous worker pool.
 */
export interface ContinuousPoolResult {
  /** Number of successfully completed work items */
  completed: number;

  /** Number of failed work items */
  failed: number;
}

/**
 * Run a continuous worker pool that maintains maxConcurrency active workers.
 *
 * The pool will:
 * 1. Fill all available slots immediately when started
 * 2. When any slot opens (work completes), immediately claim new work
 * 3. Continue until claimWork returns null or shouldStop returns true
 * 4. Allow in-flight work to complete when stopping
 */
export async function runContinuousPool<TWork, TResult>(
  options: ContinuousPoolOptions<TWork, TResult>
): Promise<ContinuousPoolResult> {
  const {
    maxConcurrency,
    maxIterations,
    claimWork,
    executeWork,
    onComplete,
    onError,
    shouldStop = () => false,
  } = options;

  const result: ContinuousPoolResult = {
    completed: 0,
    failed: 0,
  };

  // Track active workers
  let activeCount = 0;
  let claimedCount = 0;
  let workExhausted = false;
  let claimInProgress = false;

  // Promise that resolves when all work is done
  let resolveAllDone: () => void;
  const allDone = new Promise<void>(resolve => {
    resolveAllDone = resolve;
  });

  // Check if we've reached the iteration limit
  const reachedLimit = () => {
    return maxIterations !== undefined && claimedCount >= maxIterations;
  };

  // Check if we should finish
  const shouldFinish = () => {
    return workExhausted || shouldStop() || reachedLimit();
  };

  // Try to claim and start new work
  const tryClaimAndStart = async (): Promise<void> => {
    // Don't claim if we're stopping or at capacity
    if (shouldFinish() || activeCount >= maxConcurrency || claimInProgress) {
      return;
    }

    // Prevent concurrent claims to avoid race conditions
    claimInProgress = true;

    try {
      // Claim work
      const work = await claimWork();

      if (work === null) {
        workExhausted = true;
        claimInProgress = false;

        // Check if we're done
        if (activeCount === 0) {
          resolveAllDone();
        }
        return;
      }

      claimedCount++;
      activeCount++;
      claimInProgress = false;

      // Start the work (don't await - run in background)
      executeWorkItem(work);

      // Try to fill more slots
      while (activeCount < maxConcurrency && !shouldFinish() && !claimInProgress) {
        await tryClaimAndStart();
      }
    } catch (error) {
      claimInProgress = false;
      // Claim error - treat as work exhausted
      console.error('Error claiming work:', error);
      workExhausted = true;

      if (activeCount === 0) {
        resolveAllDone();
      }
    }
  };

  // Execute a single work item
  const executeWorkItem = async (work: TWork): Promise<void> => {
    try {
      const workResult = await executeWork(work);

      // Call onComplete (errors here shouldn't affect the pool)
      try {
        await onComplete(work, workResult);
      } catch (callbackError) {
        console.error('Error in onComplete callback:', callbackError);
      }

      result.completed++;
    } catch (error) {
      // Call onError (errors here shouldn't affect the pool)
      try {
        await onError(work, error instanceof Error ? error : new Error(String(error)));
      } catch (callbackError) {
        console.error('Error in onError callback:', callbackError);
      }

      result.failed++;
    } finally {
      activeCount--;

      // Try to claim more work
      if (!shouldFinish()) {
        tryClaimAndStart();
      } else if (activeCount === 0) {
        // All done
        resolveAllDone();
      }
    }
  };

  // Start initial workers
  const initialClaims: Promise<void>[] = [];
  for (let i = 0; i < maxConcurrency && !shouldFinish(); i++) {
    initialClaims.push(tryClaimAndStart());
  }
  await Promise.all(initialClaims);

  // If no work was claimed, we're done
  if (activeCount === 0 && workExhausted) {
    return result;
  }

  // Wait for all work to complete
  await allDone;

  return result;
}
