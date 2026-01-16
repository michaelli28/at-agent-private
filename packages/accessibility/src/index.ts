// @at-agent/accessibility - Accessibility scanning and WCAG validation
export {
  ImpactSchema,
  type Impact,
  ViolationNodeSchema,
  type ViolationNode,
  ViolationSchema,
  type Violation,
  PassedRuleSchema,
  type PassedRule,
  AuditResultSchema,
  type AuditResult,
  AuditOptionsSchema,
  type AuditOptions,
  type NavigationMode,
  type NavigableNode,
  type NavigatorState,
  type NavigationResult,
} from './types.js'

export { runAxe, type AxeResult } from './axe.js'
export { Auditor, type AuditSummary } from './auditor.js'
export { ScreenReaderSimulator, type ReadableItem, type Heading, type Landmark } from './screen-reader.js'
