import { Page } from 'playwright';
import { IAccessibilityDriver } from '@adf/virtual-screen-reader';
import { AgentOpenrouter } from './AgentOpenrouter';
import { AgentMinimal, MinimalTrace, MinimalStep } from './AgentMinimal';
import { AgentStep, AgentTrace, DebugEvent, DebugEventCallback, BeforeLlmRequestCallback, LogCallback } from './types';
import { parseGoalSteps, formatStepAsGoal, ParsedStep } from './goalParser';

/**
 * Navigation mode for stepwise execution
 * - 'full': Uses AgentOpenrouter with screen reader (requires driver)
 * - 'minimal': Uses AgentMinimal with tab-based navigation (requires page)
 */
export type StepwiseNavigationMode = 'full' | 'minimal';

/**
 * Trace for a single step in stepwise execution
 */
export interface StepTrace {
  stepNumber: number;
  stepGoal: string;
  originalStepText: string;
  success: boolean;
  steps: AgentStep[];
  reason?: string;
  error?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Full trace for stepwise execution
 */
export interface StepwiseTrace {
  goal: string;
  parsedSteps: ParsedStep[];
  stepTraces: StepTrace[];
  success: boolean;
  failedAtStep?: number;
  reason?: string;
  error?: string;
  totalTokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Options for full navigation mode (screen reader)
 */
export interface AgentStepwiseFullOptions {
  navigationMode: 'full';
  driver: IAccessibilityDriver;
  page?: never;
  apiKey?: string;
  model?: string;
  onLog?: LogCallback;
  onDebug?: DebugEventCallback;
  beforeLlmRequest?: BeforeLlmRequestCallback;
  onStep?: (step: AgentStep) => void;
}

/**
 * Options for minimal navigation mode (tab-based)
 */
export interface AgentStepwiseMinimalOptions {
  navigationMode: 'minimal';
  page: Page;
  driver?: never;
  apiKey?: string;
  model?: string;
  onLog?: LogCallback;
  onDebug?: DebugEventCallback;
  beforeLlmRequest?: BeforeLlmRequestCallback;
  onStep?: (step: AgentStep) => void;
}

/**
 * Legacy options (defaults to full mode for backwards compatibility)
 */
export interface AgentStepwiseLegacyOptions {
  navigationMode?: never;
  driver: IAccessibilityDriver;
  page?: never;
  apiKey?: string;
  model?: string;
  onLog?: LogCallback;
  onDebug?: DebugEventCallback;
  beforeLlmRequest?: BeforeLlmRequestCallback;
  onStep?: (step: AgentStep) => void;
}

export type AgentStepwiseOptions = AgentStepwiseFullOptions | AgentStepwiseMinimalOptions | AgentStepwiseLegacyOptions;

/**
 * AgentStepwise - Executes multi-step goals one step at a time.
 *
 * Token Optimization Strategy:
 * - Parses the full goal into individual numbered steps
 * - Runs each step with a fresh agent context (minimal message history)
 * - Preserves browser/driver state between steps
 * - Passes minimal state context to next agent
 *
 * Navigation Modes:
 * - 'full': Uses AgentOpenrouter with full screen reader navigation
 * - 'minimal': Uses AgentMinimal with tab-based navigation
 *
 * Benefits:
 * - Reduced token usage per LLM call
 * - Each step has focused, simple instructions
 * - Fresh context window for each step
 */
export class AgentStepwise {
  private navigationMode: StepwiseNavigationMode;
  private driver?: IAccessibilityDriver;
  private page?: Page;
  private apiKey: string;
  private model: string;
  private onLog?: LogCallback;
  private onDebug?: DebugEventCallback;
  private beforeLlmRequest?: BeforeLlmRequestCallback;
  private onStep?: (step: AgentStep) => void;

  constructor(options: AgentStepwiseOptions) {
    // Determine navigation mode
    if ('navigationMode' in options && options.navigationMode === 'minimal') {
      this.navigationMode = 'minimal';
      this.page = options.page;
    } else {
      // Default to full mode (backwards compatible)
      this.navigationMode = 'full';
      this.driver = (options as AgentStepwiseFullOptions | AgentStepwiseLegacyOptions).driver;
    }

    this.apiKey = options.apiKey || process.env['OPENROUTER_API_KEY'] || '';
    this.model = options.model || 'google/gemini-2.0-flash-001';
    this.onLog = options.onLog;
    this.onDebug = options.onDebug;
    this.beforeLlmRequest = options.beforeLlmRequest;
    this.onStep = options.onStep;
  }

  private log(message: string) {
    if (this.onLog) {
      this.onLog(message);
    }
  }

  private emitDebug(type: DebugEvent['type'], data: unknown) {
    if (this.onDebug) {
      this.onDebug({ type, timestamp: Date.now(), data });
    }
  }

  /**
   * Convert MinimalStep to AgentStep for consistent trace format
   */
  private convertMinimalStep(step: MinimalStep): AgentStep {
    return {
      stepNumber: step.stepNumber,
      thought: step.thought,
      action: {
        tool: step.action,
        args: {},
      },
      observation: step.observation,
      success: step.success,
    };
  }

  /**
   * Convert MinimalTrace to AgentTrace for consistent handling
   */
  private convertMinimalTrace(trace: MinimalTrace): AgentTrace {
    return {
      goal: trace.goal,
      success: trace.success,
      steps: trace.steps.map(s => this.convertMinimalStep(s)),
      reason: trace.reason,
      error: trace.error,
      totalTokens: trace.totalTokens,
    };
  }

  /**
   * Run the full goal by executing each step sequentially
   */
  async run(goal: string): Promise<StepwiseTrace> {
    // Parse goal into steps
    const parsedSteps = parseGoalSteps(goal);

    this.log(`\n=== AgentStepwise: Parsed ${parsedSteps.length} steps (${this.navigationMode} mode) ===`);
    parsedSteps.forEach((step) => {
      this.log(`  Step ${step.stepNumber}: ${step.text.substring(0, 60)}...`);
    });

    // Emit init event
    this.emitDebug('init', {
      goal,
      parsedSteps,
      model: this.model,
      mode: 'stepwise',
      navigationMode: this.navigationMode,
    });

    const stepTraces: StepTrace[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (const step of parsedSteps) {
      this.log(`\n--- Starting Step ${step.stepNumber}/${parsedSteps.length} ---`);
      this.log(`Goal: ${step.text}`);

      // Format step as goal for the agent
      const stepGoal = formatStepAsGoal(step);

      // Create debug handler that adds step context
      const stepDebugHandler = (event: DebugEvent) => {
        this.emitDebug(event.type, {
          ...event.data as object,
          stepNumber: step.stepNumber,
          totalSteps: parsedSteps.length,
        });
      };

      // Run the step with the appropriate agent
      let stepResult: AgentTrace;

      if (this.navigationMode === 'minimal' && this.page) {
        // Use minimal agent (tab-based navigation)
        const stepAgent = new AgentMinimal({
          page: this.page,
          apiKey: this.apiKey,
          model: this.model,
          onLog: this.onLog,
          onDebug: stepDebugHandler,
          beforeLlmRequest: this.beforeLlmRequest,
        });

        const minimalResult = await stepAgent.run(stepGoal);
        stepResult = this.convertMinimalTrace(minimalResult);
      } else if (this.driver) {
        // Use full agent (screen reader navigation)
        const stepAgent = new AgentOpenrouter({
          driver: this.driver,
          apiKey: this.apiKey,
          model: this.model,
          onLog: this.onLog,
          onDebug: stepDebugHandler,
          beforeLlmRequest: this.beforeLlmRequest,
          onStep: this.onStep,
        });

        stepResult = await stepAgent.run(stepGoal);
      } else {
        throw new Error('No driver or page provided for stepwise execution');
      }

      // Accumulate token usage
      if (stepResult.totalTokens) {
        totalPromptTokens += stepResult.totalTokens.prompt;
        totalCompletionTokens += stepResult.totalTokens.completion;
      }

      // Record step trace
      const stepTrace: StepTrace = {
        stepNumber: step.stepNumber,
        stepGoal,
        originalStepText: step.text,
        success: stepResult.success,
        steps: stepResult.steps,
        reason: stepResult.reason,
        error: stepResult.error,
        tokens: stepResult.totalTokens,
      };
      stepTraces.push(stepTrace);

      this.log(`[Step ${step.stepNumber}] ${stepResult.success ? 'SUCCESS' : 'FAILED'}: ${stepResult.reason || stepResult.error || ''}`);

      // If step failed, stop execution
      if (!stepResult.success) {
        this.log(`\n=== Stepwise Execution FAILED at step ${step.stepNumber} ===`);

        const totalTokens = {
          prompt: totalPromptTokens,
          completion: totalCompletionTokens,
          total: totalPromptTokens + totalCompletionTokens,
        };

        this.emitDebug('finish', {
          success: false,
          failedAtStep: step.stepNumber,
          reason: stepResult.error || stepResult.reason,
          totalTokens,
        });

        return {
          goal,
          parsedSteps,
          stepTraces,
          success: false,
          failedAtStep: step.stepNumber,
          error: stepResult.error || stepResult.reason,
          totalTokens,
        };
      }
    }

    // All steps completed successfully
    this.log(`\n=== Stepwise Execution COMPLETED (${parsedSteps.length} steps) ===`);

    const totalTokens = {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalPromptTokens + totalCompletionTokens,
    };

    // Get final reason from last step
    const lastStepTrace = stepTraces[stepTraces.length - 1];
    const finalReason = lastStepTrace?.reason || 'All steps completed successfully';

    this.emitDebug('finish', {
      success: true,
      reason: finalReason,
      totalSteps: parsedSteps.length,
      totalTokens,
    });

    return {
      goal,
      parsedSteps,
      stepTraces,
      success: true,
      reason: finalReason,
      totalTokens,
    };
  }
}
