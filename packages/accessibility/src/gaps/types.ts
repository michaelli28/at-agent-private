import { z } from 'zod'
import { ImpactSchema } from '../types.js'

// Ported from taskgen/src/types.ts: only the shapes the dual-crawl gap path produces or reads.

export const ACCESSIBILITY_GAP_TYPES = [
  'missing_from_a11y_tree',
  'no_accessible_name',
  'wrong_role',
  'not_focusable',
  'hidden_but_interactive',
] as const
export const AccessibilityGapTypeSchema = z.enum(ACCESSIBILITY_GAP_TYPES)
export type AccessibilityGapType = z.infer<typeof AccessibilityGapTypeSchema>

export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
export type BoundingBox = z.infer<typeof BoundingBoxSchema>

// A DOM element found by CDP DOM.* queries; backendNodeId bridges it to the AX tree.
export const DOMElementSchema = z.object({
  nodeId: z.number(),
  backendNodeId: z.number(),
  nodeName: z.string(),
  localName: z.string(),
  attributes: z.record(z.string()),
  boundingBox: BoundingBoxSchema.nullable().optional(),
  pageUrl: z.string(),
})
export type DOMElement = z.infer<typeof DOMElementSchema>

export const InteractivitySignalsSchema = z.object({
  hasClickHandler: z.boolean(),
  hasCursorPointer: z.boolean(),
  isSemanticInteractive: z.boolean(),
  hasTabindex: z.boolean(),
  tabindexValue: z.number().nullable(),
  hasRoleAttribute: z.boolean(),
  roleValue: z.string().nullable(),
  hasAriaExpanded: z.boolean(),
  classNameHints: z.array(z.string()),
})
export type InteractivitySignals = z.infer<typeof InteractivitySignalsSchema>

export const AccessibilityGapSchema = z.object({
  domElement: DOMElementSchema,
  signals: InteractivitySignalsSchema,
  gapType: AccessibilityGapTypeSchema,
  severity: ImpactSchema,
  wcagViolations: z.array(z.string()),
  suggestedFix: z.string().optional(),
  evidence: z.string(),
})
export type AccessibilityGap = z.infer<typeof AccessibilityGapSchema>

export const ElementTypeFlagsSchema = z.object({
  isLandmark: z.boolean(),
  landmarkRole: z.string().nullable(),
  isButton: z.boolean(),
  isFormField: z.boolean(),
  isTable: z.boolean(),
  isLink: z.boolean(),
  isList: z.boolean(),
  headingLevel: z.number().nullable(),
  isInteractive: z.boolean(),
  isNavigational: z.boolean(),
})
export type ElementTypeFlags = z.infer<typeof ElementTypeFlagsSchema>

// taskgen's ElementNode minus its task-coverage fields (navigationEdges, visited*, violations),
// which the gap path never reads or writes.
export const ElementNodeSchema = z.object({
  id: z.string(),
  pageUrl: z.string(),
  xpath: z.string(),
  role: z.string(),
  name: z.string(),
  description: z.string().optional(),
  value: z.string().optional(),
  backendDOMNodeId: z.number().optional(),
  typeFlags: ElementTypeFlagsSchema,
  children: z.array(z.string()),
  parent: z.string().nullable(),
})
export type ElementNode = z.infer<typeof ElementNodeSchema>

export const OutboundLinkSchema = z.object({
  elementId: z.string(),
  targetUrl: z.string(),
  linkText: z.string(),
})
export type OutboundLink = z.infer<typeof OutboundLinkSchema>

export const PageElementGraphSchema = z.object({
  pageUrl: z.string(),
  title: z.string(),
  elements: z.map(z.string(), ElementNodeSchema),
  rootElementIds: z.array(z.string()),
  headings: z.array(z.string()),
  landmarks: z.array(z.string()),
  buttons: z.array(z.string()),
  formFields: z.array(z.string()),
  links: z.array(z.string()),
  tables: z.array(z.string()),
  lists: z.array(z.string()),
  outboundLinks: z.array(OutboundLinkSchema),
  crawledAt: z.date(),
  elementCount: z.number(),
  interactiveCount: z.number(),
})
export type PageElementGraph = z.infer<typeof PageElementGraphSchema>

export const DualCrawlResultSchema = z.object({
  pageUrl: z.string(),
  accessibilityTree: PageElementGraphSchema,
  domElements: z.array(DOMElementSchema),
  gaps: z.array(AccessibilityGapSchema),
  bridgeMap: z.map(z.number(), z.string()),
})
export type DualCrawlResult = z.infer<typeof DualCrawlResultSchema>
