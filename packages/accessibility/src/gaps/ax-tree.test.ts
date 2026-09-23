import { describe, it, expect } from 'vitest'
import { convertToElementGraph, type AXNode } from './ax-tree.js'

const URL_ = 'http://fixture.test/page.html'

const nodes: AXNode[] = [
  {
    nodeId: '1',
    ignored: false,
    role: { value: 'RootWebArea' },
    name: { value: 'Page' },
    childIds: ['2', '3', '4', '5', '6', '7', '8'],
    backendDOMNodeId: 100,
  },
  {
    nodeId: '2',
    ignored: false,
    role: { value: 'heading' },
    name: { value: 'Title' },
    properties: [{ name: 'level', value: { value: 2 } }],
    backendDOMNodeId: 101,
  },
  {
    nodeId: '3',
    ignored: false,
    role: { value: 'generic' },
    name: { value: '' },
    backendDOMNodeId: 102,
  },
  {
    nodeId: '4',
    ignored: false,
    role: { value: 'generic' },
    name: { value: 'Close banner' },
    backendDOMNodeId: 103,
  },
  {
    nodeId: '5',
    ignored: true,
    ignoredReasons: [{ name: 'ariaHiddenElement', value: { value: true } }],
    role: { value: 'button' },
    name: { value: 'Hidden' },
    backendDOMNodeId: 104,
  },
  {
    nodeId: '6',
    ignored: false,
    role: { value: 'link' },
    name: { value: 'Next' },
    properties: [{ name: 'url', value: { value: 'http://fixture.test/next' } }],
    backendDOMNodeId: 105,
  },
  { nodeId: '7', ignored: false, name: { value: '' }, backendDOMNodeId: 106 },
  {
    nodeId: '8',
    ignored: false,
    role: { value: 'navigation' },
    name: { value: '' },
    childIds: ['6'],
    backendDOMNodeId: 107,
  },
]

describe('convertToElementGraph', () => {
  const graph = convertToElementGraph(nodes, URL_, 'Page')

  it('keys elements by page url and CDP AX node id', () => {
    expect([...graph.elements.keys()]).toEqual([
      `${URL_}#node-1`,
      `${URL_}#node-2`,
      `${URL_}#node-3`,
      `${URL_}#node-4`,
      `${URL_}#node-5`,
      `${URL_}#node-6`,
      `${URL_}#node-7`,
      `${URL_}#node-8`,
    ])
    expect(graph.elements.get(`${URL_}#node-2`)?.xpath).toBe('node-2')
  })

  it('keeps unnamed generics and ignored nodes with their ignoredReasons, so both can be bridged (F2)', () => {
    const roles = [...graph.elements.values()].map((e) => `${e.role}:${e.name}`)
    expect(roles.filter((r) => r === 'generic:')).toHaveLength(2)
    expect(roles).toContain('generic:Close banner')
    expect(graph.elements.get(`${URL_}#node-5`)).toMatchObject({
      ignored: true,
      ignoredReasons: ['ariaHiddenElement'],
      backendDOMNodeId: 104,
    })
    expect(graph.elements.get(`${URL_}#node-3`)).toMatchObject({ ignored: false, ignoredReasons: [] })
  })

  it('leaves ignored nodes out of the role indices and the interactive count', () => {
    expect(graph.buttons).toEqual([])
  })

  it('carries backendDOMNodeId across as the DOM bridge', () => {
    expect(graph.elements.get(`${URL_}#node-4`)?.backendDOMNodeId).toBe(103)
  })

  it('computes type flags, indices and outbound links', () => {
    expect(graph.headings).toEqual([`${URL_}#node-2`])
    expect(graph.elements.get(`${URL_}#node-2`)?.typeFlags.headingLevel).toBe(2)
    expect(graph.landmarks).toEqual([`${URL_}#node-8`])
    expect(graph.links).toEqual([`${URL_}#node-6`])
    expect(graph.outboundLinks).toEqual([
      {
        elementId: `${URL_}#node-6`,
        targetUrl: 'http://fixture.test/next',
        linkText: 'Next',
      },
    ])
    expect(graph.interactiveCount).toBe(1)
    expect(graph.elementCount).toBe(8)
  })

  it('links children to parents; a child claimed twice keeps the last parent', () => {
    // node 6 is listed by both the root and the navigation node; the later claim wins.
    expect(graph.elements.get(`${URL_}#node-6`)?.parent).toBe(`${URL_}#node-8`)
    expect(graph.elements.get(`${URL_}#node-8`)?.children).toEqual([`${URL_}#node-6`])
    expect(graph.rootElementIds).toEqual([`${URL_}#node-1`])
  })
})
