/**
 * Orchestrator - Coordinates the full task generation and execution pipeline.
 *
 * This module:
 * 1. Phase 1: Crawls site, builds graph, generates initial tasks
 * 2. Phase 2: Executes tasks and tracks coverage
 * 3. Phase 3: Generates adaptive tasks to fill gaps
 * 4. Iterates until coverage threshold is met
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SiteElementGraph,
  AccessibilityTask,
  TaskGenConfig,
  FullPipelineConfig,
  FinalReport,
  CoverageMetrics,
  SimpleTask,
  TaskExecutionResult,
} from './types';
import { ElementCrawler } from './element-crawler';
import { CoverageAlgorithm } from './coverage';
import { TaskGenerator } from './task-generator';
import { CoverageTracker, AgentTrace } from './coverage-tracker';

// ==================== Orchestrator ====================

export class TaskGenerationOrchestrator {
  private crawler: ElementCrawler;
  private coverageAlgo: CoverageAlgorithm;
  private taskGen: TaskGenerator;
  private tracker: CoverageTracker | null = null;
  private graph: SiteElementGraph | null = null;

  constructor(options: { headless?: boolean } = {}) {
    this.crawler = new ElementCrawler({ headless: options.headless ?? true });
    this.coverageAlgo = new CoverageAlgorithm();
    this.taskGen = new TaskGenerator();
  }

  /**
   * Phase 1: Initial batch generation.
   * Crawl site, build graph, generate initial task set.
   */
  async generateInitialTasks(config: TaskGenConfig): Promise<{
    graph: SiteElementGraph;
    tasks: AccessibilityTask[];
    estimatedCoverage: CoverageMetrics;
  }> {
    console.log(`[Orchestrator] Starting Phase 1: Initial task generation for ${config.entryUrl}`);

    // Step 1: Crawl site and build element graph
    console.log('[Orchestrator] Crawling site...');
    this.graph = await this.crawler.crawlSite(config.entryUrl);

    // Compute spanning forest
    console.log('[Orchestrator] Computing spanning forest...');
    this.graph.spanningForest = this.coverageAlgo.computeSpanningForest(this.graph);

    // Step 2: Generate tasks
    console.log('[Orchestrator] Generating tasks...');
    const tasks = this.taskGen.generateAllTasks(
      this.graph,
      config.includeJourneyTasks
    );

    // Step 3: Initialize tracker
    this.tracker = new CoverageTracker(this.graph);

    // Step 4: Estimate coverage
    const targetedElements = new Set<string>();
    for (const task of tasks) {
      for (const elementId of task.targetElements) {
        targetedElements.add(elementId);
      }
    }
    const estimatedCoverage = this.coverageAlgo.computeCoverageMetrics(this.graph, targetedElements);

    console.log(`[Orchestrator] Generated ${tasks.length} tasks`);
    console.log(`[Orchestrator] Estimated coverage: ${estimatedCoverage.coveragePercent.toFixed(1)}%`);

    return {
      graph: this.graph,
      tasks,
      estimatedCoverage,
    };
  }

  /**
   * Phase 2: Process execution results and generate adaptive tasks.
   */
  async generateAdaptiveTasks(
    executionResults: Map<string, AgentTrace>,
    tasks: AccessibilityTask[]
  ): Promise<AccessibilityTask[]> {
    if (!this.tracker || !this.graph) {
      throw new Error('Must call generateInitialTasks first');
    }

    console.log('[Orchestrator] Processing execution results...');

    // Process each trace
    const taskResults: TaskExecutionResult[] = [];
    for (const [taskId, trace] of executionResults) {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        const result = this.tracker.processAgentTrace(taskId, trace, task);
        taskResults.push(result);
      }
    }

    // Get current coverage
    const coverage = this.tracker.getCoverageMetrics();
    console.log(`[Orchestrator] Current coverage: ${coverage.coveragePercent.toFixed(1)}%`);

    // Generate adaptive tasks
    console.log('[Orchestrator] Generating adaptive tasks...');
    const adaptiveTasks = this.taskGen.generateAdaptiveTasks(this.graph, taskResults);

    console.log(`[Orchestrator] Generated ${adaptiveTasks.length} adaptive tasks`);

    return adaptiveTasks;
  }

  /**
   * Get current coverage metrics.
   */
  getCoverageMetrics(): CoverageMetrics | null {
    return this.tracker?.getCoverageMetrics() || null;
  }

  /**
   * Check if coverage threshold has been met.
   */
  hasAchievedCoverage(threshold: number): boolean {
    return this.tracker?.hasAchievedCoverage(threshold) || false;
  }

  /**
   * Export tasks to JSON file.
   */
  async exportTasks(tasks: AccessibilityTask[], outputPath: string): Promise<void> {
    const simpleTasks = this.taskGen.toSimpleTasks(tasks);
    const content = JSON.stringify(simpleTasks, null, 2);

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(`[Orchestrator] Exported ${tasks.length} tasks to ${outputPath}`);
  }

  /**
   * Export detailed tasks (with metadata) to JSON file.
   */
  async exportDetailedTasks(tasks: AccessibilityTask[], outputPath: string): Promise<void> {
    const content = JSON.stringify(tasks, null, 2);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(`[Orchestrator] Exported detailed tasks to ${outputPath}`);
  }

  /**
   * Export site graph to JSON file.
   */
  async exportGraph(outputPath: string): Promise<void> {
    if (!this.graph) {
      throw new Error('No graph available. Call generateInitialTasks first.');
    }

    // Convert Maps to objects for JSON serialization
    const serializable = {
      baseUrl: this.graph.baseUrl,
      pages: Object.fromEntries(
        Array.from(this.graph.pages.entries()).map(([url, page]) => [
          url,
          {
            ...page,
            elements: Object.fromEntries(page.elements),
          },
        ])
      ),
      pageTransitions: this.graph.pageTransitions,
      totalElements: this.graph.totalElements,
      interactiveElements: this.graph.interactiveElements,
      landmarkElements: this.graph.landmarkElements,
      spanningForest: this.graph.spanningForest,
      crawledAt: this.graph.crawledAt,
      pageCount: this.graph.pageCount,
    };

    const content = JSON.stringify(serializable, null, 2);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(`[Orchestrator] Exported graph to ${outputPath}`);
  }

  /**
   * Generate final report.
   */
  generateReport(config: TaskGenConfig, tasks: AccessibilityTask[]): FinalReport {
    if (!this.graph || !this.tracker) {
      throw new Error('Must run pipeline first');
    }

    const coverage = this.tracker.getCoverageMetrics();
    const violations = this.tracker.getAllViolations();

    return {
      config,
      graph: this.graph,
      tasksGenerated: tasks.length,
      tasksExecuted: this.tracker.getTaskResults().size,
      coverage,
      violations,
      adaptiveRounds: 0, // Set by full pipeline
      totalDurationMs: 0, // Set by caller
      timestamp: new Date(),
    };
  }

  /**
   * Clean up resources.
   */
  async close(): Promise<void> {
    await this.crawler.close();
  }
}

// ==================== Standalone Functions ====================

/**
 * Generate tasks for a URL (simplified API).
 */
export async function generateTasksForUrl(
  url: string,
  options: {
    outputPath?: string;
    maxPages?: number;
    includeJourneys?: boolean;
    headless?: boolean;
  } = {}
): Promise<SimpleTask[]> {
  const orchestrator = new TaskGenerationOrchestrator({ headless: options.headless ?? true });

  try {
    const config: TaskGenConfig = {
      entryUrl: url,
      maxPages: options.maxPages ?? 20,
      maxDepth: 2,
      wcagLevel: 'AA',
      coverageThreshold: 80,
      includeJourneyTasks: options.includeJourneys ?? true,
      includeAtomicTasks: true,
    };

    const { tasks } = await orchestrator.generateInitialTasks(config);

    if (options.outputPath) {
      await orchestrator.exportTasks(tasks, options.outputPath);
    }

    return orchestrator.taskGen.toSimpleTasks(tasks);
  } finally {
    await orchestrator.close();
  }
}

/**
 * Load and parse an existing element graph from JSON.
 */
export function loadGraphFromFile(filePath: string): SiteElementGraph {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  // Convert objects back to Maps
  const pages = new Map<string, any>();
  for (const [url, page] of Object.entries(data.pages as Record<string, any>)) {
    pages.set(url, {
      ...page,
      elements: new Map(Object.entries(page.elements)),
    });
  }

  return {
    ...data,
    pages,
    crawledAt: new Date(data.crawledAt),
  };
}

/**
 * Generate tasks from an existing graph file.
 */
export function generateTasksFromGraph(graph: SiteElementGraph): AccessibilityTask[] {
  const taskGen = new TaskGenerator();
  return taskGen.generateAllTasks(graph, true);
}
