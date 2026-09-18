import type { Page } from 'playwright'
import type { ElementNode, ElementTypeFlags, OutboundLink, PageElementGraph } from './types.js'

// Port of taskgen/src/element-crawler.ts: getAccessibilityTree, convertToElementGraph and the helpers they call.

interface AXValue {
  value?: unknown
}

interface AXProperty {
  name: string
  value: AXValue
}

// The subset of CDP Accessibility.AXNode the conversion reads.
export interface AXNode {
  nodeId: string
  ignored: boolean
  role?: AXValue
  name?: AXValue
  description?: AXValue
  value?: AXValue
  properties?: AXProperty[]
  childIds?: string[]
  backendDOMNodeId?: number
}

const LANDMARK_ROLES = ['banner', 'main', 'navigation', 'search', 'complementary', 'contentinfo', 'form', 'region']
const INTERACTIVE_ROLES = [
  'button',
  'link',
  'menuitem',
  'checkbox',
  'radio',
  'textbox',
  'combobox',
  'listbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
]
const FORM_FIELD_ROLES = ['textbox', 'checkbox', 'radio', 'combobox', 'listbox', 'slider', 'spinbutton', 'searchbox']

// CDP types AXValue.value as any; taskgen used it as a string. Strings pass through unchanged.
function axText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : String(value)
}

export async function getAccessibilityTree(page: Page): Promise<AXNode[]> {
  const client = await page.context().newCDPSession(page)
  try {
    const { nodes } = await client.send('Accessibility.getFullAXTree')
    return nodes
  } finally {
    await client.detach()
  }
}

export function convertToElementGraph(
  axNodes: readonly AXNode[],
  pageUrl: string,
  pageTitle: string,
): PageElementGraph {
  const elements = new Map<string, ElementNode>()
  const headings: string[] = []
  const landmarks: string[] = []
  const buttons: string[] = []
  const formFields: string[] = []
  const links: string[] = []
  const tables: string[] = []
  const lists: string[] = []
  const outboundLinks: OutboundLink[] = []
  const rootElementIds: string[] = []

  const nodeIdToElement = new Map<string, ElementNode>()
  const childToParent = new Map<string, string>()

  for (const axNode of axNodes) {
    // BASELINE-BUG(F2): ignored nodes are skipped, so aria-hidden/hidden clickables can never be bridged.
    if (axNode.ignored) continue

    const role = axText(axNode.role?.value) || 'generic'
    const name = axText(axNode.name?.value) || ''

    // BASELINE-BUG(F2): unnamed generic nodes are dropped, so an unnamed clickable div falls to missing_from_a11y_tree, never wrong_role.
    if (role === 'generic' && !name) continue

    const xpath = generateXPathFromNodeId(axNode.nodeId)
    const elementId = `${pageUrl}#${xpath}`
    const typeFlags = computeTypeFlags(role, axNode.properties)

    const element: ElementNode = {
      id: elementId,
      pageUrl,
      xpath,
      role,
      name,
      description: axText(axNode.description?.value),
      value: axText(axNode.value?.value),
      backendDOMNodeId: axNode.backendDOMNodeId,
      typeFlags,
      children: [],
      parent: null,
    }

    elements.set(elementId, element)
    nodeIdToElement.set(axNode.nodeId, element)

    if (axNode.childIds) {
      for (const childId of axNode.childIds) {
        childToParent.set(childId, axNode.nodeId)
      }
    }

    if (typeFlags.headingLevel) headings.push(elementId)
    if (typeFlags.isLandmark) landmarks.push(elementId)
    if (typeFlags.isButton) buttons.push(elementId)
    if (typeFlags.isFormField) formFields.push(elementId)
    if (typeFlags.isLink) links.push(elementId)
    if (typeFlags.isTable) tables.push(elementId)
    if (typeFlags.isList) lists.push(elementId)

    if (typeFlags.isLink && name) {
      const href = extractProperty(axNode.properties, 'url')
      if (href && isValidUrl(href)) {
        outboundLinks.push({
          elementId,
          targetUrl: normalizeUrl(href, pageUrl),
          linkText: name,
        })
      }
    }
  }

  for (const axNode of axNodes) {
    const element = nodeIdToElement.get(axNode.nodeId)
    if (!element) continue

    const parentNodeId = childToParent.get(axNode.nodeId)
    if (parentNodeId) {
      const parentElement = nodeIdToElement.get(parentNodeId)
      if (parentElement) {
        element.parent = parentElement.id
        parentElement.children.push(element.id)
      }
    } else {
      rootElementIds.push(element.id)
    }
  }

  let interactiveCount = 0
  for (const element of elements.values()) {
    if (element.typeFlags.isInteractive) interactiveCount++
  }

  return {
    pageUrl,
    title: pageTitle,
    elements,
    rootElementIds,
    headings,
    landmarks,
    buttons,
    formFields,
    links,
    tables,
    lists,
    outboundLinks,
    crawledAt: new Date(),
    elementCount: elements.size,
    interactiveCount,
  }
}

function computeTypeFlags(role: string, properties?: readonly AXProperty[]): ElementTypeFlags {
  let headingLevel: number | null = null
  if (role === 'heading') {
    const levelProp = properties?.find((p) => p.name === 'level')
    headingLevel = levelProp ? Number(levelProp.value.value) : 1
  }

  const isLandmark = LANDMARK_ROLES.includes(role)
  const isLink = role === 'link'

  return {
    isLandmark,
    landmarkRole: isLandmark ? role : null,
    isButton: role === 'button',
    isFormField: FORM_FIELD_ROLES.includes(role),
    isTable: role === 'table' || role === 'grid',
    isLink,
    isList: role === 'list',
    headingLevel,
    isInteractive: INTERACTIVE_ROLES.includes(role),
    isNavigational: isLink,
  }
}

function generateXPathFromNodeId(nodeId: string): string {
  return `node-${nodeId}`
}

function extractProperty(properties: readonly AXProperty[] | undefined, name: string): string | undefined {
  return axText(properties?.find((p) => p.name === name)?.value.value)
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

function normalizeUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href
  } catch {
    return url
  }
}
