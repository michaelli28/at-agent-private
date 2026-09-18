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

// Scripted Tab walk (no LLM): per-press focus record for trap, focus-order and focus-indicator checks
export {
  runTabWalk,
  TabKeySchema,
  type TabKey,
  TabWalkOptionsSchema,
  type TabWalkOptions,
  FocusReadSchema,
  type FocusRead,
  FocusStyleSchema,
  type FocusStyle,
  TabWalkStepSchema,
  type TabWalkStep,
  EscapeProbeStepSchema,
  type EscapeProbeStep,
  EscapeProbeSchema,
  type EscapeProbe,
  TabWalkErrorSchema,
  type TabWalkError,
  TabWalkResultSchema,
  type TabWalkResult,
} from './tab-walk.js'

// Dual-crawl gap detection: baseline port of taskgen's DOM-vs-accessibility-tree detector
export { crawlPageWithGapDetection } from './gaps/detect.js'
export { crawlDOM, getInteractivitySignals, isElementVisible } from './gaps/dom-crawler.js'
export { getAccessibilityTree, convertToElementGraph, type AXNode } from './gaps/ax-tree.js'
export { buildBridgeMap, detectGaps, isLikelyInteractive, getElementDescription } from './gaps/gap-detector.js'
export { summarizeGaps, type GapSummary } from './gaps/summary.js'
export {
  ACCESSIBILITY_GAP_TYPES,
  AccessibilityGapTypeSchema,
  type AccessibilityGapType,
  BoundingBoxSchema,
  type BoundingBox,
  DOMElementSchema,
  type DOMElement,
  InteractivitySignalsSchema,
  type InteractivitySignals,
  AccessibilityGapSchema,
  type AccessibilityGap,
  ElementTypeFlagsSchema,
  type ElementTypeFlags,
  ElementNodeSchema,
  type ElementNode,
  OutboundLinkSchema,
  type OutboundLink,
  PageElementGraphSchema,
  type PageElementGraph,
  DualCrawlResultSchema,
  type DualCrawlResult,
} from './gaps/types.js'
