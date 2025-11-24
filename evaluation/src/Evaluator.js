"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Evaluator = void 0;
class Evaluator {
    /**
     * Evaluates the session for accessibility violations.
     * Combines static analysis of the final AXTree with dynamic analysis of the interaction trace.
     */
    evaluate(axTree, trace) {
        const violations = [];
        // 1. Static Analysis (on the provided tree snapshot)
        violations.push(...this.checkMissingNames(axTree));
        // 2. Dynamic Analysis (on the interaction history)
        violations.push(...this.checkFocusTraps(trace));
        return violations;
    }
    /**
     * Check WCAG 4.1.2: Name, Role, Value.
     * Specifically looks for interactive roles missing a name.
     */
    checkMissingNames(nodes) {
        const violations = [];
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
     * Check WCAG 2.1.2: No Keyboard Trap.
     * Heuristic: If the agent presses TAB repeatedly without the focused element changing (or description changing).
     */
    checkFocusTraps(trace) {
        const violations = [];
        let consecutiveStaticTabs = 0;
        let lastObservationText = '';
        for (const step of trace.steps) {
            if (step.action.type === 'KEY_PRESS' && step.action.key === 'Tab') {
                if (step.observation.text === lastObservationText) {
                    consecutiveStaticTabs++;
                }
                else {
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
            }
            else {
                // Reset on non-tab actions
                consecutiveStaticTabs = 0;
            }
        }
        return violations;
    }
}
exports.Evaluator = Evaluator;
