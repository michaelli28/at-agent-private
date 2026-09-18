import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BrowserClient, type BrowserPage } from '@at-agent/browser'
import { crawlPageWithGapDetection } from './detect.js'
import type { AccessibilityGap, DualCrawlResult } from './types.js'

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

  it('flags an unnamed div with an inline handler as missing from the tree', () => {
    expect(gapFor('div-onclick')).toMatchObject({
      gapType: 'missing_from_a11y_tree',
      severity: 'critical',
      wcagViolations: ['4.1.2'],
      evidence: 'DIV element with interactivity signals is not exposed in the accessibility tree',
    })
  })

  it('flags role=button without tabindex as not focusable', () => {
    expect(gapFor('role-button-onclick')).toMatchObject({
      gapType: 'not_focusable',
      evidence: 'DIV element has click handlers but has no tabindex and is not a native interactive element',
    })
  })

  it('flags an icon button without a name', () => {
    expect(gapFor('icon-button')?.gapType).toBe('no_accessible_name')
  })

  it('flags a named generic with a handler as wrong_role', () => {
    expect(gapFor('generic-labelled')?.gapType).toBe('wrong_role')
  })

  it('flags a type=hidden input as missing from the tree', () => {
    expect(gapFor('input-hidden')?.gapType).toBe('missing_from_a11y_tree')
  })

  it('never sees a plain div whose handler comes from addEventListener', () => {
    expect(result.domElements.some((e) => e.attributes['data-bench-id'] === 'listener-plain')).toBe(false)
  })

  it('does not flag an accessible button', () => {
    expect(gapFor('real-button')).toBeUndefined()
    expect(result.gaps).toHaveLength(5)
  })
})
