import { describe, it, expect } from 'vitest'
import { buildBridgeMap, detectGaps, getElementDescription, isLikelyInteractive } from './gap-detector.js'
import type { DOMElement, ElementNode, InteractivitySignals, KeyboardEvidence, PageElementGraph } from './types.js'

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

type AxFixture = {
  backend: number
  role: string
  name: string
  ignoredReasons?: string[]
}

function tree(axNodes: AxFixture[]): PageElementGraph {
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
      ignored: n.ignoredReasons !== undefined,
      ignoredReasons: n.ignoredReasons ?? [],
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

function classifyOne(element: DOMElement, signals: InteractivitySignals, axNodes: AxFixture[]) {
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

const walked = (reached: number[]): KeyboardEvidence => ({
  walkRan: true,
  notFocusableAssessed: true,
  unassessedReasons: [],
  walkError: null,
  reachedBackendNodeIds: reached,
})
const trapped = (reached: number[]): KeyboardEvidence => ({
  ...walked(reached),
  notFocusableAssessed: false,
  unassessedReasons: ['no-wrap'],
})

function classifyWith(
  element: DOMElement,
  signals: InteractivitySignals,
  axNodes: AxFixture[],
  keyboard: KeyboardEvidence,
) {
  return detectGaps([element], tree(axNodes), new Map([[element.backendNodeId, signals]]), { keyboard })
}

describe('F3: not_focusable comes only from a complete Tab walk', () => {
  const roleButton = { ...noSignals, hasClickHandler: true, hasRoleAttribute: true, roleValue: 'button' }
  const buy = [{ backend: 5, role: 'button', name: 'Buy' }]

  it('never emits not_focusable without a walk', () => {
    expect(classifyOne(el(5, 'DIV', { role: 'button' }), roleButton, buy)).toEqual([])
  })

  it('emits not_focusable when a complete walk never focused the element', () => {
    const [gap] = classifyWith(el(5, 'DIV', { role: 'button' }), roleButton, buy, walked([1, 2]))
    expect(gap).toMatchObject({
      gapType: 'not_focusable',
      severity: 'critical',
      wcagViolations: ['2.1.1', '2.4.7'],
      evidence: 'DIV element has click handlers but a complete Tab walk never focused it',
    })
    const [pointer] = classifyWith(
      el(5, 'DIV', { role: 'button' }),
      { ...noSignals, hasCursorPointer: true, hasRoleAttribute: true, roleValue: 'button' },
      buy,
      walked([]),
    )
    expect(pointer?.evidence).toBe('DIV element has cursor:pointer but a complete Tab walk never focused it')
  })

  it('trusts the walk over the tabindex attribute', () => {
    const neg = { ...roleButton, hasTabindex: true, tabindexValue: -1 }
    expect(classifyWith(el(5, 'DIV', { role: 'button', tabindex: '-1' }), neg, buy, walked([5]))).toEqual([])
    const junk = { ...roleButton, hasTabindex: true, tabindexValue: 0 }
    const [gap] = classifyWith(el(5, 'DIV', { role: 'button', tabindex: 'abc' }), junk, buy, walked([]))
    expect(gap?.gapType).toBe('not_focusable')
  })

  it('does not emit not_focusable from an incomplete walk', () => {
    expect(classifyWith(el(5, 'DIV', { role: 'button' }), roleButton, buy, trapped([]))).toEqual([])
  })
})

describe('F3: once a walk ran, hidden_but_interactive needs the walk to have focused the element', () => {
  const link = { ...noSignals, isSemanticInteractive: true }
  const hidden = [{ backend: 40, role: 'none', name: '', ignoredReasons: ['ariaHiddenSubtree'] }]
  const a = el(40, 'A', { href: '#a' })

  it('flags an aria-hidden control the walk focused, even when the walk was incomplete', () => {
    expect(classifyWith(a, link, hidden, walked([40]))[0]?.gapType).toBe('hidden_but_interactive')
    expect(classifyWith(a, link, hidden, trapped([40]))[0]?.gapType).toBe('hidden_but_interactive')
  })

  it('does not flag an aria-hidden control the walk never focused (hidden from both, e.g. behind a modal)', () => {
    expect(classifyWith(a, link, hidden, walked([]))).toEqual([])
    expect(classifyWith(a, link, hidden, trapped([]))).toEqual([])
  })
})

describe('F2: generic roles and aria-hidden', () => {
  const clickable = { ...noSignals, hasClickHandler: true }

  it('flags an unnamed clickable generic, group or none as wrong_role, before the empty-name check', () => {
    for (const role of ['generic', 'group', 'none']) {
      const [gap] = classifyOne(el(30, 'DIV'), clickable, [{ backend: 30, role, name: '' }])
      expect(gap?.gapType, role).toBe('wrong_role')
      expect(gap?.evidence).toBe(`DIV element has click handlers but generic role "${role}"`)
    }
  })

  it('flags an interactive element hidden by its own aria-hidden or an aria-hidden ancestor', () => {
    const link = { ...noSignals, isSemanticInteractive: true }
    const [own] = classifyOne(el(31, 'A', { href: '#a', 'aria-hidden': 'true' }), link, [
      { backend: 31, role: 'none', name: '', ignoredReasons: ['ariaHiddenElement'] },
    ])
    expect(own).toMatchObject({
      gapType: 'hidden_but_interactive',
      severity: 'moderate',
      evidence: 'A element has aria-hidden="true" but is interactive',
    })
    const [inside] = classifyOne(el(32, 'BUTTON'), clickable, [
      { backend: 32, role: 'none', name: '', ignoredReasons: ['ariaHiddenSubtree'] },
    ])
    expect(inside).toMatchObject({
      gapType: 'hidden_but_interactive',
      evidence: 'BUTTON element is inside an aria-hidden="true" subtree but is interactive',
    })
  })

  it('flags a node ignored for any other reason as missing from the tree', () => {
    const [gap] = classifyOne(el(33, 'DIV'), clickable, [
      { backend: 33, role: 'none', name: '', ignoredReasons: ['inertElement'] },
    ])
    expect(gap?.gapType).toBe('missing_from_a11y_tree')
    expect(gap?.evidence).toBe('DIV element with interactivity signals is not exposed in the accessibility tree')
  })
})

describe('F1: candidates the AX tree marks as not rendered or not visible', () => {
  it('drops them instead of classifying them', () => {
    for (const reason of ['notRendered', 'notVisible']) {
      const gaps = classifyOne(
        el(20, 'A', { href: '#x' }),
        { ...noSignals, isSemanticInteractive: true, hasClickHandler: true },
        [{ backend: 20, role: 'none', name: '', ignoredReasons: [reason] }],
      )
      expect(gaps, reason).toEqual([])
    }
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
