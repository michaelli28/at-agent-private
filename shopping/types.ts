import { AgentTrace } from '@adf/agent/types';

/**
 * Configuration for a shopping flow accessibility test
 */
export interface ShoppingFlowConfig {
  /** The URL of the e-commerce site to test */
  siteUrl: string;

  /** Search term to use for finding products */
  searchTerm: string;

  /** Which product to select from search results (0-indexed, default: 0) */
  productIndex?: number;

  /** Quantity to add to cart (default: 1) */
  quantity?: number;

  /** Whether to test the checkout flow (default: false) */
  completeCheckout?: boolean;

  /** LLM provider for semantic validation (default: 'openai') */
  llmProvider?: 'openai' | 'gemini';
}

/**
 * Names of steps in the shopping flow
 */
export type FlowStepName = 'search' | 'results' | 'product' | 'cart' | 'checkout';

/**
 * Types of accessibility validations
 */
export type ValidationType =
  | 'keyboard_reachable'
  | 'has_label'
  | 'alt_text_quality'
  | 'focus_visible'
  | 'aria_live'
  | 'heading_structure';

/**
 * A single accessibility validation to perform
 */
export interface Validation {
  /** Type of validation check */
  type: ValidationType;

  /** Description of what element/behavior to check */
  target: string;

  /** WCAG success criterion (e.g., "2.1.1", "1.1.1") */
  wcag: string;

  /** Severity level */
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
}

/**
 * A step in the shopping flow with its goal and validations
 */
export interface FlowStep {
  /** Name of this step */
  name: FlowStepName;

  /** Goal description for the agent */
  goal: string;

  /** Accessibility validations to run at this step */
  validations: Validation[];
}

/**
 * An accessibility violation found during testing
 */
export interface Violation {
  /** Type of validation that failed */
  type: ValidationType;

  /** WCAG success criterion */
  wcag: string;

  /** Severity level */
  severity: 'critical' | 'serious' | 'moderate' | 'minor';

  /** Human-readable description of the issue */
  message: string;

  /** What the screen reader announced (if applicable) */
  screenReaderOutput?: string;

  /** Suggested fix */
  remediation?: string;
}

/**
 * Result of a single step in the flow
 */
export interface StepResult {
  /** Name of the step */
  step: FlowStepName;

  /** Whether the agent successfully completed the step goal */
  agentSuccess: boolean;

  /** The agent's execution trace */
  agentTrace: AgentTrace;

  /** Accessibility violations found at this step */
  violations: Violation[];

  /** Screenshot as base64 data URL */
  screenshot?: string;

  /** Duration of this step in milliseconds */
  durationMs: number;

  /** Whether the step passed (agent succeeded + no critical violations) */
  passed: boolean;

  /** Reason if step failed */
  failureReason?: string;
}

/**
 * Final report for the entire shopping flow test
 */
export interface FlowReport {
  /** Site URL that was tested */
  siteUrl: string;

  /** Search term used */
  searchTerm: string;

  /** Timestamp when test started */
  startedAt: string;

  /** Timestamp when test completed */
  completedAt: string;

  /** Total duration in milliseconds */
  totalDurationMs: number;

  /** Results for each step */
  stepResults: StepResult[];

  /** Overall pass/fail */
  passed: boolean;

  /** Summary statistics */
  summary: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    totalViolations: number;
    criticalViolations: number;
    seriousViolations: number;
  };

  /** HTML report content */
  htmlReport?: string;
}
