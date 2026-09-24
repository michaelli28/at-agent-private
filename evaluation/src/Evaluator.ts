import { AXNode } from '@adf/browser/types';
import { AgentTrace } from '@adf/agent/types';
import { Violation, PageMetadata } from './types';

export class Evaluator {
  /**
   * Evaluates the session for accessibility violations.
   * Combines static analysis of the final AXTree with dynamic analysis of the interaction trace.
   */
  evaluate(axTree: AXNode[], trace: AgentTrace, metadata?: PageMetadata): Violation[] {
    const violations: Violation[] = [];

    // 1. Static Analysis (on the provided tree snapshot)
    violations.push(...this.checkMissingNames(axTree));
    violations.push(...this.checkImages(axTree));
    violations.push(...this.checkLandmarks(axTree));
    violations.push(...this.checkLinkPurpose(axTree));

    // 2. Metadata Analysis
    if (metadata) {
      violations.push(...this.checkPageTitle(metadata));
      violations.push(...this.checkLanguage(metadata));
      violations.push(...this.checkParsing(metadata));
    }

    // 3. Dynamic Analysis (on the interaction history)
    violations.push(...this.checkFocusTraps(trace));

    return violations;
  }

  /**
   * Check WCAG 4.1.2: Name, Role, Value.
   * Specifically looks for interactive roles missing a name.
   */
  private checkMissingNames(nodes: AXNode[]): Violation[] {
    const violations: Violation[] = [];
    const interactiveRoles = ['button', 'link', 'menuitem', 'checkbox', 'radio', 'textbox', 'combobox', 'listbox'];

    for (const node of nodes) {
      const role = node.role?.value;
      // Ensure role is a string and is interactive
      if (role && typeof role === 'string' && interactiveRoles.includes(role)) {
        const name = node.name?.value;
        // Check if name is missing or empty
        if (!name || (typeof name === 'string' && name.trim() === '')) {
          violations.push({
            ruleId: 'WCAG-4.1.2',
            description: `Interactive element with role '${role}' has no accessible name.`,
            severity: 'critical',
            axNodeId: node.nodeId,
            evidence: `Node (BackendID: ${node.backendDOMNodeId}) has role '${role}' but name is empty.`
          });
        }
      }
    }
    return violations;
  }

  /**
   * Check WCAG 1.1.1: Non-text Content.
   * Checks for images missing alt text (name).
   */
  private checkImages(nodes: AXNode[]): Violation[] {
    const violations: Violation[] = [];
    for (const node of nodes) {
      if (node.role?.value === 'image') {
        const name = node.name?.value;
        if (!name || (typeof name === 'string' && name.trim() === '')) {
          // Note: Decorative images should be ignored by the AX tree or have role="presentation".
          // If they appear in the AX tree as 'image', they usually need a name.
          violations.push({
            ruleId: 'WCAG-1.1.1',
            description: 'Image missing alternative text.',
            severity: 'serious',
            axNodeId: node.nodeId,
            evidence: `Image node (BackendID: ${node.backendDOMNodeId}) has no name.`
          });
        }
      }
    }
    return violations;
  }

  /**
   * Check WCAG 2.4.1: Bypass Blocks.
   * Checks for the presence of at least one landmark role (main, navigation, search, etc.).
   */
  private checkLandmarks(nodes: AXNode[]): Violation[] {
    const landmarkRoles = ['banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation', 'region', 'search'];
    const hasLandmark = nodes.some(node =>
      node.role?.value && typeof node.role.value === 'string' && landmarkRoles.includes(node.role.value)
    );

    if (!hasLandmark && nodes.length > 0) {
      return [{
        ruleId: 'WCAG-2.4.1',
        description: 'Page lacks landmark regions (main, navigation, etc.) to allow bypassing blocks.',
        severity: 'moderate',
        evidence: 'No nodes with landmark roles found in the accessibility tree.'
      }];
    }
    return [];
  }

  /**
   * Check WCAG 2.4.4: Link Purpose (In Context).
   * Checks for suspicious link text like "click here", "read more".
   */
  private checkLinkPurpose(nodes: AXNode[]): Violation[] {
    const violations: Violation[] = [];
    const suspiciousTexts = ['click here', 'read more', 'more', 'here', 'link', 'go'];

    for (const node of nodes) {
      if (node.role?.value === 'link') {
        const name = node.name?.value;
        if (typeof name === 'string' && suspiciousTexts.includes(name.toLowerCase().trim())) {
          violations.push({
            ruleId: 'WCAG-2.4.4',
            description: `Link text "${name}" may not describe the purpose of the link.`,
            severity: 'moderate',
            axNodeId: node.nodeId,
            evidence: `Link (BackendID: ${node.backendDOMNodeId}) has generic text: "${name}".`
          });
        }
      }
    }
    return violations;
  }

  /**
   * Check WCAG 2.4.2: Page Titled.
   */
  private checkPageTitle(metadata: PageMetadata): Violation[] {
    if (!metadata.title || metadata.title.trim() === '') {
      return [{
        ruleId: 'WCAG-2.4.2',
        description: 'Page is missing a title.',
        severity: 'serious',
        evidence: 'document.title is empty.'
      }];
    }
    return [];
  }

  /**
   * Check WCAG 3.1.1: Language of Page.
   */
  private checkLanguage(metadata: PageMetadata): Violation[] {
    if (!metadata.lang || metadata.lang.trim() === '') {
      return [{
        ruleId: 'WCAG-3.1.1',
        description: 'Page is missing a language attribute.',
        severity: 'serious',
        evidence: 'document.documentElement.lang is empty.'
      }];
    }
    return [];
  }

  /**
   * Check WCAG 4.1.1: Parsing.
   * Checks for duplicate IDs.
   */
  private checkParsing(metadata: PageMetadata): Violation[] {
    const violations: Violation[] = [];
    if (metadata.duplicateIds && metadata.duplicateIds.length > 0) {
      violations.push({
        ruleId: 'WCAG-4.1.1',
        description: 'Page contains duplicate IDs.',
        severity: 'moderate',
        evidence: `Duplicate IDs found: ${metadata.duplicateIds.join(', ')}`
      });
    }
    return violations;
  }

  /**
   * Check WCAG 2.1.2: No Keyboard Trap.
   * Heuristic: If the agent presses TAB repeatedly without the focused element changing (or description changing).
   */
  private checkFocusTraps(trace: AgentTrace): Violation[] {
    const violations: Violation[] = [];
    let consecutiveStaticTabs = 0;
    let lastObservationText = '';

    for (const step of trace.steps) {
      if (step.action.type === 'KEY_PRESS' && step.action.key === 'Tab') {
        if (step.observation.text === lastObservationText) {
          consecutiveStaticTabs++;
        } else {
          consecutiveStaticTabs = 0;
        }
        lastObservationText = step.observation.text;

        if (consecutiveStaticTabs >= 5) {
          violations.push({
            ruleId: 'WCAG-2.1.2',
            description: 'Possible Keyboard Trap: Focus did not move or change context after 5 consecutive Tabs.',
            severity: 'critical',
            evidence: `Step ${step.stepNumber}: Observed "${lastObservationText}" repeatedly after pressing Tab.`
          });
          // Break to avoid reporting the same trap multiple times for the same sequence
          break;
        }
      } else {
        // Reset on non-tab actions
        consecutiveStaticTabs = 0;
      }
    }

    return violations;
  }

  /**
   * Runs the WCAG 2.2 Section 2 ("Operable") evaluation pipeline.
   */
  evaluateSection2(axTree: AXNode[], trace: AgentTrace, metadata: PageMetadata): import('./types').Section2CheckResult[] {
    const section2Evaluator = new Section2Evaluator();
    return section2Evaluator.evaluate(axTree, trace, metadata);
  }
}

import { Section2Evaluator } from './operable/Section2Evaluator';
