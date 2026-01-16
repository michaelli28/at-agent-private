export interface Violation {
  ruleId: string;
  description: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  axNodeId?: string;
  evidence?: string;
}

// TODO: Update to use @at-agent/agent types once evaluation is refactored
// Legacy type for screen-reader-based agent trace
export interface AgentTrace {
  goal: string;
  success: boolean;
  steps: AgentStep[];
  error?: string;
  reason?: string;
}

export interface AgentStep {
  stepNumber: number;
  action: { type: string; key?: string };
  observation: { text: string };
  result: { success: boolean };
  thought?: string;
}
