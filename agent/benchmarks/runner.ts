import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { BrowserClient, ScreenReaderDriver } from '@adf/virtual-screen-reader';
import { AgentOpenrouter } from '../src/AgentOpenrouter';
import { AgentTrace } from '../src/types';
import {
  TestCase,
  BenchmarkRun,
  BenchmarkReport,
  TestCaseResults,
  BenchmarkEvent,
  SuccessCriteria,
} from './types';

// Load test cases from JSON
export function loadTestCases(): TestCase[] {
  const filePath = path.join(__dirname, 'testCases.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.testCases;
}

// Get test case by ID
export function getTestCase(id: string): TestCase | undefined {
  const testCases = loadTestCases();
  return testCases.find(tc => tc.id === id);
}

// Evaluate success criteria
export function evaluateSuccessCriteria(
  criteria: SuccessCriteria,
  trace: AgentTrace
): 'pass' | 'fail' | 'pending' {
  switch (criteria.type) {
    case 'agent_success':
      return trace.success ? 'pass' : 'fail';

    case 'contains_text':
      const reason = (trace.error || trace.reason || '').toLowerCase();
      const searchText = criteria.text.toLowerCase();
      if (!trace.success) return 'fail';
      return reason.includes(searchText) ? 'pass' : 'fail';

    case 'regex':
      const pattern = new RegExp(criteria.pattern, 'i');
      if (!trace.success) return 'fail';
      return pattern.test(trace.error || trace.reason || '') ? 'pass' : 'fail';

    case 'manual':
      return 'pending';

    default:
      return 'fail';
  }
}

// Results directory
const RESULTS_DIR = path.join(__dirname, 'results');

// Ensure results directory exists
function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

// Save benchmark report
export function saveBenchmarkReport(report: BenchmarkReport): string {
  ensureResultsDir();
  const filename = `${report.id}.json`;
  const filePath = path.join(RESULTS_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  return filePath;
}

// Load benchmark report
export function loadBenchmarkReport(reportId: string): BenchmarkReport | null {
  const filePath = path.join(RESULTS_DIR, `${reportId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// List all benchmark reports
export function listBenchmarkReports(): { id: string; name: string; createdAt: number }[] {
  ensureResultsDir();
  const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const report = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf-8'));
    return {
      id: report.id,
      name: report.name,
      createdAt: report.createdAt,
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
}

// Calculate stats for test case results
function calculateStats(runs: BenchmarkRun[]): TestCaseResults['stats'] {
  if (runs.length === 0) {
    return {
      totalRuns: 0,
      passCount: 0,
      failCount: 0,
      pendingCount: 0,
      passRate: 0,
      avgSteps: 0,
      avgDurationMs: 0,
      minSteps: 0,
      maxSteps: 0,
    };
  }

  const passCount = runs.filter(r => r.criteriaResult === 'pass').length;
  const failCount = runs.filter(r => r.criteriaResult === 'fail').length;
  const pendingCount = runs.filter(r => r.criteriaResult === 'pending').length;

  const steps = runs.map(r => r.stepsCount);
  const durations = runs.map(r => r.durationMs);

  return {
    totalRuns: runs.length,
    passCount,
    failCount,
    pendingCount,
    passRate: passCount / runs.length,
    avgSteps: steps.reduce((a, b) => a + b, 0) / runs.length,
    avgDurationMs: durations.reduce((a, b) => a + b, 0) / runs.length,
    minSteps: Math.min(...steps),
    maxSteps: Math.max(...steps),
  };
}

// Benchmark runner options
export interface BenchmarkOptions {
  testCaseIds: string[];
  models: string[];
  runsPerTestCase?: number;
  apiKey?: string;
  onEvent?: (event: BenchmarkEvent) => void;
  name?: string;
}

// Run benchmark
export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkReport> {
  const {
    testCaseIds,
    models,
    runsPerTestCase = 1,
    apiKey,
    onEvent,
    name,
  } = options;

  const reportId = uuidv4();
  const testCases = loadTestCases().filter(tc => testCaseIds.includes(tc.id));

  if (testCases.length === 0) {
    throw new Error(`No test cases found for IDs: ${testCaseIds.join(', ')}`);
  }

  const totalRuns = testCases.length * models.length * runsPerTestCase;

  // Initialize report
  const report: BenchmarkReport = {
    id: reportId,
    name: name || `Benchmark ${new Date().toISOString()}`,
    createdAt: Date.now(),
    models,
    testCaseIds,
    runsPerTestCase,
    results: [],
    summary: {
      totalTests: testCases.length,
      totalRuns,
      overallPassRate: 0,
      byModel: {},
    },
  };

  onEvent?.({ type: 'benchmark_started', reportId, totalRuns });

  const allRuns: BenchmarkRun[] = [];

  // Run each test case
  for (const testCase of testCases) {
    const testCaseRuns: BenchmarkRun[] = [];

    for (const model of models) {
      for (let runNum = 1; runNum <= runsPerTestCase; runNum++) {
        onEvent?.({
          type: 'run_started',
          testCaseId: testCase.id,
          model,
          runNumber: runNum,
        });

        // Create log callback that emits events
        const onLog = (message: string) => {
          onEvent?.({
            type: 'agent_log',
            testCaseId: testCase.id,
            model,
            message,
          });
        };

        const run = await runSingleTest(testCase, model, apiKey, onLog);
        testCaseRuns.push(run);
        allRuns.push(run);

        onEvent?.({ type: 'run_completed', run });

        // Save intermediate results
        report.results = groupRunsByTestCase(allRuns, testCases);
        report.summary = calculateSummary(allRuns, models);
        saveBenchmarkReport(report);
      }
    }
  }

  // Finalize report
  report.completedAt = Date.now();
  report.results = groupRunsByTestCase(allRuns, testCases);
  report.summary = calculateSummary(allRuns, models);
  saveBenchmarkReport(report);

  onEvent?.({ type: 'benchmark_completed', report });

  return report;
}

// Run a single test
async function runSingleTest(
  testCase: TestCase,
  model: string,
  apiKey?: string,
  onLog?: (message: string) => void
): Promise<BenchmarkRun> {
  const runId = uuidv4();
  const startTime = Date.now();

  let client: BrowserClient | null = null;
  let driver: ScreenReaderDriver | null = null;
  let trace: AgentTrace;
  let initialScreenshot: string | undefined;
  let finalScreenshot: string | undefined;

  try {
    // Initialize browser and screen reader
    client = new BrowserClient();
    await client.launch(false); // headed mode
    await client.goto(testCase.url);

    driver = new ScreenReaderDriver(client, onLog);
    await driver.enable();

    // Capture initial screenshot
    try {
      const buffer = await client.screenshot();
      initialScreenshot = buffer.toString('base64');
    } catch {
      // Ignore screenshot errors
    }

    // Create agent
    const agent = new AgentOpenrouter({
      driver,
      apiKey: apiKey || process.env['OPENROUTER_API_KEY'],
      model,
      onLog,
    });

    // Run agent
    trace = await agent.run(testCase.goal);

    // Capture final screenshot
    try {
      const buffer = await client.screenshot();
      finalScreenshot = buffer.toString('base64');
    } catch {
      // Ignore screenshot errors
    }
  } catch (error: any) {
    trace = {
      goal: testCase.goal,
      success: false,
      steps: [],
      error: error.message || 'Unknown error',
    };
  } finally {
    if (driver) {
      try {
        await driver.disable();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const criteriaResult = evaluateSuccessCriteria(testCase.successCriteria, trace);

  return {
    runId,
    testCaseId: testCase.id,
    model,
    timestamp: startTime,
    durationMs,
    success: criteriaResult === 'pass',
    criteriaResult,
    stepsCount: trace.steps.length,
    loopsCount: trace.steps.length, // Approximate
    agentSuccess: trace.success,
    agentReason: trace.error || trace.reason || '',
    error: trace.error,
    trace,
    screenshots: {
      initial: initialScreenshot,
      final: finalScreenshot,
    },
  };
}

// Group runs by test case
function groupRunsByTestCase(runs: BenchmarkRun[], testCases: TestCase[]): TestCaseResults[] {
  return testCases.map(testCase => {
    const testCaseRuns = runs.filter(r => r.testCaseId === testCase.id);
    return {
      testCase,
      runs: testCaseRuns,
      stats: calculateStats(testCaseRuns),
    };
  });
}

// Calculate summary stats
function calculateSummary(
  runs: BenchmarkRun[],
  models: string[]
): BenchmarkReport['summary'] {
  const passCount = runs.filter(r => r.criteriaResult === 'pass').length;

  const byModel: Record<string, { passRate: number; avgSteps: number; avgDurationMs: number }> = {};

  for (const model of models) {
    const modelRuns = runs.filter(r => r.model === model);
    if (modelRuns.length > 0) {
      const modelPassCount = modelRuns.filter(r => r.criteriaResult === 'pass').length;
      byModel[model] = {
        passRate: modelPassCount / modelRuns.length,
        avgSteps: modelRuns.reduce((a, r) => a + r.stepsCount, 0) / modelRuns.length,
        avgDurationMs: modelRuns.reduce((a, r) => a + r.durationMs, 0) / modelRuns.length,
      };
    }
  }

  return {
    totalTests: new Set(runs.map(r => r.testCaseId)).size,
    totalRuns: runs.length,
    overallPassRate: runs.length > 0 ? passCount / runs.length : 0,
    byModel,
  };
}
