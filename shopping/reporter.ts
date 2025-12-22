import { FlowReport, StepResult, Violation, FlowStepName } from './types';
import { getStepDescription } from './flowSteps';

/**
 * Generate an HTML report from the flow results
 */
export function generateHtmlReport(report: FlowReport): string {
  const { siteUrl, searchTerm, stepResults, summary, startedAt, completedAt, totalDurationMs } = report;

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const severityColors: Record<string, string> = {
    critical: '#dc2626',
    serious: '#ea580c',
    moderate: '#ca8a04',
    minor: '#65a30d',
  };

  const stepIcons: Record<FlowStepName, string> = {
    search: '🔍',
    results: '📋',
    product: '🛍️',
    cart: '🛒',
    checkout: '💳',
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shopping Accessibility Report - ${escapeHtml(new URL(siteUrl).hostname)}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background: #f3f4f6;
      padding: 2rem;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      background: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin-bottom: 2rem;
    }

    .header h1 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }

    .header-meta {
      color: #6b7280;
      font-size: 0.875rem;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-top: 1.5rem;
    }

    .summary-card {
      background: #f9fafb;
      padding: 1rem;
      border-radius: 8px;
      text-align: center;
    }

    .summary-card.pass {
      background: #dcfce7;
      border: 1px solid #86efac;
    }

    .summary-card.fail {
      background: #fee2e2;
      border: 1px solid #fca5a5;
    }

    .summary-value {
      font-size: 2rem;
      font-weight: bold;
    }

    .summary-label {
      font-size: 0.75rem;
      color: #6b7280;
      text-transform: uppercase;
    }

    .flow-timeline {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem;
      background: white;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin-bottom: 2rem;
      overflow-x: auto;
    }

    .timeline-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      position: relative;
    }

    .timeline-step:not(:last-child)::after {
      content: '';
      position: absolute;
      top: 20px;
      left: 50%;
      width: 100%;
      height: 2px;
      background: #e5e7eb;
    }

    .timeline-step.passed:not(:last-child)::after {
      background: #86efac;
    }

    .timeline-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;
      background: #e5e7eb;
      position: relative;
      z-index: 1;
    }

    .timeline-step.passed .timeline-icon {
      background: #dcfce7;
    }

    .timeline-step.failed .timeline-icon {
      background: #fee2e2;
    }

    .timeline-step.skipped .timeline-icon {
      background: #f3f4f6;
      opacity: 0.5;
    }

    .timeline-label {
      margin-top: 0.5rem;
      font-size: 0.75rem;
      text-align: center;
      color: #6b7280;
    }

    .step-section {
      background: white;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin-bottom: 1.5rem;
      overflow: hidden;
    }

    .step-header {
      padding: 1rem 1.5rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      border-bottom: 1px solid #e5e7eb;
    }

    .step-header.passed {
      background: #f0fdf4;
    }

    .step-header.failed {
      background: #fef2f2;
    }

    .step-status {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.875rem;
    }

    .step-status.passed {
      background: #86efac;
    }

    .step-status.failed {
      background: #fca5a5;
    }

    .step-title {
      flex: 1;
      font-weight: 600;
    }

    .step-duration {
      color: #6b7280;
      font-size: 0.875rem;
    }

    .step-content {
      padding: 1.5rem;
    }

    .step-screenshot {
      max-width: 100%;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      margin-bottom: 1rem;
    }

    .violations-list {
      margin-top: 1rem;
    }

    .violation {
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 0.75rem;
      border-left: 4px solid;
    }

    .violation.critical {
      background: #fef2f2;
      border-left-color: #dc2626;
    }

    .violation.serious {
      background: #fff7ed;
      border-left-color: #ea580c;
    }

    .violation.moderate {
      background: #fefce8;
      border-left-color: #ca8a04;
    }

    .violation.minor {
      background: #f0fdf4;
      border-left-color: #65a30d;
    }

    .violation-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .violation-severity {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
      color: white;
    }

    .violation-wcag {
      font-size: 0.75rem;
      color: #6b7280;
      background: #e5e7eb;
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
    }

    .violation-message {
      margin-bottom: 0.5rem;
    }

    .violation-sr-output {
      font-family: monospace;
      font-size: 0.875rem;
      background: rgba(0,0,0,0.05);
      padding: 0.5rem;
      border-radius: 4px;
      margin-bottom: 0.5rem;
    }

    .violation-remediation {
      font-size: 0.875rem;
      color: #374151;
      padding-left: 1rem;
      border-left: 2px solid #e5e7eb;
    }

    .agent-trace {
      background: #1f2937;
      color: #e5e7eb;
      padding: 1rem;
      border-radius: 8px;
      font-family: monospace;
      font-size: 0.75rem;
      max-height: 300px;
      overflow-y: auto;
      margin-top: 1rem;
    }

    .trace-step {
      margin-bottom: 0.5rem;
      padding-left: 1rem;
      border-left: 2px solid #4b5563;
    }

    .trace-action {
      color: #60a5fa;
    }

    .trace-result {
      color: #a3e635;
    }

    .no-violations {
      color: #059669;
      padding: 1rem;
      background: #ecfdf5;
      border-radius: 8px;
      text-align: center;
    }

    .failure-reason {
      background: #fef2f2;
      color: #991b1b;
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
    }

    details {
      margin-top: 1rem;
    }

    summary {
      cursor: pointer;
      color: #6b7280;
      font-size: 0.875rem;
    }

    summary:hover {
      color: #374151;
    }

    .footer {
      text-align: center;
      color: #6b7280;
      font-size: 0.75rem;
      margin-top: 2rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Shopping Accessibility Report</h1>
      <div class="header-meta">
        <p><strong>Site:</strong> ${escapeHtml(siteUrl)}</p>
        <p><strong>Search term:</strong> "${escapeHtml(searchTerm)}"</p>
        <p><strong>Test completed:</strong> ${new Date(completedAt).toLocaleString()}</p>
        <p><strong>Duration:</strong> ${formatDuration(totalDurationMs)}</p>
      </div>

      <div class="summary-grid">
        <div class="summary-card ${report.passed ? 'pass' : 'fail'}">
          <div class="summary-value">${report.passed ? '✓' : '✗'}</div>
          <div class="summary-label">${report.passed ? 'Passed' : 'Failed'}</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${summary.passedSteps}/${summary.totalSteps}</div>
          <div class="summary-label">Steps Passed</div>
        </div>
        <div class="summary-card ${summary.criticalViolations > 0 ? 'fail' : ''}">
          <div class="summary-value">${summary.criticalViolations}</div>
          <div class="summary-label">Critical Issues</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${summary.seriousViolations}</div>
          <div class="summary-label">Serious Issues</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${summary.totalViolations}</div>
          <div class="summary-label">Total Issues</div>
        </div>
      </div>
    </div>

    <div class="flow-timeline">
      ${renderTimeline(stepResults)}
    </div>

    ${stepResults.map((result, idx) => renderStepSection(result, idx + 1)).join('')}

    <div class="footer">
      <p>Generated by Shopping Accessibility Testing Agent</p>
      <p>Based on WCAG 2.1 AA guidelines</p>
    </div>
  </div>
</body>
</html>`;

  return html;
}

function renderTimeline(stepResults: StepResult[]): string {
  const allSteps: FlowStepName[] = ['search', 'results', 'product', 'cart', 'checkout'];

  return allSteps.map(stepName => {
    const result = stepResults.find(r => r.step === stepName);
    const status = result
      ? (result.passed ? 'passed' : 'failed')
      : 'skipped';

    const stepIcons: Record<FlowStepName, string> = {
      search: '🔍',
      results: '📋',
      product: '🛍️',
      cart: '🛒',
      checkout: '💳',
    };

    return `
      <div class="timeline-step ${status}">
        <div class="timeline-icon">${stepIcons[stepName]}</div>
        <div class="timeline-label">${getStepDescription(stepName)}</div>
      </div>
    `;
  }).join('');
}

function renderStepSection(result: StepResult, stepNumber: number): string {
  const statusClass = result.passed ? 'passed' : 'failed';
  const statusIcon = result.passed ? '✓' : '✗';

  return `
    <div class="step-section">
      <div class="step-header ${statusClass}">
        <div class="step-status ${statusClass}">${statusIcon}</div>
        <div class="step-title">Step ${stepNumber}: ${getStepDescription(result.step)}</div>
        <div class="step-duration">${(result.durationMs / 1000).toFixed(1)}s</div>
      </div>
      <div class="step-content">
        ${result.screenshot ? `<img class="step-screenshot" src="${result.screenshot}" alt="Screenshot of ${result.step} step">` : ''}

        ${result.failureReason ? `
          <div class="failure-reason">
            <strong>Failure reason:</strong> ${escapeHtml(result.failureReason)}
          </div>
        ` : ''}

        ${result.violations.length > 0 ? `
          <div class="violations-list">
            <h3>Accessibility Issues (${result.violations.length})</h3>
            ${result.violations.map(v => renderViolation(v)).join('')}
          </div>
        ` : `
          <div class="no-violations">
            ✓ No accessibility issues found in this step
          </div>
        `}

        <details>
          <summary>View agent trace (${result.agentTrace.steps.length} actions)</summary>
          <div class="agent-trace">
            ${result.agentTrace.steps.map((step, idx) => `
              <div class="trace-step">
                <span class="trace-action">${idx + 1}. ${step.action.type} ${(step.action as any).key || (step.action as any).text || ''}</span><br>
                <span class="trace-result">→ ${escapeHtml(step.observation?.text || 'No output')}</span>
              </div>
            `).join('')}
          </div>
        </details>
      </div>
    </div>
  `;
}

function renderViolation(violation: Violation): string {
  const severityColors: Record<string, string> = {
    critical: '#dc2626',
    serious: '#ea580c',
    moderate: '#ca8a04',
    minor: '#65a30d',
  };

  return `
    <div class="violation ${violation.severity}">
      <div class="violation-header">
        <span class="violation-severity" style="background: ${severityColors[violation.severity]}">${violation.severity}</span>
        <span class="violation-wcag">WCAG ${violation.wcag}</span>
      </div>
      <div class="violation-message">${escapeHtml(violation.message)}</div>
      ${violation.screenReaderOutput ? `
        <div class="violation-sr-output">
          <strong>Screen reader output:</strong> "${escapeHtml(violation.screenReaderOutput)}"
        </div>
      ` : ''}
      ${violation.remediation ? `
        <div class="violation-remediation">
          <strong>How to fix:</strong> ${escapeHtml(violation.remediation)}
        </div>
      ` : ''}
    </div>
  `;
}

function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, char => escapeMap[char]);
}
