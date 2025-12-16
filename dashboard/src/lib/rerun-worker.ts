/**
 * Rerun Worker - Background job processor for dashboard-triggered test reruns
 *
 * This worker polls for pending rerun jobs and executes them using the AT Agent CLI.
 * It runs in the Next.js server process and spawns the agent as a child process.
 */

import { adminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { spawn } from 'child_process';
import * as path from 'path';

interface RerunTest {
  url: string;
  goal: string;
  originalIndex: number;
}

interface RerunJob {
  id: string;
  testRunId: string;
  originalTestRunId: string;
  projectId: string;
  tests: RerunTest[];
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface TestResult {
  url: string;
  goal: string;
  success: boolean;
  reason?: string;
  error?: string;
  steps: Array<{
    stepNumber: number;
    action: string;
    observation: string;
    thought?: string;
  }>;
  violations: Array<{
    type: string;
    message: string;
    element?: string;
    severity: string;
  }>;
  duration: number;
}

// Worker state
let isRunning = false;
let pollInterval: NodeJS.Timeout | null = null;

const POLL_INTERVAL_MS = parseInt(process.env.RERUN_POLL_INTERVAL || '5000', 10);
const WORKER_ENABLED = process.env.RERUN_WORKER_ENABLED !== 'false';
// Path to the at-agent root directory (parent of dashboard)
const AGENT_PATH = process.env.AGENT_PATH || path.resolve(__dirname, '../../../../');

/**
 * Start the rerun worker
 */
export function startRerunWorker(): void {
  if (!WORKER_ENABLED) {
    console.log('[RerunWorker] Worker disabled via RERUN_WORKER_ENABLED=false');
    return;
  }

  if (pollInterval) {
    console.log('[RerunWorker] Worker already running');
    return;
  }

  console.log(`[RerunWorker] Starting worker with ${POLL_INTERVAL_MS}ms poll interval`);
  console.log(`[RerunWorker] Agent path: ${AGENT_PATH}`);

  pollInterval = setInterval(async () => {
    if (isRunning) {
      return; // Skip if already processing a job
    }

    try {
      await processNextJob();
    } catch (error) {
      console.error('[RerunWorker] Error in poll cycle:', error);
    }
  }, POLL_INTERVAL_MS);

  // Also run immediately
  processNextJob().catch(console.error);
}

/**
 * Stop the rerun worker
 */
export function stopRerunWorker(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[RerunWorker] Worker stopped');
  }
}

/**
 * Process the next pending rerun job
 */
async function processNextJob(): Promise<void> {
  if (isRunning) return;

  try {
    // Find the oldest pending job
    const pendingJobs = await adminDb
      .collection('rerunJobs')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get();

    if (pendingJobs.empty) {
      return; // No pending jobs
    }

    const jobDoc = pendingJobs.docs[0];
    const job: RerunJob = {
      id: jobDoc.id,
      ...jobDoc.data() as Omit<RerunJob, 'id'>
    };

    console.log(`[RerunWorker] Processing job ${job.id} with ${job.tests.length} tests`);

    isRunning = true;

    // Mark job as running
    await jobDoc.ref.update({
      status: 'running',
      startedAt: FieldValue.serverTimestamp(),
    });

    // Execute the tests
    await executeRerunJob(job);

  } finally {
    isRunning = false;
  }
}

/**
 * Run a single test using the agent CLI
 */
async function runSingleTest(
  test: RerunTest,
  testIndex: number,
  testRunId: string
): Promise<TestResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HEADLESS: 'true',
      DASHBOARD_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      DASHBOARD_API_KEY: '', // Not needed for internal updates
      TEST_RUN_ID: testRunId,
      TEST_INDEX: testIndex.toString(),
    };

    // Use npm to run the agent CLI
    const args = [
      'run', 'start:agent-cli', '--',
      test.url,
      test.goal,
      'openai',
      '--json',
      '--live'
    ];

    let stdout = '';
    let stderr = '';

    const child = spawn('npm', args, {
      cwd: AGENT_PATH,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;

      // Try to parse JSON from output
      try {
        const jsonStart = stdout.indexOf('{"url"');
        if (jsonStart >= 0) {
          let jsonStr = stdout.substring(jsonStart);
          let braceCount = 0;
          let jsonEnd = -1;

          for (let i = 0; i < jsonStr.length; i++) {
            if (jsonStr[i] === '{') braceCount++;
            else if (jsonStr[i] === '}') {
              braceCount--;
              if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }

          if (jsonEnd > 0) {
            jsonStr = jsonStr.substring(0, jsonEnd);
            const parsed = JSON.parse(jsonStr);

            resolve({
              url: test.url,
              goal: test.goal,
              success: parsed.success || false,
              reason: parsed.reason || undefined,
              error: parsed.error || undefined,
              steps: parsed.steps || [],
              violations: parsed.violations || [],
              duration
            });
            return;
          }
        }
      } catch (parseError) {
        console.error('[RerunWorker] Failed to parse JSON output:', parseError);
      }

      // Return error result if we couldn't parse
      resolve({
        url: test.url,
        goal: test.goal,
        success: false,
        error: stderr || `Process exited with code ${code}`,
        steps: [],
        violations: [],
        duration
      });
    });

    child.on('error', (error) => {
      const duration = Date.now() - startTime;
      resolve({
        url: test.url,
        goal: test.goal,
        success: false,
        error: error.message,
        steps: [],
        violations: [],
        duration
      });
    });
  });
}

/**
 * Execute a rerun job
 */
async function executeRerunJob(job: RerunJob): Promise<void> {
  const results: TestResult[] = [];
  let passedTests = 0;
  let failedTests = 0;
  const startTime = Date.now();

  try {
    // Validate API key
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required for rerun execution');
    }

    for (let i = 0; i < job.tests.length; i++) {
      const test = job.tests[i];

      console.log(`[RerunWorker] Running test ${i + 1}/${job.tests.length}: ${test.goal}`);

      // Update live status
      await updateLiveStatus(job.testRunId, {
        currentTestIndex: i,
        currentTestUrl: test.url,
        currentTestGoal: test.goal,
      });

      // Run the test
      const result = await runSingleTest(test, i, job.testRunId);
      results.push(result);

      if (result.success) {
        passedTests++;
      } else {
        failedTests++;
      }

      console.log(`[RerunWorker] Test ${i + 1} ${result.success ? 'PASSED' : 'FAILED'}: ${result.reason || result.error || ''}`);

      // Update live status with progress
      await updateLiveStatus(job.testRunId, {
        completedTests: i + 1,
        passedTests,
        failedTests,
      });

      // Notify test completion
      await notifyTestComplete(job.testRunId, i, result.success, test.url, test.goal);
    }

    const totalDuration = Date.now() - startTime;

    // Complete the job
    await completeRerunJob(job, results, totalDuration);

    console.log(`[RerunWorker] Job ${job.id} completed: ${passedTests}/${job.tests.length} passed`);

  } catch (error: any) {
    console.error(`[RerunWorker] Job ${job.id} failed:`, error.message);

    // Mark job as failed
    await adminDb.collection('rerunJobs').doc(job.id).update({
      status: 'failed',
      error: error.message,
      completedAt: FieldValue.serverTimestamp(),
    });

    // Update test run status
    await adminDb.collection('testRuns').doc(job.testRunId).update({
      status: 'failed',
      completedAt: FieldValue.serverTimestamp(),
    });

    // Update live status
    await updateLiveStatus(job.testRunId, {
      isRunning: false,
    });
  }
}

/**
 * Update live status document
 */
async function updateLiveStatus(testRunId: string, updates: Record<string, any>): Promise<void> {
  try {
    const liveStatusRef = adminDb.collection('liveStatus').doc(testRunId);
    await liveStatusRef.update({
      ...updates,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('[RerunWorker] Error updating live status:', error);
  }
}

/**
 * Send a live step update
 */
async function sendLiveStep(
  testRunId: string,
  testIndex: number,
  url: string,
  goal: string,
  step: any
): Promise<void> {
  try {
    const liveStepRef = adminDb.collection('liveSteps').doc();
    await liveStepRef.set({
      testRunId,
      testIndex,
      url,
      goal,
      stepNumber: step.stepNumber,
      action: step.action ? JSON.stringify(step.action) : '',
      observation: step.observation?.text || '',
      thought: step.thought || '',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('[RerunWorker] Error sending live step:', error);
  }
}

/**
 * Notify test completion
 */
async function notifyTestComplete(
  testRunId: string,
  testIndex: number,
  success: boolean,
  url: string,
  goal: string
): Promise<void> {
  try {
    // Update the live status with test completion
    const liveStatusRef = adminDb.collection('liveStatus').doc(testRunId);
    const doc = await liveStatusRef.get();

    if (doc.exists) {
      const data = doc.data()!;
      await liveStatusRef.update({
        completedTests: (data.completedTests || 0) + 1,
        passedTests: success ? (data.passedTests || 0) + 1 : data.passedTests || 0,
        failedTests: !success ? (data.failedTests || 0) + 1 : data.failedTests || 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  } catch (error) {
    console.error('[RerunWorker] Error notifying test complete:', error);
  }
}

/**
 * Complete a rerun job
 */
async function completeRerunJob(
  job: RerunJob,
  results: TestResult[],
  totalDuration: number
): Promise<void> {
  const passedTests = results.filter(r => r.success).length;
  const failedTests = results.length - passedTests;
  const passRate = results.length > 0 ? (passedTests / results.length) * 100 : 0;
  const totalViolations = results.reduce((sum, r) => sum + (r.violations?.length || 0), 0);

  // Update the test run
  await adminDb.collection('testRuns').doc(job.testRunId).update({
    totalTests: results.length,
    passedTests,
    failedTests,
    passRate,
    totalDuration,
    totalViolations,
    status: 'completed',
    completedAt: FieldValue.serverTimestamp(),
  });

  // Create test result documents
  const batch = adminDb.batch();

  for (const result of results) {
    const resultRef = adminDb.collection('testResults').doc();
    batch.set(resultRef, {
      testRunId: job.testRunId,
      projectId: job.projectId,
      url: result.url,
      goal: result.goal,
      success: result.success,
      reason: result.reason || null,
      error: result.error || null,
      stepCount: result.steps?.length || 0,
      steps: result.steps || [],
      violations: result.violations || [],
      duration: result.duration,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();

  // Update job status
  await adminDb.collection('rerunJobs').doc(job.id).update({
    status: 'completed',
    completedAt: FieldValue.serverTimestamp(),
  });

  // Update live status
  await updateLiveStatus(job.testRunId, {
    isRunning: false,
    completedTests: results.length,
  });

  // Update project's updatedAt
  await adminDb.collection('projects').doc(job.projectId).update({
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// Note: Worker is started via instrumentation.ts (Next.js instrumentation hook)
// This ensures proper initialization order and avoids duplicate starts
