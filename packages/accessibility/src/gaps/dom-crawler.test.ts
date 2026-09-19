import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Page } from 'playwright'
import { BrowserClient, type BrowserPage } from '@at-agent/browser'
import { crawlDOM, getInteractivitySignals, isElementVisible } from './dom-crawler.js'
import type { DOMElement } from './types.js'

const HTML = `<!doctype html><html lang="en"><head><title>crawl</title></head><body>
<button id="b">Go</button>
<a id="link" href="#x" class="nav-link">Link</a>
<div id="btn-div" class="btn" style="cursor:pointer">Add</div>
<div id="plain" style="cursor:pointer">Plain</div>
<div id="tabneg" tabindex="-1">Neg</div>
<div id="junk" tabindex="abc" role="button" aria-expanded="false">Junk</div>
<button id="gone" style="display:none">Gone</button>
<script>
document.getElementById('btn-div').addEventListener('click', function () {})
document.getElementById('plain').addEventListener('click', function () {})
</script>
</body></html>`

const idOf = (e: DOMElement): string => e.attributes['id'] ?? e.localName

describe('dom-crawler (baseline port)', () => {
  let client: BrowserClient
  let browserPage: BrowserPage
  let page: Page
  let elements: DOMElement[]

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
    browserPage = await client.newPage()
    page = browserPage.playwrightPage
    await page.setContent(HTML)
    const crawl = await crawlDOM(page, 'http://fixture.test/')
    elements = crawl.elements
    expect(crawl.errors).toEqual([])
  })

  afterAll(async () => {
    await browserPage.close()
    await client.close()
  })

  const find = (id: string): DOMElement => {
    const found = elements.find((e) => idOf(e) === id)
    if (!found) throw new Error(`not enumerated: ${id}`)
    return found
  }

  it('enumerates selector matches in selector order, then listener finds, deduplicated by backendNodeId', () => {
    expect(elements.map(idOf)).toEqual(['b', 'gone', 'link', 'junk', 'tabneg', 'btn-div', 'plain'])
    expect(elements.every((e) => e.pageUrl === 'http://fixture.test/')).toBe(true)
  })

  it('finds a plain div by its script listener (F9)', () => {
    expect(elements.map(idOf)).toContain('plain')
  })

  it('records raw attributes and a null box for an unrendered element', () => {
    expect(find('junk').attributes).toMatchObject({
      tabindex: 'abc',
      role: 'button',
      'aria-expanded': 'false',
    })
    expect(find('gone').boundingBox).toBeNull()
    expect(find('b').boundingBox?.width).toBeGreaterThan(0)
    expect(find('b').nodeName).toBe('BUTTON')
    expect(find('b').localName).toBe('button')
  })

  it('detects a script click listener and reads cursor:pointer (F9)', async () => {
    const { signals, errors } = await getInteractivitySignals(page, find('btn-div'))
    expect(errors).toEqual([])
    expect(signals.hasClickHandler).toBe(true)
    expect(signals.hasCursorPointer).toBe(true)
    expect(signals.classNameHints).toEqual(['btn'])
    expect(signals.isSemanticInteractive).toBe(false)
  })

  it('parses tabindex from the attribute, turning junk into 0', async () => {
    const { signals: neg } = await getInteractivitySignals(page, find('tabneg'))
    expect(neg.hasTabindex).toBe(true)
    expect(neg.tabindexValue).toBe(-1)
    const { signals: junk } = await getInteractivitySignals(page, find('junk'))
    expect(junk.tabindexValue).toBe(0)
    expect(junk.hasRoleAttribute).toBe(true)
    expect(junk.roleValue).toBe('button')
    expect(junk.hasAriaExpanded).toBe(true)
  })

  it('marks native controls as semantic interactive', async () => {
    const { signals } = await getInteractivitySignals(page, find('b'))
    expect(signals.isSemanticInteractive).toBe(true)
    expect(signals.hasClickHandler).toBe(false)
    expect(signals.hasCursorPointer).toBe(false)
  })

  it('records a signal read that fails instead of swallowing it (F9)', async () => {
    const { signals, errors } = await getInteractivitySignals(page, { ...find('b'), backendNodeId: 99999999 })
    expect(errors.map((e) => [e.stage, e.backendNodeId])).toEqual([
      ['cursor', 99999999],
      ['listeners', 99999999],
    ])
    expect(signals.isSemanticInteractive).toBe(true)
  })

  it('isElementVisible reports a display:none element as not visible (F1)', async () => {
    expect(await isElementVisible(page, find('gone'))).toBe(false)
    expect(await isElementVisible(page, find('b'))).toBe(true)
  })
})

describe('isElementVisible (F1)', () => {
  let client: BrowserClient
  let browserPage: BrowserPage
  let page: Page
  let elements: DOMElement[]

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
    browserPage = await client.newPage()
    page = browserPage.playwrightPage
    await page.setContent(`<!doctype html><html lang="en"><head><title>vis</title></head><body>
<button id="shown">Shown</button>
<button id="vis-hidden" style="visibility:hidden">Hidden</button>
<div style="visibility:hidden"><a id="vis-hidden-child" href="#x">Child</a></div>
<input id="hidden-input" type="hidden" value="t">
<button id="zero" style="width:0;height:0;padding:0;border:0;overflow:hidden">Z</button>
<div hidden><button id="hidden-attr-child">H</button></div>
<button id="transparent" style="opacity:0">Still rendered</button>
</body></html>`)
    elements = (await crawlDOM(page, 'http://fixture.test/')).elements
  })

  afterAll(async () => {
    await browserPage.close()
    await client.close()
  })

  it('is false for visibility:hidden (own or inherited), type=hidden, zero area and unrendered elements', async () => {
    const visible: Record<string, boolean> = {}
    for (const element of elements) visible[idOf(element)] = await isElementVisible(page, element)
    expect(visible).toEqual({
      shown: true,
      'vis-hidden': false,
      'vis-hidden-child': false,
      'hidden-input': false,
      zero: false,
      'hidden-attr-child': false,
      transparent: true,
    })
  })
})

// React's internals are simulated here (the real-React stale case runs in bench/gaps-dev.test.ts): __reactProps$ holds
// the current handler props, __reactContainer$ marks the root, and React plants a no-op el.onclick for onClick.
const DISCOVERY_HTML = `<!doctype html><html lang="en"><head><title>discovery</title></head><body>
<div id="ptr-down">Pointer down</div>
<div id="root"><div id="react-live">Live</div><div id="react-stale">Stale</div><div id="react-mousedown">Mouse down</div>
<div id="react-hover">Hover</div><div id="react-listener">Listener</div><div id="react-plain">Plain</div></div>
<div id="no-handler">Nothing</div>
<iframe srcdoc="<div id='in-frame'>In frame</div><script>document.getElementById('in-frame').addEventListener('click', function () {})<\/script>"></iframe>
<script>
var noop = function () {}
var byId = function (id) { return document.getElementById(id) }
byId('ptr-down').addEventListener('pointerdown', noop)
byId('root').__reactContainer$t = {}
byId('root').addEventListener('click', noop)
byId('root').addEventListener('keydown', noop)
byId('react-live').__reactProps$t = { onClick: noop, children: 'Live' }
byId('react-live').onclick = function () {}
byId('react-stale').__reactProps$t = { children: 'Stale' }
byId('react-stale').onclick = function () {}
byId('react-mousedown').__reactProps$t = { onMouseDown: noop }
byId('react-hover').__reactProps$t = { onMouseEnter: noop }
byId('react-listener').__reactProps$t = { children: 'Listener' }
byId('react-listener').addEventListener('click', noop)
byId('react-plain').__reactProps$t = { children: 'Plain' }
document.body.addEventListener('click', noop)
document.documentElement.addEventListener('keydown', noop)
document.addEventListener('click', noop)
window.addEventListener('click', noop)
</script>
</body></html>`

describe('discovery by listeners and React props (F9)', () => {
  let client: BrowserClient
  let browserPage: BrowserPage
  let page: Page
  let elements: DOMElement[]

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
    browserPage = await client.newPage()
    page = browserPage.playwrightPage
    await page.setContent(DISCOVERY_HTML)
    await page.waitForFunction("document.querySelector('iframe').contentDocument.getElementById('in-frame') !== null")
    const crawl = await crawlDOM(page, 'http://fixture.test/')
    expect(crawl.errors).toEqual([])
    elements = crawl.elements
  })

  afterAll(async () => {
    await browserPage.close()
    await client.close()
  })

  it('finds activation listeners and React handler props; skips html, body, the React root and other frames', () => {
    expect(elements.map(idOf).sort()).toEqual(
      ['ptr-down', 'react-hover', 'react-listener', 'react-live', 'react-mousedown', 'react-stale'].sort(),
    )
  })

  it("takes a React element's handlers from its props, not from the no-op onclick React leaves behind", async () => {
    const handler: Record<string, boolean> = {}
    for (const element of elements) {
      const { signals, errors } = await getInteractivitySignals(page, element)
      expect(errors).toEqual([])
      handler[idOf(element)] = signals.hasClickHandler
    }
    expect(handler).toEqual({
      'ptr-down': true,
      'react-live': true,
      'react-stale': false,
      'react-mousedown': true,
      'react-hover': false,
      'react-listener': true,
    })
  })
})
