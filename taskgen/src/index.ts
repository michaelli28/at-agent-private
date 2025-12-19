/**
 * Task Generation Module - Automatic accessibility task generation.
 *
 * This module provides tools to automatically generate accessibility testing tasks
 * that cover all HTML elements across a website for WCAG 2.1 AA compliance.
 */

// Types
export * from './types';

// Core modules
export { ElementCrawler } from './element-crawler';
export { CoverageAlgorithm } from './coverage';
export { TaskGenerator } from './task-generator';
export { CoverageTracker, AgentTrace, AgentStep, PerceptualSnapshot } from './coverage-tracker';

// Templates
export {
  ATOMIC_TEMPLATES,
  JOURNEY_TEMPLATES,
  buildTaskFromTemplate,
  generateTaskId,
  getAtomicTemplates,
  getJourneyTemplates,
} from './templates';

// Orchestrator
export {
  TaskGenerationOrchestrator,
  generateTasksForUrl,
  loadGraphFromFile,
  generateTasksFromGraph,
} from './orchestrator';
