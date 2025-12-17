/**
 * BehavioralAudit - Main orchestrator for WCAG behavioral audits
 *
 * This class coordinates:
 * 1. Site analysis (PageRank + AX tree inventory)
 * 2. Task generation (WCAG templates + LLM synthesis)
 * 3. Task execution (via existing Agent)
 * 4. Report generation (WCAG-mapped results)
 */

import { SiteAnalyzer } from './SiteAnalyzer';
import { TaskGenerator } from './TaskGenerator';
import {
  BehavioralAuditOptions,
  BehavioralAuditReport,
  BehavioralAuditEventCallback,
  DEFAULT_AUDIT_OPTIONS,
  GeneratedTestCase,
  TaskResult,
  WCAGViolation,
  WCAGCoverage,
  CategoryResults,
  WCAGCriterionResult,
  TaskDiagnostics,
  TaskCategory,
  SiteInventory,
  WCAG_A_CRITERIA,
  WCAG_AA_CRITERIA,
} from './types';
import { AgentOpenrouter } from '../AgentOpenrouter';
import { ScreenReaderDriver, BrowserClient } from '@adf/virtual-screen-reader';
import { BenchmarkRun } from '../../benchmarks/types';
import { AgentTrace } from '../types';

export class BehavioralAudit {
  private options: BehavioralAuditOptions;
  private onEvent?: BehavioralAuditEventCallback;

  constructor(options: Partial<BehavioralAuditOptions> = {}) {
    this.options = { ...DEFAULT_AUDIT_OPTIONS, ...options };
  }

  /**
   * Set event callback for progress updates.
   */
  setEventCallback(callback: BehavioralAuditEventCallback): void {
    this.onEvent = callback;
  }

  /**
   * Run a full behavioral audit on a website.
   */
  async run(url: string): Promise<BehavioralAuditReport> {
    const startTime = Date.now();

    this.emit({ type: 'audit_started', url, options: this.options });

    // Phase 1: Analyze the site
    const analyzer = new SiteAnalyzer({
      maxPages: this.options.maxPagesToAnalyze,
      crawlDepth: this.options.crawlDepth,
      pageRankWeight: this.options.pageRankWeight,
      onEvent: this.onEvent,
      verbose: this.options.verbose,
    });

    const inventory = await analyzer.analyze(url);

    // Phase 2: Generate test tasks
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    const generator = new TaskGenerator(apiKey, {
      level: this.options.level,
      maxTasks: this.options.maxTasks,
      taskDistribution: this.options.taskDistribution,
      pageRankWeight: this.options.pageRankWeight,
      model: this.options.model,
    });

    const tasks = await generator.generateTasks(inventory);

    this.emit({
      type: 'tasks_generated',
      taskCount: tasks.length,
      byCategory: this.countByCategory(tasks),
    });

    // Phase 3: Execute tasks
    const results = await this.executeTasks(tasks);

    // Phase 4: Generate report
    const report = this.generateReport(url, tasks, results, startTime, inventory);

    this.emit({ type: 'audit_completed', report });

    return report;
  }

  /**
   * Execute all generated tasks.
   */
  private async executeTasks(tasks: GeneratedTestCase[]): Promise<TaskResult[]> {
    const results: TaskResult[] = [];

    // Execute tasks in batches for parallelism
    const batchSize = this.options.parallel;

    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(task => this.executeTask(task))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Execute a single task with timeout.
   */
  private async executeTask(task: GeneratedTestCase): Promise<TaskResult> {
    this.emit({ type: 'task_started', taskId: task.id, goal: task.goal });

    const startTime = Date.now();
    let trace: AgentTrace | null = null;
    let error: string | undefined;
    let browserClient: BrowserClient | null = null;

    try {
      // Create browser and driver
      browserClient = new BrowserClient();
      await browserClient.launch(true); // headless

      const logger = this.options.verbose ? (msg: string) => console.log(`[SR] ${msg}`) : undefined;
      const driver = new ScreenReaderDriver(browserClient, logger, {
        verbose: this.options.verbose,
        enableLiveRegions: task.spaAware,
      });

      // Navigate to the task URL before running the agent
      // Note: AgentOpenrouter.run() handles driver.enable() and driver.disable() internally
      await driver.enable();
      await browserClient.goto(task.url);
      await driver.disable(); // Disable before agent run since agent will re-enable

      // Wait for dynamic content if SPA-aware
      if (task.spaAware && this.options.waitForDynamicContent) {
        await new Promise(resolve =>
          setTimeout(resolve, this.options.dynamicContentTimeout)
        );
      }

      // Create and run agent
      // AgentOpenrouter.run() handles driver.enable/disable internally
      const agent = new AgentOpenrouter({
        driver,
        model: this.options.model,
        apiKey: process.env.OPENROUTER_API_KEY,
        onLog: this.options.verbose ? (msg) => console.log(`[Agent] ${msg}`) : undefined,
      });

      if (this.options.verbose) {
        console.log(`[Task ${task.id}] Starting agent run for goal: ${task.goal.substring(0, 80)}...`);
      }

      // Run agent with timeout
      const timeoutPromise = new Promise<AgentTrace>((_, reject) => {
        setTimeout(() => reject(new Error(`Task timed out after ${this.options.taskTimeout}ms`)), this.options.taskTimeout);
      });

      trace = await Promise.race([
        agent.run(task.goal),
        timeoutPromise
      ]);

      if (this.options.verbose) {
        console.log(`[Task ${task.id}] Agent finished: success=${trace.success}, steps=${trace.steps.length}, reason=${trace.reason || trace.error || 'none'}`);
      }

    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (this.options.verbose) {
        console.error(`[Task ${task.id}] Error during execution:`, error);
      }
    } finally {
      // Always close the browser
      if (browserClient) {
        try {
          await browserClient.close();
        } catch (closeError) {
          // Ignore close errors
          if (this.options.verbose) {
            console.warn(`[Task ${task.id}] Warning: Failed to close browser:`, closeError);
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;

    // Create benchmark run from trace
    const run = this.createBenchmarkRun(task, trace, durationMs, error);

    // Extract WCAG violations from trace
    const violations = trace ? this.extractViolations(task, trace) : [];

    // Compute diagnostics
    const diagnostics = trace ? this.computeDiagnostics(trace) : this.emptyDiagnostics();

    this.emit({
      type: 'task_completed',
      taskId: task.id,
      passed: run.success,
      stepsCount: run.stepsCount,
    });

    return {
      testCase: task,
      run,
      wcagViolations: violations,
      diagnostics,
    };
  }

  /**
   * Create a BenchmarkRun from agent trace.
   */
  private createBenchmarkRun(
    task: GeneratedTestCase,
    trace: AgentTrace | null,
    durationMs: number,
    error?: string
  ): BenchmarkRun {
    const success = trace?.success ?? false;
    const criteriaResult = this.evaluateCriteria(task, trace);

    return {
      runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      testCaseId: task.id,
      model: this.options.model,
      timestamp: Date.now(),
      durationMs,
      success: success && criteriaResult === 'pass',
      criteriaResult,
      stepsCount: trace?.steps.length ?? 0,
      loopsCount: trace?.steps.length ?? 0,
      agentSuccess: success,
      agentReason: trace?.reason ?? error ?? 'Unknown',
      error,
      trace: trace ?? {
        goal: task.goal,
        success: false,
        steps: [],
        error,
      },
    };
  }

  /**
   * Evaluate success criteria for a task.
   */
  private evaluateCriteria(
    task: GeneratedTestCase,
    trace: AgentTrace | null
  ): 'pass' | 'fail' | 'pending' {
    if (!trace) return 'fail';

    const criteria = task.successCriteria;

    switch (criteria.type) {
      case 'agent_success':
        return trace.success ? 'pass' : 'fail';

      case 'contains_text':
        const text = criteria.text.toLowerCase();
        const reason = (trace.reason || trace.error || '').toLowerCase();
        return reason.includes(text) ? 'pass' : 'fail';

      case 'regex':
        const pattern = new RegExp(criteria.pattern, 'i');
        const content = trace.reason || trace.error || '';
        return pattern.test(content) ? 'pass' : 'fail';

      case 'manual':
        return 'pending';

      default:
        return trace.success ? 'pass' : 'fail';
    }
  }

  /**
   * Extract WCAG violations from agent trace.
   */
  private extractViolations(task: GeneratedTestCase, trace: AgentTrace): WCAGViolation[] {
    const violations: WCAGViolation[] = [];

    if (!trace.success) {
      // Map failure to WCAG criteria
      for (const criterionId of task.wcagCriteria) {
        const criterion = [...WCAG_A_CRITERIA, ...WCAG_AA_CRITERIA].find(c => c.id === criterionId);
        if (criterion) {
          violations.push({
            criterionId: criterion.id,
            criterionName: criterion.name,
            severity: criterion.level === 'A' ? 'critical' : 'serious',
            description: `Task failed: ${task.goal}`,
            evidence: trace.reason || trace.error,
            recommendation: `Review ${criterion.name} (WCAG ${criterion.id}) compliance`,
          });
        }
      }
    }

    // Check for specific issues in trace
    const diagnostics = this.computeDiagnostics(trace);

    if (diagnostics.keyboardTrapsDetected > 0) {
      violations.push({
        criterionId: '2.1.2',
        criterionName: 'No Keyboard Trap',
        severity: 'critical',
        description: `Keyboard trap detected: focus was stuck ${diagnostics.keyboardTrapsDetected} times`,
        recommendation: 'Ensure all interactive elements can be exited using keyboard',
      });
    }

    if (diagnostics.unlabeledElementsFound > 0) {
      violations.push({
        criterionId: '4.1.2',
        criterionName: 'Name, Role, Value',
        severity: 'serious',
        description: `${diagnostics.unlabeledElementsFound} interactive elements without accessible names`,
        recommendation: 'Add aria-label or visible labels to all interactive elements',
      });
    }

    return violations;
  }

  /**
   * Compute diagnostics from agent trace.
   */
  private computeDiagnostics(trace: AgentTrace): TaskDiagnostics {
    let keyboardTrapsDetected = 0;
    let unlabeledElementsFound = 0;
    let focusLostCount = 0;
    let liveRegionAnnouncementsReceived = 0;
    let previousElement = '';
    let stuckCount = 0;

    for (const step of trace.steps) {
      const observation = step.observation?.text || '';

      // Detect keyboard traps (same element announced repeatedly despite Tab)
      if (step.action?.type === 'KEY_PRESS' && step.action.key === 'Tab') {
        if (observation === previousElement && observation) {
          stuckCount++;
          if (stuckCount >= 3) {
            keyboardTrapsDetected++;
            stuckCount = 0;
          }
        } else {
          stuckCount = 0;
        }
      }
      previousElement = observation;

      // Detect unlabeled elements (empty announcements for interactive elements)
      if (observation.match(/^(button|link|textbox|checkbox|radio)\s*$/i)) {
        unlabeledElementsFound++;
      }

      // Detect focus loss (empty observations)
      if (!observation && step.action?.type === 'KEY_PRESS') {
        focusLostCount++;
      }

      // Count live region announcements
      if (observation.includes('live region') || observation.includes('alert')) {
        liveRegionAnnouncementsReceived++;
      }
    }

    return {
      stepsToCompletion: trace.steps.length,
      keyboardTrapsDetected,
      unlabeledElementsFound,
      missingAltTextCount: 0, // Would need image-specific analysis
      focusLostCount,
      liveRegionAnnouncementsReceived,
    };
  }

  /**
   * Return empty diagnostics.
   */
  private emptyDiagnostics(): TaskDiagnostics {
    return {
      stepsToCompletion: 0,
      keyboardTrapsDetected: 0,
      unlabeledElementsFound: 0,
      missingAltTextCount: 0,
      focusLostCount: 0,
      liveRegionAnnouncementsReceived: 0,
    };
  }

  /**
   * Generate the final audit report.
   */
  private generateReport(
    url: string,
    tasks: GeneratedTestCase[],
    results: TaskResult[],
    startTime: number,
    inventory: SiteInventory
  ): BehavioralAuditReport {
    const passed = results.filter(r => r.run.success).length;
    const failed = results.length - passed;

    // Compute WCAG coverage
    const wcagCoverage = this.computeWCAGCoverage(tasks, results);

    // Compute category results
    const byCategory = this.computeCategoryResults(results);

    // Compute criterion results
    const byWCAGCriterion = this.computeCriterionResults(results);

    // Generate recommendations
    const recommendations = this.generateRecommendations(results, wcagCoverage);

    // PageRank stats
    const pageRankValues: number[] = Array.from(inventory.pageRanks?.values() || []);
    const pageRankStats = {
      min: pageRankValues.length > 0 ? Math.min(...pageRankValues) : 0,
      max: pageRankValues.length > 0 ? Math.max(...pageRankValues) : 0,
      avg: pageRankValues.length > 0
        ? pageRankValues.reduce((a: number, b: number) => a + b, 0) / pageRankValues.length
        : 0,
    };

    return {
      url,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      configuration: this.options,
      summary: {
        totalTasks: tasks.length,
        generated: tasks.length,
        executed: results.length,
        passed,
        failed,
        passRate: results.length > 0 ? (passed / results.length) * 100 : 0,
        wcagCoverage,
      },
      byCategory,
      byWCAGCriterion,
      taskResults: results,
      recommendations,
      pagesAnalyzed: inventory.pages?.length || 0,
      workflowsGenerated: inventory.suggestedWorkflows?.length || 0,
      pageRankStats,
    };
  }

  /**
   * Compute WCAG coverage statistics.
   */
  private computeWCAGCoverage(tasks: GeneratedTestCase[], results: TaskResult[]): WCAGCoverage {
    const allCriteria = new Set([...WCAG_A_CRITERIA, ...WCAG_AA_CRITERIA].map(c => c.id));
    const testedCriteria = new Set<string>();
    const passedCriteria = new Set<string>();
    const failedCriteria = new Set<string>();

    for (const result of results) {
      for (const criterion of result.testCase.wcagCriteria) {
        testedCriteria.add(criterion);
        if (result.run.success) {
          passedCriteria.add(criterion);
        } else {
          failedCriteria.add(criterion);
        }
      }
    }

    // Level-specific counts
    const levelACriteria = WCAG_A_CRITERIA.map(c => c.id);
    const levelAACriteria = WCAG_AA_CRITERIA.map(c => c.id);

    const aStats = {
      total: levelACriteria.length,
      tested: levelACriteria.filter(id => testedCriteria.has(id)).length,
      passed: levelACriteria.filter(id => passedCriteria.has(id) && !failedCriteria.has(id)).length,
    };

    const aaStats = {
      total: levelAACriteria.length,
      tested: levelAACriteria.filter(id => testedCriteria.has(id)).length,
      passed: levelAACriteria.filter(id => passedCriteria.has(id) && !failedCriteria.has(id)).length,
    };

    return {
      totalCriteria: allCriteria.size,
      testedCriteria: testedCriteria.size,
      passedCriteria: passedCriteria.size - failedCriteria.size,
      failedCriteria: failedCriteria.size,
      coveragePercent: (testedCriteria.size / allCriteria.size) * 100,
      byLevel: {
        A: aStats,
        AA: aaStats,
      },
    };
  }

  /**
   * Compute results by category.
   */
  private computeCategoryResults(results: TaskResult[]): CategoryResults[] {
    const categories: TaskCategory[] = ['navigation', 'forms', 'content', 'widgets', 'workflow'];
    const categoryResults: CategoryResults[] = [];

    for (const category of categories) {
      const categoryTasks = results.filter(r => r.testCase.category === category);
      if (categoryTasks.length === 0) continue;

      const passed = categoryTasks.filter(r => r.run.success).length;
      const avgSteps = categoryTasks.reduce((sum, r) => sum + r.run.stepsCount, 0) / categoryTasks.length;

      categoryResults.push({
        category,
        totalTasks: categoryTasks.length,
        passed,
        failed: categoryTasks.length - passed,
        passRate: (passed / categoryTasks.length) * 100,
        avgSteps,
      });
    }

    return categoryResults;
  }

  /**
   * Compute results by WCAG criterion.
   */
  private computeCriterionResults(results: TaskResult[]): WCAGCriterionResult[] {
    const criterionMap = new Map<string, { passed: number; failed: number; violations: WCAGViolation[] }>();

    for (const result of results) {
      for (const criterionId of result.testCase.wcagCriteria) {
        if (!criterionMap.has(criterionId)) {
          criterionMap.set(criterionId, { passed: 0, failed: 0, violations: [] });
        }
        const entry = criterionMap.get(criterionId)!;

        if (result.run.success) {
          entry.passed++;
        } else {
          entry.failed++;
          entry.violations.push(...result.wcagViolations.filter(v => v.criterionId === criterionId));
        }
      }
    }

    const allCriteria = [...WCAG_A_CRITERIA, ...WCAG_AA_CRITERIA];
    const criterionResults: WCAGCriterionResult[] = [];

    for (const criterion of allCriteria) {
      const entry = criterionMap.get(criterion.id);
      if (!entry) continue;

      const total = entry.passed + entry.failed;
      criterionResults.push({
        criterion,
        tasksTested: total,
        tasksPassed: entry.passed,
        passRate: total > 0 ? (entry.passed / total) * 100 : 0,
        violations: entry.violations,
      });
    }

    // Sort by pass rate ascending (worst first)
    criterionResults.sort((a, b) => a.passRate - b.passRate);

    return criterionResults;
  }

  /**
   * Generate recommendations based on results.
   */
  private generateRecommendations(results: TaskResult[], coverage: WCAGCoverage): string[] {
    const recommendations: string[] = [];

    // Check overall pass rate
    const passRate = results.filter(r => r.run.success).length / results.length * 100;
    if (passRate < 50) {
      recommendations.push('Critical: Overall accessibility compliance is below 50%. Consider a comprehensive accessibility review.');
    }

    // Check Level A compliance
    if (coverage.byLevel.A.passed < coverage.byLevel.A.tested) {
      const failedA = coverage.byLevel.A.tested - coverage.byLevel.A.passed;
      recommendations.push(`Level A violations: ${failedA} Level A criteria failed. These are minimum requirements for accessibility.`);
    }

    // Aggregate violation types
    const violationCounts = new Map<string, number>();
    for (const result of results) {
      for (const violation of result.wcagViolations) {
        violationCounts.set(
          violation.criterionId,
          (violationCounts.get(violation.criterionId) || 0) + 1
        );
      }
    }

    // Top violations
    const topViolations = Array.from(violationCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    for (const [criterionId, count] of topViolations) {
      const criterion = [...WCAG_A_CRITERIA, ...WCAG_AA_CRITERIA].find(c => c.id === criterionId);
      if (criterion) {
        recommendations.push(`WCAG ${criterionId} (${criterion.name}): Failed ${count} times. ${criterion.description}`);
      }
    }

    // Keyboard trap warning
    const trapsDetected = results.some(r => r.diagnostics.keyboardTrapsDetected > 0);
    if (trapsDetected) {
      recommendations.push('Critical: Keyboard traps detected. Users may get stuck and unable to navigate. Review focus management.');
    }

    // Missing labels warning
    const unlabeledCount = results.reduce((sum, r) => sum + r.diagnostics.unlabeledElementsFound, 0);
    if (unlabeledCount > 0) {
      recommendations.push(`${unlabeledCount} interactive elements found without accessible names. Add aria-label attributes.`);
    }

    return recommendations;
  }

  /**
   * Count tasks by category.
   */
  private countByCategory(tasks: GeneratedTestCase[]): Record<TaskCategory, number> {
    const counts: Record<TaskCategory, number> = {
      navigation: 0,
      forms: 0,
      content: 0,
      widgets: 0,
      workflow: 0,
    };

    for (const task of tasks) {
      counts[task.category]++;
    }

    return counts;
  }

  /**
   * Emit an event.
   */
  private emit(event: Parameters<BehavioralAuditEventCallback>[0]): void {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}

/**
 * Create a BehavioralAudit instance with default options.
 */
export function createBehavioralAudit(options?: Partial<BehavioralAuditOptions>): BehavioralAudit {
  return new BehavioralAudit(options);
}
