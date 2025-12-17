/**
 * TaskGenerator - LLM-powered WCAG test task synthesis
 *
 * This module generates accessibility test tasks by:
 * 1. Matching WCAG templates to page elements
 * 2. Using LLM to synthesize compound workflows
 * 3. Prioritizing tasks using PageRank scores
 */

import {
  SiteInventory,
  PageInventory,
  GeneratedTestCase,
  WCAGTaskTemplate,
  TaskCategory,
  TaskComplexity,
  BehavioralAuditOptions,
  DEFAULT_AUDIT_OPTIONS,
  Workflow,
} from './types';
import { WCAG_TASK_TEMPLATES, getTemplatesByLevel, getWorkflowTemplates } from './WCAGTemplates';

// OpenRouter API types
interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface GenerationOptions {
  level: 'A' | 'AA' | 'both';
  maxTasks: number;
  taskDistribution: {
    simple: number;
    moderate: number;
    complex: number;
  };
  pageRankWeight: number;
  model: string;
}

const TASK_GENERATION_SYSTEM_PROMPT = `You are an expert accessibility tester specializing in WCAG 2.1 compliance testing.
Your job is to generate realistic, compound accessibility test tasks that a screen reader user would perform.

Guidelines for generating tasks:
1. Tasks should be realistic user workflows, not isolated technical checks
2. Compound tasks should test multiple WCAG criteria in a natural flow
3. Use specific page elements and content from the provided inventory
4. Tasks should be achievable using only keyboard and screen reader
5. Include specific actions (Tab, Enter, Arrow keys, H for headings, etc.)
6. Mention expected announcements or feedback the user should receive

Output format: Return a JSON array of task objects with these fields:
- goal: The task description (string)
- wcagCriteria: Array of WCAG criteria IDs being tested (e.g., ["2.1.1", "3.3.1"])
- complexity: "simple" | "moderate" | "complex"
- estimatedSteps: Number of expected steps
- category: "navigation" | "forms" | "content" | "widgets" | "workflow"`;

export class TaskGenerator {
  private apiKey: string;
  private options: GenerationOptions;

  constructor(apiKey: string, options: Partial<GenerationOptions> = {}) {
    this.apiKey = apiKey;
    this.options = {
      level: options.level || 'AA',
      maxTasks: options.maxTasks || DEFAULT_AUDIT_OPTIONS.maxTasks,
      taskDistribution: options.taskDistribution || DEFAULT_AUDIT_OPTIONS.taskDistribution,
      pageRankWeight: options.pageRankWeight || DEFAULT_AUDIT_OPTIONS.pageRankWeight,
      model: options.model || DEFAULT_AUDIT_OPTIONS.model,
    };
  }

  /**
   * Generate test tasks from site inventory.
   */
  async generateTasks(inventory: SiteInventory): Promise<GeneratedTestCase[]> {
    const tasks: GeneratedTestCase[] = [];

    // Step 1: Generate template-based tasks
    const templateTasks = this.instantiateTemplates(inventory);
    tasks.push(...templateTasks);

    // Step 2: Generate workflow-based tasks using LLM
    const workflowTasks = await this.generateWorkflowTasks(inventory);
    tasks.push(...workflowTasks);

    // Step 3: Prioritize and filter tasks
    const prioritizedTasks = this.prioritizeTasks(tasks, inventory.pageRanks);

    // Step 4: Ensure distribution and limit
    const distributedTasks = this.ensureDistribution(prioritizedTasks);

    return distributedTasks.slice(0, this.options.maxTasks);
  }

  /**
   * Instantiate WCAG templates with actual page elements.
   */
  private instantiateTemplates(inventory: SiteInventory): GeneratedTestCase[] {
    const tasks: GeneratedTestCase[] = [];
    const templates = getTemplatesByLevel(this.options.level);

    for (const page of inventory.pages) {
      for (const template of templates) {
        if (this.templateApplies(template, page)) {
          const instantiated = this.instantiateTemplate(template, page, inventory);
          if (instantiated) {
            tasks.push(instantiated);
          }
        }
      }
    }

    return tasks;
  }

  /**
   * Check if a template applies to a page based on element matchers.
   */
  private templateApplies(template: WCAGTaskTemplate, page: PageInventory): boolean {
    const matcher = template.applicableTo;

    if (matcher.hasForm !== undefined && matcher.hasForm !== (page.forms.length > 0)) {
      return false;
    }
    if (matcher.hasTable !== undefined && matcher.hasTable !== (page.tables.length > 0)) {
      return false;
    }
    if (matcher.hasImages !== undefined && matcher.hasImages !== (page.images.length > 0)) {
      return false;
    }
    if (matcher.hasHeadings !== undefined && matcher.hasHeadings !== (page.headings.headings.length > 0)) {
      return false;
    }
    if (matcher.hasLandmarks && matcher.hasLandmarks.length > 0) {
      const hasAll = matcher.hasLandmarks.every(l => page.landmarks.includes(l));
      if (!hasAll) return false;
    }
    if (matcher.hasInteractiveElements && matcher.hasInteractiveElements.length > 0) {
      const hasAny = matcher.hasInteractiveElements.some(role =>
        page.interactiveElements.some(el => el.role === role)
      );
      if (!hasAny) return false;
    }
    if (matcher.minPageRank !== undefined && page.pageRank < matcher.minPageRank) {
      return false;
    }

    return true;
  }

  /**
   * Instantiate a template with page-specific values.
   */
  private instantiateTemplate(
    template: WCAGTaskTemplate,
    page: PageInventory,
    inventory: SiteInventory
  ): GeneratedTestCase | null {
    let goal = template.goalTemplate;

    // Replace all placeholders with actual values (use regex for global replace)
    const replacePlaceholder = (placeholder: string, value: string) => {
      goal = goal.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    };

    // Page name/title replacements
    replacePlaceholder('{pageName}', page.title || 'the page');
    replacePlaceholder('{pageTitle}', page.title || 'Untitled');

    // Form-specific replacements
    if (page.forms.length > 0) {
      const form = page.forms[0];
      replacePlaceholder('{formName}', form.name);
    } else {
      // Provide default for form placeholders if no forms exist
      replacePlaceholder('{formName}', 'the form');
    }

    // Element type replacements
    if (template.applicableTo.hasInteractiveElements) {
      const roles = template.applicableTo.hasInteractiveElements;
      replacePlaceholder('{elementType}', roles.join(' and '));
    } else {
      replacePlaceholder('{elementType}', 'interactive elements');
    }

    // Search term replacement - generate contextual search term from page content
    if (goal.includes('{searchTerm}')) {
      const searchTerm = this.generateSearchTerm(page, inventory);
      replacePlaceholder('{searchTerm}', searchTerm);
    }

    // Workflow path replacements
    if (goal.includes('{startPage}') || goal.includes('{endPage}')) {
      const workflow = inventory.suggestedWorkflows.find(w => w.path.includes(page.url));
      if (workflow && workflow.path.length >= 2) {
        const startPage = inventory.pages.find(p => p.url === workflow.path[0]);
        const endPage = inventory.pages.find(p => p.url === workflow.path[workflow.path.length - 1]);
        replacePlaceholder('{startPage}', startPage?.title || 'start page');
        replacePlaceholder('{endPage}', endPage?.title || 'target page');
      } else {
        // Use homepage and current page as fallback
        const homePage = inventory.pages[0];
        replacePlaceholder('{startPage}', homePage?.title || 'homepage');
        replacePlaceholder('{endPage}', page.title || 'target page');
      }
    }

    // Final validation: skip tasks that still have unreplaced placeholders
    if (goal.includes('{') && goal.includes('}')) {
      const unreplaced = goal.match(/\{[^}]+\}/g);
      if (unreplaced && unreplaced.length > 0) {
        console.warn(`Skipping task with unreplaced placeholders: ${unreplaced.join(', ')}`);
        return null;
      }
    }

    // Determine complexity
    const complexity: TaskComplexity = template.isCompound
      ? (template.estimatedSteps > 20 ? 'complex' : 'moderate')
      : 'simple';

    return {
      id: `${template.id}-${this.generateShortId()}`,
      url: page.url,
      goal,
      wcagCriteria: template.wcagCriteria,
      level: template.level,
      category: template.category,
      complexity,
      estimatedSteps: template.estimatedSteps,
      pageRankScore: page.pageRank,
      successCriteria: template.successCriteria,
      tags: [template.category, ...template.wcagCriteria.map(c => `wcag-${c}`)],
      templateId: template.id,
      spaAware: false,
    };
  }

  /**
   * Generate a contextual search term based on page content.
   */
  private generateSearchTerm(page: PageInventory, inventory: SiteInventory): string {
    // Try to extract a meaningful term from the page
    // 1. Use a heading if available
    if (page.headings.headings.length > 0) {
      const heading = page.headings.headings[0];
      const words = heading.text.split(/\s+/).slice(0, 2).join(' ');
      if (words.length > 2) return words;
    }

    // 2. Use part of the page title
    if (page.title) {
      const words = page.title.split(/[\s|–-]+/).slice(0, 2).join(' ');
      if (words.length > 2) return words;
    }

    // 3. Default search terms based on common website content
    const defaults = ['contact', 'about', 'help', 'services', 'information'];
    return defaults[Math.floor(Math.random() * defaults.length)];
  }

  /**
   * Generate compound workflow tasks using LLM.
   */
  private async generateWorkflowTasks(inventory: SiteInventory): Promise<GeneratedTestCase[]> {
    const tasks: GeneratedTestCase[] = [];

    // Select top workflows for LLM generation
    const workflows = inventory.suggestedWorkflows.slice(0, 5);

    for (const workflow of workflows) {
      try {
        const workflowTasks = await this.generateTasksForWorkflow(workflow, inventory);
        tasks.push(...workflowTasks);
      } catch (error) {
        console.warn(`Failed to generate tasks for workflow ${workflow.id}:`, error);
      }
    }

    return tasks;
  }

  /**
   * Use LLM to generate tasks for a specific workflow.
   */
  private async generateTasksForWorkflow(
    workflow: Workflow,
    inventory: SiteInventory
  ): Promise<GeneratedTestCase[]> {
    // Build context about the workflow pages
    const pageContexts = workflow.path.map(url => {
      const page = inventory.pages.find(p => p.url === url);
      if (!page) return `URL: ${url}`;

      return `
Page: ${page.title} (${url})
PageRank: ${page.pageRank.toFixed(4)}
Landmarks: ${page.landmarks.join(', ') || 'none'}
Headings: ${page.headings.headings.slice(0, 5).map(h => `H${h.level}: ${h.text}`).join('; ')}
Forms: ${page.forms.map(f => `${f.name} (${f.fields.length} fields)`).join(', ') || 'none'}
Interactive elements: ${page.interactiveElements.slice(0, 10).map(e => `${e.role}: ${e.name}`).join(', ')}
Skip link: ${page.hasSkipLink ? 'yes' : 'no'}`;
    }).join('\n---\n');

    const userPrompt = `Generate 2-3 accessibility test tasks for this multi-page workflow:

Workflow: ${workflow.name}
Description: ${workflow.description}

Pages in workflow:
${pageContexts}

Requirements:
- Tasks should test keyboard navigation and screen reader announcements
- Focus on WCAG ${this.options.level === 'both' ? 'A and AA' : this.options.level} criteria
- Include specific steps and expected feedback
- Make tasks realistic for a screen reader user`;

    try {
      const response = await this.callOpenRouter(userPrompt);
      const parsedTasks = this.parseLLMResponse(response, workflow);
      return parsedTasks;
    } catch (error) {
      console.warn('LLM task generation failed:', error);
      return [];
    }
  }

  /**
   * Call OpenRouter API for task generation.
   */
  private async callOpenRouter(userPrompt: string): Promise<string> {
    const messages: OpenRouterMessage[] = [
      { role: 'system', content: TASK_GENERATION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/accessibility-driver-framework',
      },
      body: JSON.stringify({
        model: this.options.model,
        messages,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as OpenRouterResponse;
    return data.choices[0]?.message?.content || '';
  }

  /**
   * Parse LLM response into GeneratedTestCase objects.
   */
  private parseLLMResponse(response: string, workflow: Workflow): GeneratedTestCase[] {
    const tasks: GeneratedTestCase[] = [];

    try {
      // Try to extract JSON array from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn('No JSON array found in LLM response');
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        goal: string;
        wcagCriteria?: string[];
        complexity?: TaskComplexity;
        estimatedSteps?: number;
        category?: TaskCategory;
      }>;

      for (const item of parsed) {
        if (!item.goal) continue;

        tasks.push({
          id: `llm-workflow-${this.generateShortId()}`,
          url: workflow.path[0],
          goal: item.goal,
          wcagCriteria: item.wcagCriteria || ['2.1.1'],
          level: this.options.level === 'both' ? 'AA' : this.options.level,
          category: item.category || 'workflow',
          complexity: item.complexity || 'complex',
          estimatedSteps: item.estimatedSteps || 20,
          pageRankScore: workflow.totalPageRank,
          successCriteria: { type: 'agent_success' },
          tags: ['llm-generated', 'workflow', ...(item.wcagCriteria || []).map(c => `wcag-${c}`)],
          workflowId: workflow.id,
          spaAware: true,
        });
      }
    } catch (error) {
      console.warn('Failed to parse LLM response:', error);
    }

    return tasks;
  }

  /**
   * Prioritize tasks using PageRank scores and WCAG criteria importance.
   */
  private prioritizeTasks(
    tasks: GeneratedTestCase[],
    pageRanks: Map<string, number>
  ): GeneratedTestCase[] {
    // Score each task
    const scored = tasks.map(task => {
      // PageRank component (normalized)
      const maxPageRank = Math.max(...Array.from(pageRanks.values()));
      const normalizedPageRank = maxPageRank > 0 ? task.pageRankScore / maxPageRank : 0;

      // WCAG criteria importance (Level A > AA, more criteria = more important)
      const levelBonus = task.level === 'A' ? 0.2 : 0;
      const criteriaBonus = Math.min(task.wcagCriteria.length * 0.1, 0.3);

      // Complexity bonus (prefer moderate complexity)
      const complexityBonus = task.complexity === 'moderate' ? 0.1 : 0;

      const score = (
        this.options.pageRankWeight * normalizedPageRank +
        (1 - this.options.pageRankWeight) * (levelBonus + criteriaBonus + complexityBonus)
      );

      return { task, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Remove duplicates (same template on similar pages)
    const seen = new Set<string>();
    const unique = scored.filter(({ task }) => {
      const key = `${task.templateId || task.workflowId}-${task.wcagCriteria.join(',')}`;
      if (seen.has(key) && !task.workflowId) {
        // Allow workflow tasks with same criteria
        return false;
      }
      seen.add(key);
      return true;
    });

    return unique.map(({ task }) => task);
  }

  /**
   * Ensure task distribution matches configured percentages.
   */
  private ensureDistribution(tasks: GeneratedTestCase[]): GeneratedTestCase[] {
    const { simple, moderate, complex } = this.options.taskDistribution;
    const maxTasks = this.options.maxTasks;

    const targetSimple = Math.floor(maxTasks * simple / 100);
    const targetModerate = Math.floor(maxTasks * moderate / 100);
    const targetComplex = maxTasks - targetSimple - targetModerate;

    const simpleTasks = tasks.filter(t => t.complexity === 'simple');
    const moderateTasks = tasks.filter(t => t.complexity === 'moderate');
    const complexTasks = tasks.filter(t => t.complexity === 'complex');

    const result: GeneratedTestCase[] = [
      ...simpleTasks.slice(0, targetSimple),
      ...moderateTasks.slice(0, targetModerate),
      ...complexTasks.slice(0, targetComplex),
    ];

    // Fill remaining slots with any category
    const remaining = maxTasks - result.length;
    if (remaining > 0) {
      const unused = tasks.filter(t => !result.includes(t));
      result.push(...unused.slice(0, remaining));
    }

    return result;
  }

  /**
   * Generate a short unique ID.
   */
  private generateShortId(): string {
    return Math.random().toString(36).substring(2, 8);
  }
}

/**
 * Create a TaskGenerator instance with default configuration.
 */
export function createTaskGenerator(apiKey: string, options?: Partial<GenerationOptions>): TaskGenerator {
  return new TaskGenerator(apiKey, options);
}
