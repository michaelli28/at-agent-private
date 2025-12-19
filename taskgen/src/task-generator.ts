/**
 * Task Generator - Generates accessibility testing tasks from element graphs.
 *
 * This module:
 * 1. Uses templates to generate atomic tasks per page/section
 * 2. Generates user journey tasks for multi-page workflows
 * 3. Generates coverage tasks to fill gaps in the spanning forest
 * 4. Generates adaptive tasks based on execution results
 */

import {
  SiteElementGraph,
  PageElementGraph,
  ElementNode,
  AccessibilityTask,
  TraversalPath,
  TaskExecutionResult,
  SimpleTask,
} from './types';
import { CoverageAlgorithm } from './coverage';
import {
  ATOMIC_TEMPLATES,
  JOURNEY_TEMPLATES,
  buildTaskFromTemplate,
  generateTaskId,
  TemplateContext,
} from './templates';

// ==================== Task Generator ====================

export class TaskGenerator {
  private coverageAlgo: CoverageAlgorithm;

  constructor() {
    this.coverageAlgo = new CoverageAlgorithm();
  }

  /**
   * Generate all tasks for a site graph.
   */
  generateAllTasks(graph: SiteElementGraph, includeJourneys: boolean = true): AccessibilityTask[] {
    const tasks: AccessibilityTask[] = [];

    // 1. Generate atomic tasks per page
    const atomicTasks = this.generateAtomicTasks(graph);
    tasks.push(...atomicTasks);

    // 2. Generate journey tasks
    if (includeJourneys) {
      const journeyTasks = this.generateJourneyTasks(graph);
      tasks.push(...journeyTasks);
    }

    // 3. Generate coverage tasks to fill gaps
    const coverageTasks = this.generateCoverageTasks(graph, tasks);
    tasks.push(...coverageTasks);

    // 4. Prioritize tasks
    return this.prioritizeTasks(tasks);
  }

  /**
   * Generate atomic tasks per element type per page.
   */
  generateAtomicTasks(graph: SiteElementGraph): AccessibilityTask[] {
    const tasks: AccessibilityTask[] = [];

    for (const [pageUrl, page] of graph.pages) {
      const context: TemplateContext = {
        pageUrl,
        pageTitle: page.title,
        elements: Array.from(page.elements.values()),
      };

      // Generate heading task if page has headings
      if (page.headings.length > 0) {
        const headingElements = page.headings.map((id) => page.elements.get(id)!).filter(Boolean);
        context.elements = headingElements;
        tasks.push(
          buildTaskFromTemplate(
            ATOMIC_TEMPLATES.headings,
            context,
            page.headings,
            8 // High priority - headings are foundational
          )
        );
      }

      // Generate landmark task if page has landmarks
      if (page.landmarks.length > 0) {
        const landmarkElements = page.landmarks.map((id) => page.elements.get(id)!).filter(Boolean);
        context.elements = landmarkElements;
        tasks.push(
          buildTaskFromTemplate(
            ATOMIC_TEMPLATES.landmarks,
            context,
            page.landmarks,
            9 // Highest priority - landmarks define structure
          )
        );
      }

      // Generate button task if page has buttons
      if (page.buttons.length > 0) {
        const buttonElements = page.buttons.map((id) => page.elements.get(id)!).filter(Boolean);
        context.elements = buttonElements;
        tasks.push(
          buildTaskFromTemplate(
            ATOMIC_TEMPLATES.buttons,
            context,
            page.buttons,
            7
          )
        );
      }

      // Generate form task if page has form fields
      if (page.formFields.length > 0) {
        const formElements = page.formFields.map((id) => page.elements.get(id)!).filter(Boolean);
        context.elements = formElements;
        context.formName = this.detectFormName(formElements);
        tasks.push(
          buildTaskFromTemplate(
            ATOMIC_TEMPLATES.forms,
            context,
            page.formFields,
            8 // High priority - forms are critical
          )
        );
      }

      // Generate link task if page has links
      if (page.links.length > 0) {
        const linkElements = page.links.map((id) => page.elements.get(id)!).filter(Boolean);
        context.elements = linkElements;
        tasks.push(
          buildTaskFromTemplate(
            ATOMIC_TEMPLATES.links,
            context,
            page.links,
            6
          )
        );
      }

      // Generate table task if page has tables
      if (page.tables.length > 0) {
        const tableElements = page.tables.map((id) => page.elements.get(id)!).filter(Boolean);
        context.elements = tableElements;
        tasks.push(
          buildTaskFromTemplate(
            ATOMIC_TEMPLATES.tables,
            context,
            page.tables,
            5
          )
        );
      }

      // Generate navigation task for the main page
      if (pageUrl === graph.baseUrl && page.landmarks.some((id) => {
        const el = page.elements.get(id);
        return el?.typeFlags.landmarkRole === 'navigation';
      })) {
        context.elements = Array.from(page.elements.values());
        tasks.push(
          buildTaskFromTemplate(
            ATOMIC_TEMPLATES.navigation,
            context,
            page.links.slice(0, 10),
            7
          )
        );
      }

      // Generate full page traversal for pages with many elements
      if (page.elementCount > 20) {
        context.elements = Array.from(page.elements.values());
        tasks.push(
          buildTaskFromTemplate(
            ATOMIC_TEMPLATES.fullPageTraversal,
            context,
            Array.from(page.elements.keys()),
            4 // Lower priority - comprehensive but slow
          )
        );
      }
    }

    return tasks;
  }

  /**
   * Generate user journey tasks for multi-page workflows.
   */
  generateJourneyTasks(graph: SiteElementGraph): AccessibilityTask[] {
    const tasks: AccessibilityTask[] = [];
    const baseUrl = graph.baseUrl;

    // Check if site likely has login functionality
    const hasLogin = this.detectFeature(graph, ['login', 'sign in', 'signin', 'log in']);
    if (hasLogin) {
      tasks.push(
        buildTaskFromTemplate(
          JOURNEY_TEMPLATES.login,
          { pageUrl: baseUrl, pageTitle: '', elements: [] },
          [],
          10 // Very high priority
        )
      );
    }

    // Check if site has search functionality
    const hasSearch = this.detectFeature(graph, ['search']);
    if (hasSearch) {
      tasks.push(
        buildTaskFromTemplate(
          JOURNEY_TEMPLATES.search,
          { pageUrl: baseUrl, pageTitle: '', elements: [], searchQuery: 'test' },
          [],
          9
        )
      );
    }

    // Check if site has contact form
    const hasContact = this.detectFeature(graph, ['contact', 'contact us', 'get in touch']);
    if (hasContact) {
      tasks.push(
        buildTaskFromTemplate(
          JOURNEY_TEMPLATES.contactForm,
          { pageUrl: baseUrl, pageTitle: '', elements: [] },
          [],
          7
        )
      );
    }

    // Check if site is e-commerce (has add to cart, products, etc.)
    const hasEcommerce = this.detectFeature(graph, ['add to cart', 'buy now', 'shop', 'products', 'cart']);
    if (hasEcommerce) {
      tasks.push(
        buildTaskFromTemplate(
          JOURNEY_TEMPLATES.addToCart,
          { pageUrl: baseUrl, pageTitle: '', elements: [] },
          [],
          9
        )
      );

      tasks.push(
        buildTaskFromTemplate(
          JOURNEY_TEMPLATES.checkout,
          { pageUrl: baseUrl, pageTitle: '', elements: [] },
          [],
          8
        )
      );
    }

    // Generate navigation journeys for top pages
    const topPages = Array.from(graph.pages.keys()).slice(1, 4); // Skip base URL
    for (const targetUrl of topPages) {
      tasks.push(
        buildTaskFromTemplate(
          JOURNEY_TEMPLATES.navigation,
          { pageUrl: baseUrl, pageTitle: '', elements: [], targetUrl },
          [],
          6
        )
      );
    }

    return tasks;
  }

  /**
   * Generate coverage tasks to fill gaps not covered by atomic + journey tasks.
   */
  generateCoverageTasks(graph: SiteElementGraph, existingTasks: AccessibilityTask[]): AccessibilityTask[] {
    const tasks: AccessibilityTask[] = [];

    // Get elements already targeted by existing tasks
    const targetedElements = new Set<string>();
    for (const task of existingTasks) {
      for (const elementId of task.targetElements) {
        targetedElements.add(elementId);
      }
    }

    // Generate traversal paths for coverage
    const paths = this.coverageAlgo.generateTraversalPaths(graph);

    // Find paths that cover untargeted elements
    for (const path of paths) {
      const untargetedInPath = path.elements.filter((id) => !targetedElements.has(id));

      if (untargetedInPath.length > 0) {
        // Create a coverage task for this path
        const page = graph.pages.get(path.entryUrl);
        if (!page) continue;

        const task: AccessibilityTask = {
          id: generateTaskId(),
          type: 'coverage',
          url: path.entryUrl,
          goal: this.generateCoverageGoal(path, page, untargetedInPath),
          steps: [],
          targetElements: untargetedInPath,
          requiredActions: path.actions,
          expectedCoverage: untargetedInPath.length,
          wcagCriteria: ['4.1.2', '2.1.1'],
          elementTypes: [],
          priority: 3,
          dependencies: [],
          attempts: 0,
        };

        tasks.push(task);

        // Mark elements as targeted
        for (const elementId of untargetedInPath) {
          targetedElements.add(elementId);
        }
      }
    }

    return tasks;
  }

  /**
   * Generate adaptive tasks based on execution results.
   */
  generateAdaptiveTasks(
    graph: SiteElementGraph,
    executionResults: TaskExecutionResult[]
  ): AccessibilityTask[] {
    const tasks: AccessibilityTask[] = [];

    // Collect visited elements from all results
    const visitedElements = new Set<string>();
    for (const result of executionResults) {
      for (const elementId of result.visitedElements) {
        visitedElements.add(elementId);
      }
    }

    // Find elements that were targeted but not visited (missed targets)
    const missedElements: ElementNode[] = [];
    for (const result of executionResults) {
      for (const missedId of result.missedTargets) {
        for (const page of graph.pages.values()) {
          const element = page.elements.get(missedId);
          if (element && !visitedElements.has(missedId)) {
            missedElements.push(element);
          }
        }
      }
    }

    // Group missed elements by page
    const missedByPage = new Map<string, ElementNode[]>();
    for (const element of missedElements) {
      const existing = missedByPage.get(element.pageUrl) || [];
      existing.push(element);
      missedByPage.set(element.pageUrl, existing);
    }

    // Generate targeted tasks for missed elements
    for (const [pageUrl, elements] of missedByPage) {
      const elementNames = elements
        .slice(0, 5)
        .map((e) => e.name || e.role)
        .join(', ');

      const task: AccessibilityTask = {
        id: generateTaskId(),
        type: 'adaptive',
        url: pageUrl,
        goal: [
          `1. Navigate to ${pageUrl}.`,
          `2. Navigate to and locate these specific elements: ${elementNames}.`,
          `3. For each element, verify its accessible name and keyboard operability.`,
          `4. Report success with the reason listing which elements were found and any accessibility issues.`,
        ].join(' '),
        steps: [],
        targetElements: elements.map((e) => e.id),
        requiredActions: [],
        expectedCoverage: elements.length,
        wcagCriteria: ['4.1.2', '2.1.1'],
        elementTypes: [...new Set(elements.map((e) => e.role))],
        priority: 10, // High priority for adaptive tasks
        dependencies: [],
        attempts: 0,
      };

      tasks.push(task);
    }

    // Generate tasks for elements with violations that need re-verification
    const violationElements = new Map<string, { element: ElementNode; violations: string[] }>();
    for (const result of executionResults) {
      for (const violation of result.newViolations) {
        if (violation.elementId) {
          for (const page of graph.pages.values()) {
            const element = page.elements.get(violation.elementId);
            if (element) {
              const existing = violationElements.get(violation.elementId);
              if (existing) {
                existing.violations.push(violation.ruleId);
              } else {
                violationElements.set(violation.elementId, {
                  element,
                  violations: [violation.ruleId],
                });
              }
            }
          }
        }
      }
    }

    // Create re-verification tasks for violations
    for (const { element, violations } of violationElements.values()) {
      const task: AccessibilityTask = {
        id: generateTaskId(),
        type: 'adaptive',
        url: element.pageUrl,
        goal: [
          `1. Navigate to ${element.pageUrl}.`,
          `2. Navigate to element "${element.name || element.role}" which had violations: ${violations.join(', ')}.`,
          `3. Verify the accessibility issue is still present.`,
          `4. Report success with the reason describing whether the violation persists and its details.`,
        ].join(' '),
        steps: [],
        targetElements: [element.id],
        requiredActions: [],
        expectedCoverage: 1,
        wcagCriteria: violations,
        elementTypes: [element.role],
        priority: 15, // Highest priority for violation re-testing
        dependencies: [],
        attempts: 0,
      };

      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Prioritize and sort tasks for optimal execution order.
   */
  prioritizeTasks(tasks: AccessibilityTask[]): AccessibilityTask[] {
    return tasks.sort((a, b) => {
      // Higher priority first
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }

      // Then by expected coverage (more coverage first)
      if (b.expectedCoverage !== a.expectedCoverage) {
        return b.expectedCoverage - a.expectedCoverage;
      }

      // Then by type (atomic before journey before coverage)
      const typeOrder = { atomic: 1, journey: 2, coverage: 3, adaptive: 0 };
      return typeOrder[a.type] - typeOrder[b.type];
    });
  }

  /**
   * Convert tasks to simple format for agent execution.
   */
  toSimpleTasks(tasks: AccessibilityTask[]): SimpleTask[] {
    return tasks.map((task) => ({
      url: task.url,
      goal: task.goal,
    }));
  }

  /**
   * Detect form name from form elements.
   */
  private detectFormName(elements: ElementNode[]): string {
    // Look for common form indicators
    for (const element of elements) {
      const name = element.name?.toLowerCase() || '';
      if (name.includes('login') || name.includes('sign in')) return 'login form';
      if (name.includes('register') || name.includes('sign up')) return 'registration form';
      if (name.includes('search')) return 'search form';
      if (name.includes('contact')) return 'contact form';
      if (name.includes('checkout')) return 'checkout form';
      if (name.includes('payment')) return 'payment form';
    }
    return 'the form';
  }

  /**
   * Detect if a site has a specific feature based on element names.
   */
  private detectFeature(graph: SiteElementGraph, keywords: string[]): boolean {
    for (const page of graph.pages.values()) {
      for (const element of page.elements.values()) {
        const name = element.name?.toLowerCase() || '';
        for (const keyword of keywords) {
          if (name.includes(keyword.toLowerCase())) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Generate a coverage goal for a traversal path.
   */
  private generateCoverageGoal(
    path: TraversalPath,
    page: PageElementGraph,
    targetElements: string[]
  ): string {
    const elementDescriptions = targetElements
      .slice(0, 5)
      .map((id) => {
        const element = page.elements.get(id);
        return element ? `${element.role} "${element.name || 'unnamed'}"` : id;
      })
      .join(', ');

    return [
      `1. Navigate to ${page.title || path.entryUrl}.`,
      `2. Navigate through elements using Arrow Down or Tab.`,
      `3. Locate and verify these elements: ${elementDescriptions}.`,
      `4. For each element, note its accessible name and role.`,
      `5. Report success with the reason listing all elements found and any that lacked accessible names.`,
    ].join(' ');
  }
}
