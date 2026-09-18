import type { CDPSession, Page } from 'playwright'
import type { DOMElement, InteractivitySignals } from './types.js'

// Port of taskgen/src/dom-crawler.ts (DOMCrawler) as functions; CDP call order is unchanged.

const SEMANTIC_INTERACTIVE_SELECTORS = [
  'button',
  'a[href]',
  // BASELINE-BUG(F1): 'input' also matches type=hidden and unrendered inputs, which are then flagged.
  'input',
  'select',
  'textarea',
  'details',
  'summary',
  '[contenteditable="true"]',
  'audio[controls]',
  'video[controls]',
]

const PSEUDO_INTERACTIVE_SELECTORS = [
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="tablist"]',
  '[role="tree"]',
  '[role="treeitem"]',
  '[role="grid"]',
  '[role="gridcell"]',
  '[tabindex]',
  '[onclick]',
  '[onkeydown]',
  '[onkeyup]',
  '[onmousedown]',
  '[onmouseup]',
  '[ng-click]',
  // Invalid CSS: querySelectorAll throws and the selector is skipped, as in taskgen.
  '[@click]',
  '[v-on\\:click]',
  '[(click)]',
]

const INTERACTIVE_CLASS_PATTERNS = [
  'btn',
  'button',
  'clickable',
  'interactive',
  'action',
  'trigger',
  'toggle',
  'dropdown',
  'link',
  'nav-link',
  'menu-item',
  'tab',
]

const SEMANTIC_TAGS = ['button', 'a', 'input', 'select', 'textarea', 'details', 'summary']
const LISTENER_TYPES = ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'touchstart', 'touchend']

export async function crawlDOM(page: Page, pageUrl: string): Promise<DOMElement[]> {
  const cdp = await page.context().newCDPSession(page)

  try {
    await cdp.send('DOM.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 })

    const domElements: DOMElement[] = []

    // BASELINE-BUG(F9): discovery is selector/class-substring only; a plain div with an addEventListener or React handler is never visited.
    for (const selector of [...SEMANTIC_INTERACTIVE_SELECTORS, ...PSEUDO_INTERACTIVE_SELECTORS]) {
      try {
        const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
          nodeId: root.nodeId,
          selector,
        })
        for (const nodeId of nodeIds) {
          const element = await getElementDetails(cdp, nodeId, pageUrl)
          if (element && !domElements.some((e) => e.backendNodeId === element.backendNodeId)) {
            domElements.push(element)
          }
        }
      } catch {
        continue
      }
    }

    const classBasedElements = await findElementsWithInteractiveClasses(cdp, root.nodeId, pageUrl)
    for (const element of classBasedElements) {
      if (!domElements.some((e) => e.backendNodeId === element.backendNodeId)) {
        domElements.push(element)
      }
    }

    return domElements
  } finally {
    await cdp.detach()
  }
}

async function getElementDetails(cdp: CDPSession, nodeId: number, pageUrl: string): Promise<DOMElement | null> {
  try {
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 0 })
    if (!node || node.nodeType !== 1) return null

    const attributes: Record<string, string> = {}
    if (node.attributes) {
      for (let i = 0; i < node.attributes.length; i += 2) {
        attributes[node.attributes[i]] = node.attributes[i + 1]
      }
    }

    let boundingBox: DOMElement['boundingBox'] = null
    try {
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId })
      if (model && model.content) {
        const [x1, y1, x2, , , y3] = model.content
        boundingBox = { x: x1, y: y1, width: x2 - x1, height: y3 - y1 }
      }
    } catch {
      // BASELINE-BUG(F1): unrendered nodes throw here and keep a null box, so isElementVisible's size check is skipped.
    }

    return {
      nodeId,
      backendNodeId: node.backendNodeId,
      nodeName: node.nodeName,
      localName: node.localName,
      attributes,
      boundingBox,
      pageUrl,
    }
  } catch {
    return null
  }
}

async function findElementsWithInteractiveClasses(
  cdp: CDPSession,
  rootNodeId: number,
  pageUrl: string,
): Promise<DOMElement[]> {
  const elements: DOMElement[] = []

  for (const pattern of INTERACTIVE_CLASS_PATTERNS) {
    try {
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
        nodeId: rootNodeId,
        selector: `[class*="${pattern}"]`,
      })
      for (const nodeId of nodeIds) {
        const element = await getElementDetails(cdp, nodeId, pageUrl)
        if (element) elements.push(element)
      }
    } catch {
      continue
    }
  }

  return elements
}

export async function getInteractivitySignals(page: Page, element: DOMElement): Promise<InteractivitySignals> {
  const cdp = await page.context().newCDPSession(page)

  try {
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')

    const attrs = element.attributes
    const hasClickAttribute = !!(
      attrs['onclick'] ||
      attrs['onkeydown'] ||
      attrs['onmousedown'] ||
      attrs['ng-click'] ||
      attrs['v-on:click']
    )

    const hasTabindex = attrs['tabindex'] !== undefined
    // BASELINE-BUG(F3): focusability is read from the attribute ('abc' parses to 0), never from the browser.
    const tabindexValue = hasTabindex ? parseInt(attrs['tabindex'], 10) || 0 : null

    const className = attrs['class'] || ''
    const classNameHints = INTERACTIVE_CLASS_PATTERNS.filter((pattern) => className.toLowerCase().includes(pattern))

    let hasCursorPointer = false
    try {
      const { nodeIds } = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', {
        backendNodeIds: [element.backendNodeId],
      })
      if (nodeIds && nodeIds[0]) {
        const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId: nodeIds[0] })
        const cursorProp = computedStyle.find((p) => p.name === 'cursor')
        if (cursorProp && cursorProp.value === 'pointer') hasCursorPointer = true
      }
    } catch {
      // BASELINE-BUG(F9): this fresh session never called DOM.getDocument, so the push throws and cursor:pointer is always false.
    }

    let hasListener = false
    try {
      const { object } = await cdp.send('DOM.resolveNode', {
        backendNodeId: element.backendNodeId,
      })
      if (object?.objectId) {
        const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
          objectId: object.objectId,
        })
        hasListener = listeners.some((l) => LISTENER_TYPES.includes(l.type))
      }
    } catch {
      // Event listener API may not be available.
    }

    return {
      hasClickHandler: hasClickAttribute || hasListener,
      hasCursorPointer,
      isSemanticInteractive: SEMANTIC_TAGS.includes(element.localName.toLowerCase()),
      hasTabindex,
      tabindexValue,
      hasRoleAttribute: !!attrs['role'],
      roleValue: attrs['role'] ? attrs['role'] : null,
      hasAriaExpanded: attrs['aria-expanded'] !== undefined,
      classNameHints,
    }
  } finally {
    await cdp.detach()
  }
}

// BASELINE-BUG(F1): never called on the gap path, and its fresh session also throws on the push, so it answers true for every element.
export async function isElementVisible(page: Page, element: DOMElement): Promise<boolean> {
  const cdp = await page.context().newCDPSession(page)

  try {
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')

    const { nodeIds } = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', {
      backendNodeIds: [element.backendNodeId],
    })
    if (!nodeIds || !nodeIds[0]) return false

    const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', {
      nodeId: nodeIds[0],
    })
    const display = computedStyle.find((p) => p.name === 'display')
    const visibility = computedStyle.find((p) => p.name === 'visibility')
    const opacity = computedStyle.find((p) => p.name === 'opacity')

    if (display?.value === 'none') return false
    if (visibility?.value === 'hidden') return false
    if (opacity?.value === '0') return false

    if (element.boundingBox) {
      if (element.boundingBox.width === 0 || element.boundingBox.height === 0) return false
    }

    return true
  } catch {
    return true
  } finally {
    await cdp.detach()
  }
}
