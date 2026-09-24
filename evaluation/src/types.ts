export interface Violation {
  ruleId: string;
  description: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  axNodeId?: string;
  evidence?: string;
}

export interface PageMetadata {
  title: string;
  lang: string;
  duplicateIds: string[];
}

export interface Section2CheckResult {
  guideline: string;          // e.g. "2.4 Navigable"
  successCriterion: string;   // e.g. "2.4.5 Multiple Ways"
  level: "A" | "AA" | "AAA";
  status: "pass" | "fail" | "cannot_determine";
  evidence: {
    reason: string;
    domNodes?: string[];     // CSS selectors / accessibility paths
    traceEvents?: string[];  // IDs / descriptions of relevant interaction events
  };
}

export interface Section2Evaluation {
  url: string;
  results: Section2CheckResult[];
}
