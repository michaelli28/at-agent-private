export interface Violation {
  ruleId: string;
  description: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  axNodeId?: string;
  evidence?: string;
}
