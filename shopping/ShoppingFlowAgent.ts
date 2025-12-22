import { BrowserClient, ScreenReaderDriver } from '@adf/virtual-screen-reader';
import { Agent } from '@adf/agent/Agent';
import { buildOpenAIModel } from '@adf/agent/OpenAIClient';
import { buildGeminiModel } from '@adf/agent/GeminiClient';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  ShoppingFlowConfig,
  FlowStep,
  StepResult,
  FlowReport,
  Violation,
} from './types';
import { buildFlowSteps, getStepDescription } from './flowSteps';
import { runValidations, analyzeAgentTraceForViolations } from './validators';
import { generateHtmlReport } from './reporter';

export interface ShoppingFlowAgentOptions {
  /** Run browser in headed mode for debugging */
  headed?: boolean;

  /** Callback for step progress updates */
  onStepStart?: (step: FlowStep, stepNumber: number, totalSteps: number) => void;
  onStepComplete?: (result: StepResult) => void;

  /** Callback for agent actions (for detailed logging) */
  onAgentAction?: (action: string) => void;
}

export class ShoppingFlowAgent {
  private client: BrowserClient;
  private driver: ScreenReaderDriver | null = null;
  private agent: Agent | null = null;
  private model: BaseChatModel;
  private options: ShoppingFlowAgentOptions;

  constructor(options: ShoppingFlowAgentOptions = {}) {
    this.client = new BrowserClient();
    this.options = options;
    this.model = null as any; // Will be initialized in runFlow
  }

  /**
   * Run the complete shopping flow accessibility test
   */
  async runFlow(config: ShoppingFlowConfig): Promise<FlowReport> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString();

    // Initialize model based on config
    this.model = config.llmProvider === 'gemini'
      ? buildGeminiModel()
      : buildOpenAIModel();

    // Build the flow steps
    const steps = buildFlowSteps(config);
    const stepResults: StepResult[] = [];

    try {
      // Launch browser (headless: boolean, browserType: string)
      await this.client.launch(!this.options.headed);
      await this.client.goto(config.siteUrl);

      // Initialize screen reader driver
      this.driver = new ScreenReaderDriver(this.client);
      await this.driver.enable();

      // Initialize agent
      this.agent = new Agent(
        this.driver,
        this.model,
        this.options.onAgentAction
          ? (step) => this.options.onAgentAction!(`${step.action.type} ${(step.action as any).key || (step.action as any).text || ''}`)
          : undefined
      );

      // Execute each step
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        // Notify step start
        if (this.options.onStepStart) {
          this.options.onStepStart(step, i + 1, steps.length);
        }

        const stepResult = await this.executeStep(step, config);
        stepResults.push(stepResult);

        // Notify step complete
        if (this.options.onStepComplete) {
          this.options.onStepComplete(stepResult);
        }

        // If step failed and it's a blocking failure, stop the flow
        if (!stepResult.agentSuccess) {
          // Check if it's a login-required situation
          const isLoginRequired = stepResult.failureReason?.toLowerCase().includes('login') ||
            stepResult.failureReason?.toLowerCase().includes('sign in');

          if (isLoginRequired && step.name === 'cart') {
            // Expected stopping point - not a failure
            stepResult.failureReason = 'Checkout requires login - stopping at cart step as configured';
          }

          // Stop flow on agent failure
          break;
        }
      }
    } finally {
      // Cleanup
      if (this.driver) {
        await this.driver.disable();
      }
      await this.client.close();
    }

    const completedAt = new Date().toISOString();
    const totalDurationMs = Date.now() - startTime;

    // Calculate summary statistics
    const summary = this.calculateSummary(stepResults);

    // Generate report
    const report: FlowReport = {
      siteUrl: config.siteUrl,
      searchTerm: config.searchTerm,
      startedAt,
      completedAt,
      totalDurationMs,
      stepResults,
      passed: summary.criticalViolations === 0 && summary.failedSteps === 0,
      summary,
    };

    // Generate HTML report
    report.htmlReport = generateHtmlReport(report);

    return report;
  }

  /**
   * Execute a single step in the flow
   */
  private async executeStep(step: FlowStep, config: ShoppingFlowConfig): Promise<StepResult> {
    const stepStartTime = Date.now();

    // Run the agent with the step's goal
    const trace = await this.agent!.run(step.goal);

    // Take screenshot after step completes
    let screenshot: string | undefined;
    try {
      const screenshotBuffer = await this.client.screenshot();
      screenshot = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
    } catch (e) {
      // Screenshot failed, continue without it
    }

    // Analyze the agent trace for accessibility violations
    const traceViolations = analyzeAgentTraceForViolations(trace, step);

    // Run additional validations based on the step configuration
    const validationViolations = await runValidations(
      step.validations,
      trace,
      this.model
    );

    // Combine all violations
    const allViolations = [...traceViolations, ...validationViolations];

    // Determine if step passed
    const hasCriticalViolation = allViolations.some(v => v.severity === 'critical');
    const passed = trace.success && !hasCriticalViolation;

    const durationMs = Date.now() - stepStartTime;

    return {
      step: step.name,
      agentSuccess: trace.success,
      agentTrace: trace,
      violations: allViolations,
      screenshot,
      durationMs,
      passed,
      failureReason: trace.success ? undefined : (trace.reason || trace.error || 'Unknown failure'),
    };
  }

  /**
   * Calculate summary statistics from step results
   */
  private calculateSummary(stepResults: StepResult[]) {
    const allViolations = stepResults.flatMap(r => r.violations);

    return {
      totalSteps: stepResults.length,
      passedSteps: stepResults.filter(r => r.passed).length,
      failedSteps: stepResults.filter(r => !r.passed).length,
      totalViolations: allViolations.length,
      criticalViolations: allViolations.filter(v => v.severity === 'critical').length,
      seriousViolations: allViolations.filter(v => v.severity === 'serious').length,
    };
  }
}
