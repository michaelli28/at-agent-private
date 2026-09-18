import { describe, it, expect } from 'vitest'
import { buildBridgeMap, detectGaps, getElementDescription, isLikelyInteractive } from './gap-detector.js'
import type { DOMElement, ElementNode, InteractivitySignals, PageElementGraph } from './types.js'

const PAGE = 'http://fixture.test/'

const noSignals: InteractivitySignals = {
  hasClickHandler: false,
  hasCursorPointer: false,
  isSemanticInteractive: false,
  hasTabindex: false,
  tabindexValue: null,
  hasRoleAttribute: false,
  roleValue: null,
  hasAriaExpanded: false,
  classNameHints: [],
}

const flags = {
  isLandmark: false,
  landmarkRole: null,
  isButton: false,
  isFormField: false,
  isTable: false,
  isLink: false,
  isList: false,
  headingLevel: null,
  isInteractive: false,
  isNavigational: false,
}

function el(backendNodeId: number, nodeName: string, attributes: Record<string, string> = {}): DOMElement {
  return {
    nodeId: backendNodeId + 1000,
    backendNodeId,
    nodeName,
    localName: nodeName.toLowerCase(),
    attributes,
    boundingBox: null,
    pageUrl: PAGE,
  }
}

function tree(axNodes: Array<{ backend: number; role: string; name: string }>): PageElementGraph {
  const elements = new Map<string, ElementNode>()
  axNodes.forEach((n, i) => {
    const id = `${PAGE}#node-${i}`
    elements.set(id, {
      id,
      pageUrl: PAGE,
      xpath: `node-${i}`,
      role: n.role,
      name: n.name,
      backendDOMNodeId: n.backend,
      typeFlags: flags,
      children: [],
      parent: null,
    })
  })
  return {
    pageUrl: PAGE,
    title: 'fixture',
    elements,
    rootElementIds: [],
    headings: [],
    landmarks: [],
    buttons: [],
    formFields: [],
    links: [],
    tables: [],
    lists: [],
    outboundLinks: [],
    crawledAt: new Date(0),
    elementCount: elements.size,
    interactiveCount: 0,
  }
}

function classifyOne(
  element: DOMElement,
  signals: InteractivitySignals,
  axNodes: Array<{ backend: number; role: string; name: string }>,
) {
  return detectGaps([element], tree(axNodes), new Map([[element.backendNodeId, signals]]))
}

describe('isLikelyInteractive (hand-set weights, threshold 2)', () => {
  it('scores a click handler alone as interactive', () => {
    expect(isLikelyInteractive({ ...noSignals, hasClickHandler: true })).toBe(true)
  })

  it('does not count a non-interactive role', () => {
    expect(
      isLikelyInteractive({
        ...noSignals,
        hasRoleAttribute: true,
        roleValue: 'presentation',
      }),
    ).toBe(false)
  })

  it('treats tabindex=-1 as zero and a class hint as half a point', () => {
    expect(
      isLikelyInteractive({
        ...noSignals,
        hasTabindex: true,
        tabindexValue: -1,
        classNameHints: ['btn'],
      }),
    ).toBe(false)
    expect(
      isLikelyInteractive({
        ...noSignals,
        hasTabindex: true,
        tabindexValue: 0,
        hasAriaExpanded: true,
      }),
    ).toBe(true)
    expect(
      isLikelyInteractive({
        ...noSignals,
        hasCursorPointer: true,
        classNameHints: ['btn', 'toggle'],
      }),
    ).toBe(false)
  })
})

describe('buildBridgeMap', () => {
  it('maps backendDOMNodeId to element id, later nodes overwriting earlier ones', () => {
    const map = buildBridgeMap(
      tree([
        { backend: 7, role: 'button', name: 'A' },
        { backend: 7, role: 'StaticText', name: 'A' },
      ]),
    )
    expect(map.get(7)).toBe(`${PAGE}#node-1`)
  })
})

describe('detectGaps classification', () => {
  it('skips elements without signals and elements below the threshold', () => {
    const div = el(1, 'DIV')
    expect(detectGaps([div], tree([]), new Map())).toEqual([])
    expect(classifyOne(div, { ...noSignals, classNameHints: ['btn'] }, [])).toEqual([])
  })

  it('flags missing_from_a11y_tree when the element has no AX bridge', () => {
    const [gap] = classifyOne(el(1, 'DIV', { class: 'btn' }), { ...noSignals, hasClickHandler: true }, [])
    expect(gap.gapType).toBe('missing_from_a11y_tree')
    expect(gap.severity).toBe('critical')
    expect(gap.wcagViolations).toEqual(['4.1.2'])
    expect(gap.evidence).toBe('DIV element with interactivity signals is not exposed in the accessibility tree')
  })

  it('flags no_accessible_name for a semantic control with an empty or blank name', () => {
    const [gap] = classifyOne(el(2, 'BUTTON'), { ...noSignals, isSemanticInteractive: true }, [
      { backend: 2, role: 'button', name: '  ' },
    ])
    expect(gap.gapType).toBe('no_accessible_name')
    expect(gap.severity).toBe('serious')
    expect(gap.wcagViolations).toEqual(['4.1.2', '1.1.1'])
    expect(gap.evidence).toBe('Interactive BUTTON element has no accessible name')
  })

  it('flags wrong_role for a named generic or group with a click handler', () => {
    const [generic] = classifyOne(el(3, 'DIV'), { ...noSignals, hasClickHandler: true }, [
      { backend: 3, role: 'generic', name: 'Close' },
    ])
    expect(generic.gapType).toBe('wrong_role')
    expect(generic.evidence).toBe('DIV element has click handlers but generic role "generic"')
    const [group] = classifyOne(
      el(4, 'DIV'),
      {
        ...noSignals,
        hasRoleAttribute: true,
        roleValue: 'button',
        hasTabindex: true,
        tabindexValue: 0,
      },
      [{ backend: 4, role: 'group', name: 'Filters' }],
    )
    expect(group.gapType).toBe('wrong_role')
  })

  it('flags not_focusable with the no-tabindex reason', () => {
    const [gap] = classifyOne(
      el(5, 'DIV', { role: 'button' }),
      {
        ...noSignals,
        hasClickHandler: true,
        hasRoleAttribute: true,
        roleValue: 'button',
      },
      [{ backend: 5, role: 'button', name: 'Buy' }],
    )
    expect(gap.gapType).toBe('not_focusable')
    expect(gap.severity).toBe('critical')
    expect(gap.wcagViolations).toEqual(['2.1.1', '2.4.7'])
    expect(gap.evidence).toBe(
      'DIV element has click handlers but has no tabindex and is not a native interactive element',
    )
  })

  it('flags not_focusable with the tabindex=-1 reason', () => {
    const [gap] = classifyOne(
      el(6, 'DIV'),
      {
        ...noSignals,
        hasClickHandler: true,
        hasTabindex: true,
        tabindexValue: -1,
      },
      [{ backend: 6, role: 'button', name: 'Compare' }],
    )
    expect(gap.evidence).toBe('DIV element has click handlers but tabindex="-1" makes it unfocusable')
  })

  it('does not flag not_focusable from a role alone (no handler, cursor never set)', () => {
    const gaps = classifyOne(el(7, 'DIV'), { ...noSignals, hasRoleAttribute: true, roleValue: 'button' }, [
      { backend: 7, role: 'button', name: 'Wishlist' },
    ])
    expect(gaps).toEqual([])
  })

  it('flags hidden_but_interactive for an exposed aria-hidden element with a handler', () => {
    const [gap] = classifyOne(
      el(8, 'BUTTON', { 'aria-hidden': 'true' }),
      { ...noSignals, hasClickHandler: true, isSemanticInteractive: true },
      [{ backend: 8, role: 'button', name: 'Dismiss' }],
    )
    expect(gap.gapType).toBe('hidden_but_interactive')
    expect(gap.severity).toBe('moderate')
    expect(gap.evidence).toBe('BUTTON element has aria-hidden="true" but also has click handlers')
  })

  it('returns no gap for an accessible control', () => {
    const gaps = classifyOne(el(9, 'BUTTON'), { ...noSignals, hasClickHandler: true, isSemanticInteractive: true }, [
      { backend: 9, role: 'button', name: 'Checkout' },
    ])
    expect(gaps).toEqual([])
  })
})

describe('getElementDescription', () => {
  it('describes tag, id, first three classes and label', () => {
    expect(getElementDescription(el(1, 'DIV', { id: 'x', class: 'a b c d', 'aria-label': 'Close' }))).toBe(
      '<div> with id="x" class="a b c" labeled "Close"',
    )
    expect(getElementDescription(el(2, 'SPAN', { title: 'Help' }))).toBe('<span> titled "Help"')
  })
})
