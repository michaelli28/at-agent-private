import { Violation, AgentTrace } from './types';

export class Reporter {
  /**
   * Generates a machine-readable JSON report.
   */
  toJSON(violations: Violation[], trace: AgentTrace): object {
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
  toMarkdown(violations: Violation[], trace: AgentTrace): string {
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
${trace.steps.map(s => `| ${s.stepNumber} | \`${this.formatAction(s.action)}\` | "${this.truncate(s.observation.text)}" | ${s.result.success ? '✅' : '❌'} |\n> **Thought:** ${s.thought}`).join('\n')}
`;

    return `${summary}\n${violationsSection}\n${traceSection}`;
  }

  private formatViolation(v: Violation): string {
    return `### [${v.ruleId}] ${v.description}
- **Severity:** ${v.severity.toUpperCase()}
- **Evidence:** ${v.evidence}
- **Node ID:** \`${v.axNodeId || 'N/A'}\``;
  }

  private formatAction(action: any): string {
    if (action.type === 'KEY_PRESS') return `Key: ${action.key}`;
    return action.type;
  }

  private truncate(str: string, len: number = 50): string {
    return str.length > len ? str.substring(0, len) + '...' : str;
  }
}
