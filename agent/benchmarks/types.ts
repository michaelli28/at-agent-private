import { AgentTrace } from '../src/types';

// Success criteria - define what constitutes a successful run
export interface SuccessCriteria {
  expectAgentSuccess: boolean;  // What value should trace.success be? (true or false)
  containsText?: string;  // Optional: reason must contain this text (case-insensitive)
}

// Test case definition
export interface TestCase {
  id: string;
  name?: string;  // Human-readable name
  url: string;
  goal: string;
  maxSteps: number;  // -1 for unlimited (uses agent default of 50)
  successCriteria: SuccessCriteria;
  tags?: string[];  // For filtering/grouping (e.g., ["navigation", "forms"])
}

// Individual run result
export interface BenchmarkRun {
  runId: string;
  testCaseId: string;
  model: string;
  promptVersion?: string;  // For A/B testing prompts
  timestamp: number;
  durationMs: number;

  // Results
  success: boolean;
  criteriaResult: 'pass' | 'fail';
  stepsCount: number;
  loopsCount: number;

  // Agent output
  agentSuccess: boolean;
  agentReason: string;
  error?: string;

  // Full trace for debugging
  trace: AgentTrace;

  // Screenshots at key moments
  screenshots?: {
    initial?: string;  // base64
    final?: string;
  };
}

// Aggregated results for a test case
export interface TestCaseResults {
  testCase: TestCase;
  runs: BenchmarkRun[];

  // Aggregated stats
  stats: {
    totalRuns: number;
    passCount: number;
    failCount: number;
    passRate: number;
    avgSteps: number;
    avgDurationMs: number;
    minSteps: number;
    maxSteps: number;
  };
}

// Full benchmark report
export interface BenchmarkReport {
  id: string;
  name: string;
  createdAt: number;
  completedAt?: number;

  // Configuration
  models: string[];
  testCaseIds: string[];
  runsPerTestCase: number;

  // Results
  results: TestCaseResults[];

  // Summary
  summary: {
    totalTests: number;
    totalRuns: number;
    overallPassRate: number;
    byModel: Record<string, {
      passRate: number;
      avgSteps: number;
      avgDurationMs: number;
    }>;
  };
}

// Agent type for benchmarks
export type BenchmarkAgentType = 'full' | 'minimal';

// Event for real-time updates
export type BenchmarkEvent =
  | { type: 'benchmark_started'; reportId: string; totalRuns: number }
  | { type: 'run_started'; testCaseId: string; model: string; runNumber: number }
  | { type: 'run_completed'; run: BenchmarkRun }
  | { type: 'benchmark_completed'; report: BenchmarkReport }
  | { type: 'benchmark_error'; error: string }
  | { type: 'agent_log'; testCaseId: string; model: string; message: string };
