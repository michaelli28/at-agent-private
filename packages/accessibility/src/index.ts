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
  focusIdentity,
  FocusContainerSchema,
  type FocusContainer,
  DeepFocusSchema,
  type DeepFocus,
  DeepUnavailableSchema,
  type DeepUnavailable,
  LaunchFactsSchema,
  type LaunchFacts,
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

// F7 focus-indicator check (WCAG 2.4.7) over a Tab walk: absent only with whole-viewport pixel confirmation
export {
  FocusIndicatorOptionsSchema,
  type FocusIndicatorOptions,
  IndicatorVerdictSchema,
  type IndicatorVerdict,
  IndicatorUndeterminedReasonSchema,
  type IndicatorUndeterminedReason,
  IndicatorEvidenceSchema,
  type IndicatorEvidence,
  IndicatorDifferenceSchema,
  type IndicatorDifference,
  ViewSchema,
  type View,
  ScreenshotEvidenceSchema,
  type ScreenshotEvidence,
  ElementIndicatorSchema,
  type ElementIndicator,
  IndicatorCountsSchema,
  type IndicatorCounts,
  IndicatorComponentSchema,
  type IndicatorComponent,
  FocusIndicatorResultSchema,
  type FocusIndicatorResult,
  checkFocusIndicator,
  judgeFocusIndicator,
} from './focus-indicator.js'

// Dual-crawl gap detection: baseline port of taskgen's DOM-vs-accessibility-tree detector
export { crawlPageWithGapDetection, GapDetectionOptionsSchema, type GapDetectionOptions } from './gaps/detect.js'
export {
  crawlDOM,
  getInteractivitySignals,
  isElementVisible,
  findHiddenCandidates,
  collectInteractivitySignals,
  type DOMCrawl,
  type SignalsRead,
  type SignalsCollection,
  type HiddenCandidates,
} from './gaps/dom-crawler.js'
export { getAccessibilityTree, convertToElementGraph, type AXNode } from './gaps/ax-tree.js'
export {
  buildBridgeMap,
  detectGaps,
  isLikelyInteractive,
  getElementDescription,
  type DetectGapsOptions,
} from './gaps/gap-detector.js'
export { NO_WALK, walkFailed, keyboardEvidence, groupReach } from './gaps/keyboard.js'
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
  HIDDEN_REASONS,
  HiddenReasonSchema,
  type HiddenReason,
  HiddenCandidateSchema,
  type HiddenCandidate,
  CRAWL_STAGES,
  CrawlStageSchema,
  type CrawlStage,
  CrawlErrorSchema,
  type CrawlError,
  KEYBOARD_UNASSESSED_REASONS,
  KeyboardUnassessedReasonSchema,
  type KeyboardUnassessedReason,
  KeyboardEvidenceSchema,
  type KeyboardEvidence,
  FocusFactsSchema,
  type FocusFacts,
  GROUP_REACH_RULES,
  GroupReachRuleSchema,
  type GroupReachRule,
  GroupReachSchema,
  type GroupReach,
} from './gaps/types.js'
