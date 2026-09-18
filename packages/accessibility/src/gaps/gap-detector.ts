import type { Impact } from '../types.js'
import type {
  AccessibilityGap,
  AccessibilityGapType,
  DOMElement,
  InteractivitySignals,
  PageElementGraph,
} from './types.js'

// Port of taskgen/src/gap-detector.ts (GapDetector) as functions.

const GAP_WCAG_MAPPING: Record<AccessibilityGapType, string[]> = {
  missing_from_a11y_tree: ['4.1.2'],
  no_accessible_name: ['4.1.2', '1.1.1'],
  wrong_role: ['4.1.2'],
  not_focusable: ['2.1.1', '2.4.7'],
  hidden_but_interactive: ['4.1.2'],
}

const GAP_SEVERITY_MAPPING: Record<AccessibilityGapType, Impact> = {
  missing_from_a11y_tree: 'critical',
  not_focusable: 'critical',
  no_accessible_name: 'serious',
  wrong_role: 'serious',
  hidden_but_interactive: 'moderate',
}

const GAP_FIX_SUGGESTIONS: Record<AccessibilityGapType, string> = {
  missing_from_a11y_tree:
    'Add appropriate ARIA role and ensure element is not hidden from assistive technology. Consider using semantic HTML (e.g., <button> instead of <div>).',
  no_accessible_name: 'Add an accessible name via aria-label, aria-labelledby, or visible text content.',
  wrong_role: "Change the role to match the element's function, or use semantic HTML elements.",
  not_focusable:
    'Add tabindex="0" to make the element keyboard focusable, and ensure it can be activated with Enter/Space.',
  hidden_but_interactive: 'Remove aria-hidden="true" or ensure the element is not interactive if it should be hidden.',
}

const INTERACTIVE_ROLES = [
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'combobox',
  'listbox',
  'textbox',
  'searchbox',
  'treeitem',
  'gridcell',
]

// backendNodeId -> ElementNode.id; a later AX node sharing a backend id overwrites the earlier one.
export function buildBridgeMap(accessibilityTree: PageElementGraph): Map<number, string> {
  const bridgeMap = new Map<number, string>()
  for (const [elementId, element] of accessibilityTree.elements) {
    if (element.backendDOMNodeId !== undefined) {
      bridgeMap.set(element.backendDOMNodeId, elementId)
    }
  }
  return bridgeMap
}

export function detectGaps(
  domElements: readonly DOMElement[],
  accessibilityTree: PageElementGraph,
  signals: ReadonlyMap<number, InteractivitySignals>,
): AccessibilityGap[] {
  const gaps: AccessibilityGap[] = []
  const bridgeMap = buildBridgeMap(accessibilityTree)

  for (const domElement of domElements) {
    const elementSignals = signals.get(domElement.backendNodeId)
    if (!elementSignals) continue
    if (!isLikelyInteractive(elementSignals)) continue

    const gap = classifyGap(domElement, elementSignals, accessibilityTree, bridgeMap)
    if (gap) gaps.push(gap)
  }

  return gaps
}

// BASELINE-BUG(F9): hand-set weights and threshold 2, never calibrated; cursor:pointer (1 point) is never observed.
export function isLikelyInteractive(signals: InteractivitySignals): boolean {
  let score = 0

  if (signals.hasClickHandler) score += 2
  if (signals.isSemanticInteractive) score += 2
  if (signals.hasRoleAttribute && isInteractiveRole(signals.roleValue)) score += 2

  if (signals.hasCursorPointer) score += 1
  if (signals.hasTabindex && signals.tabindexValue !== -1) score += 1
  if (signals.hasAriaExpanded) score += 1

  if (signals.classNameHints.length > 0) score += 0.5

  return score >= 2
}

function isInteractiveRole(role: string | null): boolean {
  if (!role) return false
  return INTERACTIVE_ROLES.includes(role.toLowerCase())
}

function classifyGap(
  domElement: DOMElement,
  signals: InteractivitySignals,
  accessibilityTree: PageElementGraph,
  bridgeMap: Map<number, string>,
): AccessibilityGap | null {
  const axElementId = bridgeMap.get(domElement.backendNodeId)

  if (!axElementId) {
    return createGap(
      domElement,
      signals,
      'missing_from_a11y_tree',
      `${domElement.nodeName} element with interactivity signals is not exposed in the accessibility tree`,
    )
  }

  const axElement = accessibilityTree.elements.get(axElementId)
  if (!axElement) return null

  if (!axElement.name || axElement.name.trim() === '') {
    if (signals.hasClickHandler || signals.isSemanticInteractive) {
      return createGap(
        domElement,
        signals,
        'no_accessible_name',
        `Interactive ${domElement.nodeName} element has no accessible name`,
      )
    }
  }

  // BASELINE-BUG(F2): only named generic/group nodes survive the AX conversion, so unnamed clickable divs never reach this branch.
  if (axElement.role === 'generic' || axElement.role === 'group') {
    if (signals.hasClickHandler || isInteractiveRole(signals.roleValue)) {
      return createGap(
        domElement,
        signals,
        'wrong_role',
        `${domElement.nodeName} element has click handlers but generic role "${axElement.role}"`,
      )
    }
  }

  // BASELINE-BUG(F3): keyboard access is inferred from tag name and tabindex attribute, never from a real Tab walk.
  const isKeyboardAccessible =
    signals.isSemanticInteractive ||
    (signals.hasTabindex && signals.tabindexValue !== null && signals.tabindexValue >= 0)

  if (!isKeyboardAccessible && (signals.hasClickHandler || signals.hasCursorPointer)) {
    const reason =
      signals.tabindexValue === -1
        ? 'tabindex="-1" makes it unfocusable'
        : 'has no tabindex and is not a native interactive element'
    return createGap(
      domElement,
      signals,
      'not_focusable',
      `${domElement.nodeName} element has ${signals.hasClickHandler ? 'click handlers' : 'cursor:pointer'} but ${reason}`,
    )
  }

  // BASELINE-BUG(F2): aria-hidden nodes are normally ignored and never bridged, so this fires only when Chromium still exposes one (e.g. focused).
  if (domElement.attributes['aria-hidden'] === 'true' && signals.hasClickHandler) {
    return createGap(
      domElement,
      signals,
      'hidden_but_interactive',
      `${domElement.nodeName} element has aria-hidden="true" but also has click handlers`,
    )
  }

  return null
}

function createGap(
  domElement: DOMElement,
  signals: InteractivitySignals,
  gapType: AccessibilityGapType,
  evidence: string,
): AccessibilityGap {
  return {
    domElement,
    signals,
    gapType,
    severity: GAP_SEVERITY_MAPPING[gapType],
    wcagViolations: GAP_WCAG_MAPPING[gapType],
    suggestedFix: GAP_FIX_SUGGESTIONS[gapType],
    evidence,
  }
}

export function getElementDescription(domElement: DOMElement): string {
  const parts: string[] = [`<${domElement.localName}>`]

  if (domElement.attributes['id']) {
    parts.push(`with id="${domElement.attributes['id']}"`)
  }

  if (domElement.attributes['class']) {
    const classes = domElement.attributes['class'].split(' ').slice(0, 3).join(' ')
    parts.push(`class="${classes}"`)
  }

  if (domElement.attributes['aria-label']) {
    parts.push(`labeled "${domElement.attributes['aria-label']}"`)
  } else if (domElement.attributes['title']) {
    parts.push(`titled "${domElement.attributes['title']}"`)
  }

  return parts.join(' ')
}
