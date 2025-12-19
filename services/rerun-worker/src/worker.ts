/**
 * AT Agent Rerun Worker
 *
 * Standalone worker that polls Firebase for rerun jobs and executes them
 * using the AT Agent CLI. Designed to run as a separate Fly.io service.
 */

import * as admin from 'firebase-admin';
import { spawn } from 'child_process';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

if (!serviceAccount.project_id) {
  console.error('FIREBASE_SERVICE_ACCOUNT environment variable is required');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Configuration
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL || '5000', 10);
const AGENT_PATH = process.env.AGENT_PATH || '/app/agent';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://at-agent-dashboard.fly.dev';
const BROWSER_VIEWER_URL = process.env.BROWSER_VIEWER_URL || ''; // noVNC URL for live browser preview
const CDP_ENDPOINT = process.env.CDP_ENDPOINT || ''; // CDP endpoint for connecting to browser-viewer

interface RerunTest {
  url: string;
  goal: string;
  originalIndex: number;
}

interface RerunJob {
  id: string;
  testRunId: string;
  originalTestRunId: string | null; // null for manual test runs
  projectId: string;
  tests: RerunTest[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  jobType?: 'rerun' | 'manual'; // 'manual' for dashboard-initiated runs
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

let isRunning = false;

/**
 * Process the next pending rerun job
 */
async function processNextJob(): Promise<void> {
  if (isRunning) return;

  try {
    const pendingJobs = await db
      .collection('rerunJobs')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get();

    if (pendingJobs.empty) {
      return;
    }

    const jobDoc = pendingJobs.docs[0];
    const job: RerunJob = {
      id: jobDoc.id,
      ...jobDoc.data() as Omit<RerunJob, 'id'>
    };

    const jobTypeLabel = job.jobType === 'manual' ? 'Manual Test Run' : 'Rerun';
    console.log(`[Worker] Processing ${jobTypeLabel} job ${job.id} with ${job.tests.length} tests`);

    isRunning = true;

    await jobDoc.ref.update({
      status: 'running',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await executeRerunJob(job);

  } catch (error) {
    console.error('[Worker] Error processing job:', error);
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
  testRunId: string,
  apiKey: string
): Promise<TestResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HEADLESS: 'true',
      DASHBOARD_URL: DASHBOARD_URL,
      DASHBOARD_API_KEY: apiKey,
      TEST_RUN_ID: testRunId,
      TEST_INDEX: testIndex.toString(),
      ...(CDP_ENDPOINT ? { CDP_ENDPOINT } : {}), // Connect to browser-viewer if configured
    };

    // Use pre-compiled CLI for faster startup (no tsx transpilation)
    const cliPath = `${AGENT_PATH}/dist/runAgentCli.js`;
    const args = [
      cliPath,
      test.url,
      test.goal,
      'openai',
      '--json',
      '--live'
    ];

    let stdout = '';
    let stderr = '';

    console.log(`[Worker] Running: node ${args.join(' ')}`);
    console.log(`[Worker] CWD: ${AGENT_PATH}`);

    const child = spawn('node', args, {
      cwd: AGENT_PATH,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;

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
        console.error('[Worker] Failed to parse JSON output:', parseError);
      }

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
 * Update live status document
 */
async function updateLiveStatus(testRunId: string, updates: Record<string, any>): Promise<void> {
  try {
    const liveStatusRef = db.collection('liveStatus').doc(testRunId);
    await liveStatusRef.update({
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('[Worker] Error updating live status:', error);
  }
}

/**
 * Save partial results when a job is cancelled
 */
async function savePartialResults(
  job: RerunJob,
  results: TestResult[],
  totalDuration: number,
  status: 'cancelled' | 'failed'
): Promise<void> {
  const passedTests = results.filter(r => r.success).length;
  const failedTests = results.length - passedTests;
  const passRate = results.length > 0 ? (passedTests / results.length) * 100 : 0;
  const totalViolations = results.reduce((sum, r) => sum + (r.violations?.length || 0), 0);

  // Update the test run with partial results
  await db.collection('testRuns').doc(job.testRunId).update({
    totalTests: job.tests.length,
    passedTests,
    failedTests,
    passRate,
    totalDuration,
    totalViolations,
    status,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Save any completed test results
  if (results.length > 0) {
    const batch = db.batch();

    for (const result of results) {
      const resultRef = db.collection('testResults').doc();
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
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
  }

  // Update the job status
  await db.collection('rerunJobs').doc(job.id).update({
    status,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`[Worker] Saved ${results.length} partial results for ${status} job ${job.id}`);
}

/**
 * Check if a job has been cancelled
 */
async function isJobCancelled(jobId: string, testRunId: string): Promise<boolean> {
  try {
    // Check both the job and the test run for cancellation
    const [jobDoc, testRunDoc] = await Promise.all([
      db.collection('rerunJobs').doc(jobId).get(),
      db.collection('testRuns').doc(testRunId).get(),
    ]);

    const jobData = jobDoc.data();
    const testRunData = testRunDoc.data();

    return jobData?.status === 'cancelled' || testRunData?.status === 'cancelled';
  } catch (error) {
    console.error('[Worker] Error checking cancellation status:', error);
    return false;
  }
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
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    // Fetch the project's API key for live updates
    const projectDoc = await db.collection('projects').doc(job.projectId).get();
    if (!projectDoc.exists) {
      throw new Error(`Project ${job.projectId} not found`);
    }
    const apiKey = projectDoc.data()?.apiKey || '';
    console.log(`[Worker] Using API key for project ${job.projectId}`);

    // Set browser viewer URL in liveStatus if available
    if (BROWSER_VIEWER_URL) {
      await updateLiveStatus(job.testRunId, {
        browserViewerUrl: BROWSER_VIEWER_URL,
      });
      console.log(`[Worker] Browser viewer URL: ${BROWSER_VIEWER_URL}`);
    }

    for (let i = 0; i < job.tests.length; i++) {
      // Check for cancellation before each test
      if (await isJobCancelled(job.id, job.testRunId)) {
        console.log(`[Worker] Job ${job.id} was cancelled, stopping execution`);

        // Save partial results
        const totalDuration = Date.now() - startTime;
        await savePartialResults(job, results, totalDuration, 'cancelled');

        await updateLiveStatus(job.testRunId, {
          isRunning: false,
          isCancelled: true,
        });

        return;
      }

      const test = job.tests[i];

      console.log(`[Worker] Running test ${i + 1}/${job.tests.length}: ${test.goal}`);

      await updateLiveStatus(job.testRunId, {
        currentTestIndex: i,
        currentTestUrl: test.url,
        currentTestGoal: test.goal,
      });

      const result = await runSingleTest(test, i, job.testRunId, apiKey);
      results.push(result);

      if (result.success) {
        passedTests++;
      } else {
        failedTests++;
      }

      console.log(`[Worker] Test ${i + 1} ${result.success ? 'PASSED' : 'FAILED'}: ${result.reason || result.error || ''}`);

      await updateLiveStatus(job.testRunId, {
        completedTests: i + 1,
        passedTests,
        failedTests,
      });
    }

    // Final cancellation check before marking as complete
    if (await isJobCancelled(job.id, job.testRunId)) {
      console.log(`[Worker] Job ${job.id} was cancelled after completion`);
      return;
    }

    const totalDuration = Date.now() - startTime;
    await completeRerunJob(job, results, totalDuration);

    console.log(`[Worker] Job ${job.id} completed: ${passedTests}/${job.tests.length} passed`);

  } catch (error: any) {
    console.error(`[Worker] Job ${job.id} failed:`, error.message);

    await db.collection('rerunJobs').doc(job.id).update({
      status: 'failed',
      error: error.message,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('testRuns').doc(job.testRunId).update({
      status: 'failed',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await updateLiveStatus(job.testRunId, {
      isRunning: false,
    });
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

  await db.collection('testRuns').doc(job.testRunId).update({
    totalTests: results.length,
    passedTests,
    failedTests,
    passRate,
    totalDuration,
    totalViolations,
    status: 'completed',
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const batch = db.batch();

  for (const result of results) {
    const resultRef = db.collection('testResults').doc();
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();

  await db.collection('rerunJobs').doc(job.id).update({
    status: 'completed',
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await updateLiveStatus(job.testRunId, {
    isRunning: false,
    completedTests: results.length,
  });

  await db.collection('projects').doc(job.projectId).update({
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Main entry point
 */
async function main() {
  console.log('[Worker] AT Agent Rerun Worker starting...');
  console.log(`[Worker] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[Worker] Agent path: ${AGENT_PATH}`);
  console.log(`[Worker] Dashboard URL: ${DASHBOARD_URL}`);

  // Start polling
  setInterval(async () => {
    try {
      await processNextJob();
    } catch (error) {
      console.error('[Worker] Error in poll cycle:', error);
    }
  }, POLL_INTERVAL_MS);

  // Run immediately
  await processNextJob();

  console.log('[Worker] Worker started, polling for jobs...');
}

main().catch(console.error);
