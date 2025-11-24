"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reporter = void 0;
class Reporter {
    /**
     * Generates a machine-readable JSON report.
     */
    toJSON(violations, trace) {
        return {
            summary: {
                goal: trace.goal,
                success: trace.success,
                totalViolations: violations.length,
                criticalViolations: violations.filter(v => v.severity === 'critical').length,
                steps: trace.steps.length,
                error: trace.error
            },
            violations,
            trace: trace.steps.map(step => ({
                step: step.stepNumber,
                action: step.action,
                observation: step.observation.text,
                result: step.result.success ? 'Success' : 'Failed'
            }))
        };
    }
    /**
     * Generates a human-readable Markdown report.
     */
    toMarkdown(violations, trace) {
        const summary = `
# Accessibility Audit Report

**Goal:** "${trace.goal}"
**Result:** ${trace.success ? '✅ Success' : '❌ Failed'}
**Violations Found:** ${violations.length}
`;
        const violationsSection = violations.length > 0
            ? `## 🚨 Violations\n\n${violations.map(v => this.formatViolation(v)).join('\n\n')}`
            : `## ✅ No Violations Found`;
        const traceSection = `
## 👣 Agent Replay Trace

| Step | Action | Observation | Result |
|------|--------|-------------|--------|
${trace.steps.map(s => `| ${s.stepNumber} | \`${this.formatAction(s.action)}\` | "${this.truncate(s.observation.text)}" | ${s.result.success ? '✅' : '❌'} |`).join('\n')}
`;
        return `${summary}\n${violationsSection}\n${traceSection}`;
    }
    formatViolation(v) {
        return `### [${v.ruleId}] ${v.description}
- **Severity:** ${v.severity.toUpperCase()}
- **Evidence:** ${v.evidence}
- **Node ID:** \`${v.axNodeId || 'N/A'}\``;
    }
    formatAction(action) {
        if (action.type === 'KEY_PRESS')
            return `Key: ${action.key}`;
        return action.type;
    }
    truncate(str, len = 50) {
        return str.length > len ? str.substring(0, len) + '...' : str;
    }
}
exports.Reporter = Reporter;
