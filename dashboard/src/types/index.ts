// Core types for accessibility testing dashboard

export interface Project {
  id: string;
  name: string;
  description?: string;
  apiKey: string; // For authenticating CI/CD submissions
  createdAt: Date;
  updatedAt: Date;
  ownerId?: string;
}

export interface TestRun {
  id: string;
  projectId: string;
  platform: 'jenkins' | 'github-actions' | 'gitlab-ci' | 'other';
  jobName?: string; // Jenkins job name or CI pipeline name
  buildNumber?: string;
  buildUrl?: string;
  branch?: string;
  commit?: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  passRate: number;
  totalDuration: number; // ms
  totalViolations: number;
  status: 'running' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  metadata?: Record<string, any>;
}

export interface TestResult {
  id: string;
  testRunId: string;
  projectId: string;
  url: string;
  goal: string;
  success: boolean;
  reason?: string;
  error?: string;
  stepCount: number;
  steps: TestStep[];
  violations: Violation[];
  duration: number; // ms
  createdAt: Date;
}

export interface TestStep {
  stepNumber: number;
  action: string;
  observation: string;
  thought?: string;
  screenshot?: string;
}

// Live step for real-time tracking during test execution
export interface LiveStep {
  id: string;
  testRunId: string;
  testIndex: number; // Which test in the run (0, 1, 2...)
  url: string;
  goal: string;
  stepNumber: number;
  action: string;
  observation: string;
  thought?: string;
  createdAt: Date;
}

// Live test run status for real-time tracking
export interface LiveTestStatus {
  testRunId: string;
  currentTestIndex: number;
  currentTestUrl: string;
  currentTestGoal: string;
  totalTests: number;
  completedTests: number;
  isRunning: boolean;
}

export interface Violation {
  type: string;
  message: string;
  element?: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  wcagCriteria?: string;
}

// API request/response types
export interface SubmitResultsRequest {
  apiKey: string;
  platform: TestRun['platform'];
  jobName?: string;
  buildNumber?: string;
  buildUrl?: string;
  branch?: string;
  commit?: string;
  results: {
    url: string;
    goal: string;
    success: boolean;
    reason?: string;
    error?: string;
    steps: TestStep[];
    violations: Violation[];
    duration: number;
  }[];
  totalDuration: number;
  metadata?: Record<string, any>;
}

export interface SubmitResultsResponse {
  success: boolean;
  testRunId?: string;
  projectName?: string;
  error?: string;
}

// User settings types
export interface UserSettings {
  id: string;
  userId: string;
  // General settings
  dashboardName: string;
  defaultTimeRange: number; // days
  showViolationsInSummary: boolean;
  autoExpandFailedTests: boolean;
  // Notification settings
  emailNotificationsEnabled: boolean;
  weeklyReportsEnabled: boolean;
  notificationEmail: string;
  // Thresholds
  goodPassRateThreshold: number;
  warningPassRateThreshold: number;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Dashboard view types
export interface DashboardStats {
  totalProjects: number;
  totalTestRuns: number;
  totalTests: number;
  overallPassRate: number;
  recentRuns: TestRun[];
}

export interface TrendData {
  date: string;
  passRate: number;
  totalTests: number;
  violations: number;
}
