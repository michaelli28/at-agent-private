/**
 * Type definitions for WCAG Behavioral Audit
 *
 * This module defines types for autonomous accessibility test generation
 * using PageRank analysis and WCAG 2.1 Level A/AA compliance testing.
 */

import { SuccessCriteria, BenchmarkRun } from '../../benchmarks/types';
import { AgentTrace } from '../types';

// ==================== WCAG Criteria Types ====================

export type WCAGLevel = 'A' | 'AA';

export interface WCAGCriterion {
  id: string;           // e.g., "2.1.1"
  name: string;         // e.g., "Keyboard"
  level: WCAGLevel;
  guideline: string;    // e.g., "2.1 Keyboard Accessible"
  description: string;
}

// WCAG A criteria covered
export const WCAG_A_CRITERIA: WCAGCriterion[] = [
  { id: '1.1.1', name: 'Non-text Content', level: 'A', guideline: '1.1 Text Alternatives', description: 'All non-text content has a text alternative' },
  { id: '1.3.1', name: 'Info and Relationships', level: 'A', guideline: '1.3 Adaptable', description: 'Information and relationships can be programmatically determined' },
  { id: '2.1.1', name: 'Keyboard', level: 'A', guideline: '2.1 Keyboard Accessible', description: 'All functionality is operable through a keyboard' },
  { id: '2.1.2', name: 'No Keyboard Trap', level: 'A', guideline: '2.1 Keyboard Accessible', description: 'Keyboard focus can be moved away from any component' },
  { id: '2.4.1', name: 'Bypass Blocks', level: 'A', guideline: '2.4 Navigable', description: 'A mechanism is available to bypass blocks of repeated content' },
  { id: '2.4.2', name: 'Page Titled', level: 'A', guideline: '2.4 Navigable', description: 'Web pages have titles that describe topic or purpose' },
  { id: '2.4.4', name: 'Link Purpose (In Context)', level: 'A', guideline: '2.4 Navigable', description: 'Link purpose can be determined from link text or context' },
  { id: '3.1.1', name: 'Language of Page', level: 'A', guideline: '3.1 Readable', description: 'Default language of each page can be programmatically determined' },
  { id: '3.3.1', name: 'Error Identification', level: 'A', guideline: '3.3 Input Assistance', description: 'Input errors are automatically detected and described to the user' },
  { id: '3.3.2', name: 'Labels or Instructions', level: 'A', guideline: '3.3 Input Assistance', description: 'Labels or instructions are provided for user input' },
  { id: '4.1.2', name: 'Name, Role, Value', level: 'A', guideline: '4.1 Compatible', description: 'UI components have accessible name, role, and state' },
];

// WCAG AA criteria covered
export const WCAG_AA_CRITERIA: WCAGCriterion[] = [
  { id: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', guideline: '1.4 Distinguishable', description: 'Text has a contrast ratio of at least 4.5:1' },
  { id: '2.4.5', name: 'Multiple Ways', level: 'AA', guideline: '2.4 Navigable', description: 'More than one way is available to locate a page' },
  { id: '2.4.6', name: 'Headings and Labels', level: 'AA', guideline: '2.4 Navigable', description: 'Headings and labels describe topic or purpose' },
  { id: '2.4.7', name: 'Focus Visible', level: 'AA', guideline: '2.4 Navigable', description: 'Keyboard focus indicator is visible' },
  { id: '3.2.3', name: 'Consistent Navigation', level: 'AA', guideline: '3.2 Predictable', description: 'Navigation mechanisms are consistent' },
  { id: '3.2.4', name: 'Consistent Identification', level: 'AA', guideline: '3.2 Predictable', description: 'Components with same functionality are identified consistently' },
  { id: '3.3.3', name: 'Error Suggestion', level: 'AA', guideline: '3.3 Input Assistance', description: 'Suggestions for correcting errors are provided' },
  { id: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)', level: 'AA', guideline: '3.3 Input Assistance', description: 'Submissions are reversible, checked, or confirmed' },
];

// ==================== Site Inventory Types ====================

export interface HeadingInfo {
  level: number;        // 1-6
  text: string;
  axNodeId?: string;
}

export interface HeadingStructure {
  headings: HeadingInfo[];
  hasH1: boolean;
  isHierarchyValid: boolean;  // No skipped levels
}

export interface FormFieldInfo {
  type: string;         // textbox, checkbox, radio, combobox, etc.
  name: string;         // accessible name
  hasLabel: boolean;
  isRequired: boolean;
  axNodeId?: string;
}

export interface FormInventory {
  id?: string;
  name: string;         // accessible name or inferred purpose
  fields: FormFieldInfo[];
  hasSubmitButton: boolean;
  axNodeId?: string;
}

export interface InteractiveElement {
  role: string;         // button, link, menuitem, etc.
  name: string;         // accessible name
  hasKeyboardAccess: boolean;
  axNodeId?: string;
}

export interface ImageInventory {
  hasAltText: boolean;
  altText?: string;
  isDecorative: boolean;
  axNodeId?: string;
}

export interface TableInventory {
  hasHeaders: boolean;
  rowCount: number;
  columnCount: number;
  caption?: string;
  axNodeId?: string;
}

export interface NavigationPattern {
  type: 'main-nav' | 'footer-nav' | 'sidebar-nav' | 'breadcrumb' | 'skip-link';
  name: string;
  itemCount: number;
  landmarkRole?: string;
}

export interface PageInventory {
  url: string;
  pageRank: number;
  title: string;
  hasLangAttribute: boolean;
  headings: HeadingStructure;
  forms: FormInventory[];
  interactiveElements: InteractiveElement[];
  landmarks: string[];        // banner, main, navigation, etc.
  images: ImageInventory[];
  tables: TableInventory[];
  liveRegions: string[];      // aria-live region types found
  hasSkipLink: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  path: string[];             // Array of URLs in order
  totalPageRank: number;      // Sum of PageRank scores
  complexity: number;         // path.length * avg complexity
}

export interface SiteInventory {
  rootUrl: string;
  crawledAt: string;
  pages: PageInventory[];
  globalElements: {
    navigation: NavigationPattern[];
    hasSkipLinks: boolean;
    hasSearchForm: boolean;
    commonLandmarks: string[];
  };
  suggestedWorkflows: Workflow[];
  graph: Map<string, string[]>;       // URL adjacency list
  pageRanks: Map<string, number>;     // URL -> PageRank score
}

// ==================== Task Template Types ====================

export type TaskCategory = 'navigation' | 'forms' | 'content' | 'widgets' | 'workflow';

export interface ElementMatcher {
  // Match pages that have these elements
  hasForm?: boolean;
  hasTable?: boolean;
  hasImages?: boolean;
  hasHeadings?: boolean;
  hasLandmarks?: string[];
  hasInteractiveElements?: string[];  // roles
  minPageRank?: number;
}

export interface WCAGTaskTemplate {
  id: string;
  wcagCriteria: string[];     // e.g., ["2.1.1", "2.1.2"]
  level: WCAGLevel;
  category: TaskCategory;
  goalTemplate: string;       // Template with {placeholders}
  applicableTo: ElementMatcher;
  successCriteria: SuccessCriteria;
  priority: number;           // 1-10, higher = more important
  isCompound: boolean;        // true for multi-step workflows
  estimatedSteps: number;     // expected step count
}

// ==================== Generated Task Types ====================

export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export interface GeneratedTestCase {
  id: string;
  url: string;
  goal: string;
  wcagCriteria: string[];
  level: WCAGLevel;
  category: TaskCategory;
  complexity: TaskComplexity;
  estimatedSteps: number;
  pageRankScore: number;
  successCriteria: SuccessCriteria;
  tags: string[];
  templateId?: string;        // Which template generated this
  workflowId?: string;        // If part of a workflow
  spaAware: boolean;          // Requires dynamic content handling
}

// ==================== Execution & Results Types ====================

export interface TaskResult {
  testCase: GeneratedTestCase;
  run: BenchmarkRun;
  wcagViolations: WCAGViolation[];
  diagnostics: TaskDiagnostics;
}

export interface WCAGViolation {
  criterionId: string;
  criterionName: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  evidence?: string;
  recommendation?: string;
}

export interface TaskDiagnostics {
  stepsToCompletion: number;
  keyboardTrapsDetected: number;
  unlabeledElementsFound: number;
  missingAltTextCount: number;
  focusLostCount: number;
  liveRegionAnnouncementsReceived: number;
}

// ==================== Report Types ====================

export interface WCAGCoverage {
  totalCriteria: number;
  testedCriteria: number;
  passedCriteria: number;
  failedCriteria: number;
  coveragePercent: number;
  byLevel: {
    A: { tested: number; passed: number; total: number };
    AA: { tested: number; passed: number; total: number };
  };
}

export interface CategoryResults {
  category: TaskCategory;
  totalTasks: number;
  passed: number;
  failed: number;
  passRate: number;
  avgSteps: number;
}

export interface WCAGCriterionResult {
  criterion: WCAGCriterion;
  tasksTested: number;
  tasksPassed: number;
  passRate: number;
  violations: WCAGViolation[];
}

export interface BehavioralAuditReport {
  url: string;
  timestamp: string;
  durationMs: number;
  configuration: BehavioralAuditOptions;

  summary: {
    totalTasks: number;
    generated: number;
    executed: number;
    passed: number;
    failed: number;
    passRate: number;
    wcagCoverage: WCAGCoverage;
  };

  byCategory: CategoryResults[];
  byWCAGCriterion: WCAGCriterionResult[];
  taskResults: TaskResult[];
  recommendations: string[];

  // Metadata
  pagesAnalyzed: number;
  workflowsGenerated: number;
  pageRankStats: {
    min: number;
    max: number;
    avg: number;
  };
}

// ==================== Options Types ====================

export interface BehavioralAuditOptions {
  // WCAG configuration
  level: 'A' | 'AA' | 'both';
  maxTasks: number;

  // Execution configuration
  parallel: number;
  maxStepsPerTask: number;
  model: string;
  taskTimeout: number;          // timeout per task in ms

  // Output configuration
  outputPath?: string;
  verbose: boolean;

  // PageRank configuration
  pageRankWeight: number;       // 0-1, default 0.4
  maxPagesToAnalyze: number;
  crawlDepth: number;

  // Task generation configuration
  taskDistribution: {
    simple: number;             // percentage
    moderate: number;
    complex: number;
  };

  // SPA configuration
  waitForDynamicContent: boolean;
  dynamicContentTimeout: number;
}

export const DEFAULT_AUDIT_OPTIONS: BehavioralAuditOptions = {
  level: 'AA',
  maxTasks: 20,
  parallel: 1,                    // Run sequentially by default to avoid browser conflicts
  maxStepsPerTask: 50,
  model: 'openai/gpt-4o',
  taskTimeout: 120000,            // 2 minutes per task
  verbose: false,
  pageRankWeight: 0.4,
  maxPagesToAnalyze: 50,
  crawlDepth: 2,
  taskDistribution: {
    simple: 30,
    moderate: 50,
    complex: 20,
  },
  waitForDynamicContent: true,
  dynamicContentTimeout: 5000,
};

// ==================== Event Types ====================

export type BehavioralAuditEvent =
  | { type: 'audit_started'; url: string; options: BehavioralAuditOptions }
  | { type: 'crawl_started'; url: string }
  | { type: 'crawl_progress'; pagesAnalyzed: number; totalPages: number }
  | { type: 'crawl_completed'; pageCount: number }
  | { type: 'tasks_generated'; taskCount: number; byCategory: Record<TaskCategory, number> }
  | { type: 'task_started'; taskId: string; goal: string }
  | { type: 'task_completed'; taskId: string; passed: boolean; stepsCount: number }
  | { type: 'audit_completed'; report: BehavioralAuditReport }
  | { type: 'audit_error'; error: string };

export type BehavioralAuditEventCallback = (event: BehavioralAuditEvent) => void;
