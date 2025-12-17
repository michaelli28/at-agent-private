/**
 * WCAG Behavioral Audit Module
 *
 * Autonomous accessibility testing using PageRank analysis
 * and WCAG 2.1 Level A/AA compliance testing.
 */

// Main orchestrator
export { BehavioralAudit, createBehavioralAudit } from './BehavioralAudit';

// Site analysis
export { SiteAnalyzer } from './SiteAnalyzer';

// Task generation
export { TaskGenerator, createTaskGenerator } from './TaskGenerator';

// WCAG templates
export {
  WCAG_TASK_TEMPLATES,
  getTemplatesByLevel,
  getTemplatesByCategory,
  getTemplatesByCriterion,
  getWorkflowTemplates,
  getSimpleTemplates,
} from './WCAGTemplates';

// Types
export * from './types';
