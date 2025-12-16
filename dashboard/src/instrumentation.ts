/**
 * Next.js Instrumentation File
 * This file runs once when the Node.js server starts.
 * Used to initialize the rerun worker for background job processing.
 */

export async function register() {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Check if rerun worker is enabled
    if (process.env.RERUN_WORKER_ENABLED !== 'false') {
      console.log('[Instrumentation] Initializing rerun worker...');

      try {
        // Dynamic import to avoid bundling issues
        const { startRerunWorker } = await import('./lib/rerun-worker');
        startRerunWorker();
        console.log('[Instrumentation] Rerun worker started successfully');
      } catch (error) {
        console.error('[Instrumentation] Failed to start rerun worker:', error);
      }
    } else {
      console.log('[Instrumentation] Rerun worker disabled via RERUN_WORKER_ENABLED=false');
    }
  }
}
