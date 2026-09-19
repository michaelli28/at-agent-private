import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BrowserClient, type BrowserPage } from '@at-agent/browser'
import { crawlPageWithGapDetection } from './detect.js'
import type { AccessibilityGap, DualCrawlResult } from './types.js'
import type { GapDetectionOptions } from './detect.js'

const URL_ = 'http://fixture.test/gaps.html'

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gap fixture</title></head><body><main>
<h1>Gap fixture</h1>
<div data-bench-id="div-onclick" onclick="void 0">Add to cart</div>
<div data-bench-id="role-button-onclick" role="button" onclick="void 0">Buy now</div>
<button data-bench-id="icon-button" type="button"><svg aria-hidden="true" width="16" height="16"></svg></button>
<div data-bench-id="generic-labelled" aria-label="Close banner" onclick="void 0">x</div>
<form><input data-bench-id="input-hidden" type="hidden" name="csrf" value="t"></form>
<div data-bench-id="listener-plain">Wishlist</div>
<button data-bench-id="real-button" type="button" onclick="void 0">Checkout</button>
</main>
<script>document.querySelector('[data-bench-id="listener-plain"]').addEventListener('click', function () {})</script>
</body></html>`

const benchId = (g: AccessibilityGap): string => g.domElement.attributes['data-bench-id'] ?? g.domElement.localName

describe('crawlPageWithGapDetection (baseline port)', () => {
  let client: BrowserClient
  let page: BrowserPage
  let result: DualCrawlResult

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
    page = await client.newPage()
    await page.playwrightPage.route(URL_, (route) => route.fulfill({ contentType: 'text/html', body: HTML }))
    result = await crawlPageWithGapDetection(page.playwrightPage, URL_)
  })

  afterAll(async () => {
    await page.close()
    await client.close()
  })

  const gapFor = (id: string): AccessibilityGap | undefined => result.gaps.find((g) => benchId(g) === id)

  it('returns the dual-crawl result for the requested url', () => {
    expect(result.pageUrl).toBe(URL_)
    expect(result.accessibilityTree.title).toBe('Gap fixture')
    expect([...result.accessibilityTree.elements.keys()].every((k) => k.startsWith(`${URL_}#node-`))).toBe(true)
    expect(result.bridgeMap.size).toBeGreaterThan(0)
    expect(result.domElements.length).toBeGreaterThan(0)
  })

  it('flags an unnamed div with an inline handler as wrong_role: Chromium exposes it as a generic node (F2)', () => {
    expect(gapFor('div-onclick')).toMatchObject({
      gapType: 'wrong_role',
      severity: 'serious',
      wcagViolations: ['4.1.2'],
      evidence: 'DIV element has click handlers but generic role "generic"',
    })
  })

  it('without a Tab walk, never flags not_focusable and says why (F3)', () => {
    expect(gapFor('role-button-onclick')).toBeUndefined()
    expect(result.keyboard).toEqual({
      walkRan: false,
      notFocusableAssessed: false,
      unassessedReasons: ['walk-not-run'],
      walkError: null,
      reachedBackendNodeIds: [],
    })
  })

  it('flags an icon button without a name', () => {
    expect(gapFor('icon-button')?.gapType).toBe('no_accessible_name')
  })

  it('flags a named generic with a handler as wrong_role', () => {
    expect(gapFor('generic-labelled')?.gapType).toBe('wrong_role')
  })

  it('drops a type=hidden input instead of flagging it (F1)', () => {
    expect(gapFor('input-hidden')).toBeUndefined()
    const input = result.domElements.find((e) => e.attributes['data-bench-id'] === 'input-hidden')
    expect(result.hidden).toContainEqual({ backendNodeId: input?.backendNodeId, reason: 'hidden-input' })
  })

  it('finds and flags a plain div whose handler comes from addEventListener (F9)', () => {
    expect(gapFor('listener-plain')?.gapType).toBe('wrong_role')
  })

  it('does not flag an accessible button', () => {
    expect(gapFor('real-button')).toBeUndefined()
    expect(result.gaps).toHaveLength(4)
  })
})

// A collapsed dropdown, hidden inputs and a visibility:hidden off-canvas menu, as on the dev navbar base.
const HIDDEN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hidden candidates</title></head><body>
<nav aria-label="Main">
<div class="dropdown"><button data-bench-id="dd-toggle" type="button" aria-expanded="false">Products</button>
<ul class="dropdown-menu" style="display:none"><li><a class="dropdown-item" data-bench-id="dd-item" href="#laptops">Laptops</a></li></ul></div>
<form><input data-bench-id="csrf" type="hidden" name="csrf" value="t"></form>
<button data-bench-id="zero-size" type="button" style="width:0;height:0;padding:0;border:0;overflow:hidden" onclick="void 0">Z</button>
<button data-bench-id="hidden-attr" type="button" hidden onclick="void 0">Retry</button>
<div data-bench-id="visible-onclick" onclick="void 0">Add to cart</div>
</nav>
<div class="offcanvas" data-bench-id="offcanvas" role="dialog" aria-label="Account" tabindex="-1" style="visibility:hidden;position:fixed;top:0;left:0;width:200px">
<button class="btn-close" data-bench-id="offcanvas-close" type="button" aria-label="Close"></button>
<a data-bench-id="offcanvas-link" href="#profile">Profile</a>
</div>
<script>
document.querySelector('[data-bench-id="offcanvas"]').addEventListener('keydown', function () {})
document.querySelector('[data-bench-id="offcanvas-close"]').addEventListener('click', function () {})
</script>
</body></html>`

describe('crawlPageWithGapDetection drops hidden candidates (F1)', () => {
  let client: BrowserClient
  let page: BrowserPage
  let result: DualCrawlResult

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
    page = await client.newPage()
    await page.playwrightPage.route(URL_, (route) => route.fulfill({ contentType: 'text/html', body: HIDDEN_HTML }))
    result = await crawlPageWithGapDetection(page.playwrightPage, URL_)
  })

  afterAll(async () => {
    await page.close()
    await client.close()
  })

  it('flags only the visible clickable div', () => {
    expect(result.gaps.map(benchId)).toEqual(['visible-onclick'])
  })

  it('records why each hidden candidate was dropped', () => {
    const idOf = new Map(result.domElements.map((e) => [e.backendNodeId, e.attributes['data-bench-id'] ?? e.localName]))
    const dropped = Object.fromEntries(result.hidden.map((h) => [idOf.get(h.backendNodeId), h.reason]))
    expect(dropped).toEqual({
      ul: 'no-box',
      'dd-item': 'no-box',
      csrf: 'hidden-input',
      'zero-size': 'zero-area',
      'hidden-attr': 'no-box',
      offcanvas: 'css-hidden',
      'offcanvas-close': 'css-hidden',
      'offcanvas-link': 'css-hidden',
    })
  })
})

const F2_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Roles and aria-hidden</title></head><body><main>
<div data-bench-id="div-onclick" onclick="void 0">Add to cart</div>
<div data-bench-id="group-onclick" role="group" onclick="void 0">Filters</div>
<div data-bench-id="named-generic" aria-label="Close banner" onclick="void 0">x</div>
<a data-bench-id="aria-hidden-link" href="#about" aria-hidden="true">About</a>
<div aria-hidden="true"><button data-bench-id="in-hidden-subtree" type="button">Close</button></div>
<div data-bench-id="presentation-onclick" role="presentation" onclick="void 0">Dismiss</div>
<button data-bench-id="icon-button" type="button"><svg aria-hidden="true" width="16" height="16"></svg></button>
<button data-bench-id="real-button" type="button" onclick="void 0">Checkout</button>
</main></body></html>`

describe('crawlPageWithGapDetection classifies generic roles and aria-hidden (F2)', () => {
  let client: BrowserClient
  let page: BrowserPage
  let result: DualCrawlResult

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
    page = await client.newPage()
    await page.playwrightPage.route(URL_, (route) => route.fulfill({ contentType: 'text/html', body: F2_HTML }))
    result = await crawlPageWithGapDetection(page.playwrightPage, URL_)
  })

  afterAll(async () => {
    await page.close()
    await client.close()
  })

  it('gives each defect its own gap type', () => {
    expect(Object.fromEntries(result.gaps.map((g) => [benchId(g), g.gapType]))).toEqual({
      'div-onclick': 'wrong_role',
      'group-onclick': 'wrong_role',
      'named-generic': 'wrong_role',
      'aria-hidden-link': 'hidden_but_interactive',
      'in-hidden-subtree': 'hidden_but_interactive',
      'presentation-onclick': 'missing_from_a11y_tree',
      'icon-button': 'no_accessible_name',
    })
  })
})

const WALK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Keyboard reachability</title></head><body><main>
<div data-bench-id="no-tabindex" role="button" onclick="void 0">Buy now</div>
<div data-bench-id="junk-tabindex" role="button" tabindex="abc" onclick="void 0">Save</div>
<div data-bench-id="neg-tabindex" role="button" tabindex="-1" onclick="void 0">Compare</div>
<div data-bench-id="ok-tabindex" role="button" tabindex="0" onclick="void 0">Apply</div>
<a data-bench-id="hidden-reachable" href="#a" aria-hidden="true">About</a>
<a data-bench-id="hidden-unreachable" href="#b" aria-hidden="true" tabindex="-1">Duplicate card link</a>
<button data-bench-id="real-button" type="button" onclick="void 0">Checkout</button>
</main></body></html>`

const TRAP_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Trap</title></head><body><main>
<a data-bench-id="first" href="#a">First</a>
<input data-bench-id="trap" aria-label="Trap">
<div data-bench-id="no-tabindex" role="button" onclick="void 0">Buy now</div>
<a data-bench-id="after-trap" href="#b">After</a>
</main>
<script>document.querySelector('[data-bench-id="trap"]').addEventListener('keydown', function (e) { if (e.key === 'Tab') e.preventDefault() })</script>
</body></html>`

const CLOSED_SHADOW_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Closed shadow</title></head><body><main>
<div id="host"></div>
<div data-bench-id="no-tabindex" role="button" onclick="void 0">Buy now</div>
</main>
<script>document.getElementById('host').attachShadow({ mode: 'closed' }).innerHTML = '<button>Inside</button>'</script>
</body></html>`

describe('crawlPageWithGapDetection with a Tab walk on the same load (F3)', () => {
  let client: BrowserClient
  let page: BrowserPage

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
    page = await client.newPage()
  })

  afterAll(async () => {
    await page.close()
    await client.close()
  })

  async function detectWith(html: string, tabWalk: GapDetectionOptions['tabWalk']): Promise<DualCrawlResult> {
    await page.playwrightPage.unrouteAll()
    await page.playwrightPage.route(URL_, (route) => route.fulfill({ contentType: 'text/html', body: html }))
    return crawlPageWithGapDetection(page.playwrightPage, URL_, { tabWalk })
  }

  const byId = (r: DualCrawlResult): Record<string, string> =>
    Object.fromEntries(r.gaps.map((g) => [benchId(g), g.gapType]))

  it('decides focusability from where Tab really goes, not from the tabindex attribute', async () => {
    const result = await detectWith(WALK_HTML, { settleMs: 20 })
    expect(result.keyboard).toMatchObject({ walkRan: true, notFocusableAssessed: true, unassessedReasons: [] })
    expect(byId(result)).toEqual({
      'no-tabindex': 'not_focusable',
      'junk-tabindex': 'not_focusable',
      'neg-tabindex': 'not_focusable',
      'hidden-reachable': 'hidden_but_interactive',
    })
    const reached = new Set(result.keyboard.reachedBackendNodeIds)
    const okButton = result.domElements.find((e) => e.attributes['data-bench-id'] === 'ok-tabindex')
    expect(reached.has(okButton?.backendNodeId ?? -1)).toBe(true)
  })

  it('does not flag not_focusable when the walk never wraps (a trap), and says why', async () => {
    const result = await detectWith(TRAP_HTML, { settleMs: 20 })
    expect(result.keyboard).toMatchObject({
      walkRan: true,
      notFocusableAssessed: false,
      unassessedReasons: ['no-wrap'],
    })
    expect(byId(result)).toEqual({})
  })

  it('does not flag not_focusable when a closed shadow root may hide Tab stops', async () => {
    const result = await detectWith(CLOSED_SHADOW_HTML, { settleMs: 20 })
    expect(result.keyboard.unassessedReasons).toEqual(['focusables-incomplete'])
    expect(byId(result)).toEqual({})
  })

  it('records a walk that could not run instead of failing the detection', async () => {
    const result = await detectWith(WALK_HTML, { presses: 1 })
    expect(result.keyboard).toMatchObject({
      walkRan: false,
      notFocusableAssessed: false,
      unassessedReasons: ['walk-failed'],
    })
    expect(result.keyboard.walkError).toMatch(/presses 1 is below the default/)
    expect(result.errors).toContainEqual(expect.objectContaining({ stage: 'tab-walk', backendNodeId: null }))
    expect(byId(result)['hidden-reachable']).toBe('hidden_but_interactive')
  })

  it('runs the walk with defaults when tabWalk is true', async () => {
    const result = await detectWith(TRAP_HTML, true)
    expect(result.keyboard.walkRan).toBe(true)
  })
})
