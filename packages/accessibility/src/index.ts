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
export { ScreenReaderNavigator } from './screen-reader-navigator.js'
export { KeyboardTrapDetector } from './keyboard-trap-detector.js'
export { DynamicEvaluator } from './dynamic-evaluator.js'

// Keyboard trap detection types
export {
  FocusEventSchema,
  type FocusEvent,
  FocusHistorySchema,
  type FocusHistory,
  TrapDetectionResultSchema,
  type TrapDetectionResult,
  TrapDetectionConfigSchema,
  type TrapDetectionConfig,
} from './types.js'

// Dynamic WCAG evaluation types
export {
  InteractionEventSchema,
  type InteractionEvent,
  InteractionTraceSchema,
  type InteractionTrace,
  DynamicViolationSchema,
  type DynamicViolation,
  DynamicEvaluationResultSchema,
  type DynamicEvaluationResult,
  DynamicEvaluatorConfigSchema,
  type DynamicEvaluatorConfig,
} from './types.js'
