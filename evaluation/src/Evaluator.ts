import { AXNode } from '@adf/browser/types';
import { AgentTrace } from '@adf/agent/types';
import { Violation } from './types';

export class Evaluator {
  /**
   * Evaluates the session for accessibility violations.
   * Combines static analysis of the final AXTree with dynamic analysis of the interaction trace.
   */
  evaluate(axTree: AXNode[], trace: AgentTrace): Violation[] {
    const violations: Violation[] = [];

    // 1. Static Analysis (on the provided tree snapshot)
    violations.push(...this.checkMissingNames(axTree));
    violations.push(...this.checkKeyboardOperability(axTree));
    violations.push(...this.checkPageTitle(axTree));
    violations.push(...this.checkHeadingOrder(axTree));

    // 2. Dynamic Analysis (on the interaction history)
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
   * Check WCAG 2.1.1 / 2.1.3: Keyboard / Keyboard (No Exception).
   * Heuristic: Interactive elements must be focusable.
   */
  private checkKeyboardOperability(nodes: AXNode[]): Violation[] {
    const violations: Violation[] = [];
    const interactiveRoles = ['button', 'link', 'menuitem', 'checkbox', 'radio', 'textbox', 'combobox', 'listbox'];

    for (const node of nodes) {
      const role = node.role?.value;
      if (role && typeof role === 'string' && interactiveRoles.includes(role)) {
        const focusable = this.getBooleanProperty(node, 'focusable');
        if (focusable === false) {
          violations.push({
            ruleId: 'WCAG-2.1.1',
            description: `Interactive element with role '${role}' is not keyboard focusable.`,
            severity: 'serious',
            axNodeId: node.nodeId,
            evidence: `Node (BackendID: ${node.backendDOMNodeId}) has role '${role}' but 'focusable' is false.`
          });
        }
      }
    }

    return violations;
  }

  /**
   * Check WCAG 2.4.2: Page Titled.
   * Heuristic: Root document node should have a non-empty name (page title).
   */
  private checkPageTitle(nodes: AXNode[]): Violation[] {
    const violations: Violation[] = [];
    const docNode = nodes.find(n => {
      const role = n.role?.value;
      return role === 'document' || role === 'RootWebArea' || role === 'WebArea';
    });

    if (docNode) {
      const title = docNode.name?.value;
      if (!title || (typeof title === 'string' && title.trim() === '')) {
        violations.push({
          ruleId: 'WCAG-2.4.2',
          description: 'Document is missing a descriptive page title.',
          severity: 'moderate',
          axNodeId: docNode.nodeId,
          evidence: `Root document node (BackendID: ${docNode.backendDOMNodeId}) has an empty or missing name.`
        });
      }
    }

    return violations;
  }

  /**
   * Check WCAG 2.4.6: Headings and Labels.
   * Heuristic: Heading levels should not skip more than one level (e.g., H1 -> H3).
   */
  private checkHeadingOrder(nodes: AXNode[]): Violation[] {
    const violations: Violation[] = [];
    const headings = nodes
      .filter(n => n.role?.value === 'heading')
      .map(n => {
        const levelProp = n.properties?.find(p => p.name === 'level');
        const level = typeof levelProp?.value?.value === 'number' ? levelProp.value.value : undefined;
        return { node: n, level };
      })
      .filter(h => typeof h.level === 'number');

    let lastLevel: number | null = null;
    for (const heading of headings) {
      if (lastLevel !== null && heading.level! - lastLevel > 1) {
        violations.push({
          ruleId: 'WCAG-2.4.6',
          description: `Heading levels skip from H${lastLevel} to H${heading.level}.`,
          severity: 'moderate',
          axNodeId: heading.node.nodeId,
          evidence: `Heading node (BackendID: ${heading.node.backendDOMNodeId}) level ${heading.level} follows level ${lastLevel}.`
        });
      }
      lastLevel = heading.level!;
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

  private getBooleanProperty(node: AXNode, name: string): boolean | undefined {
    const prop = node.properties?.find(p => p.name === name);
    const value = prop?.value?.value;
    if (typeof value === 'boolean') return value;
    return undefined;
  }
}
