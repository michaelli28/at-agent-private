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
    elements = await crawlDOM(page, 'http://fixture.test/')
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

  it('enumerates selector matches in selector order, deduplicated by backendNodeId', () => {
    expect(elements.map(idOf)).toEqual(['b', 'gone', 'link', 'junk', 'tabneg', 'btn-div'])
    expect(elements.every((e) => e.pageUrl === 'http://fixture.test/')).toBe(true)
  })

  it('never visits a plain div with a script listener (selector-only discovery)', () => {
    expect(elements.map(idOf)).not.toContain('plain')
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

  it('detects a script click listener but never reports cursor:pointer', async () => {
    const signals = await getInteractivitySignals(page, find('btn-div'))
    expect(signals.hasClickHandler).toBe(true)
    expect(signals.hasCursorPointer).toBe(false)
    expect(signals.classNameHints).toEqual(['btn'])
    expect(signals.isSemanticInteractive).toBe(false)
  })

  it('parses tabindex from the attribute, turning junk into 0', async () => {
    const neg = await getInteractivitySignals(page, find('tabneg'))
    expect(neg.hasTabindex).toBe(true)
    expect(neg.tabindexValue).toBe(-1)
    const junk = await getInteractivitySignals(page, find('junk'))
    expect(junk.tabindexValue).toBe(0)
    expect(junk.hasRoleAttribute).toBe(true)
    expect(junk.roleValue).toBe('button')
    expect(junk.hasAriaExpanded).toBe(true)
  })

  it('marks native controls as semantic interactive', async () => {
    const signals = await getInteractivitySignals(page, find('b'))
    expect(signals.isSemanticInteractive).toBe(true)
    expect(signals.hasClickHandler).toBe(false)
  })

  it('isElementVisible reports even a display:none element as visible', async () => {
    expect(await isElementVisible(page, find('gone'))).toBe(true)
  })
})
