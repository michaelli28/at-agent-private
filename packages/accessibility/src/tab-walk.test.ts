import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { CDPSession } from 'playwright'
import { BrowserClient, BrowserPage } from '@at-agent/browser'
import { runTabWalk, TabWalkResultSchema, type FocusRead } from './tab-walk.js'

// Fixtures A, D, E are copied from bench/probes/wrap/fixtures (shell-mode sequences in bench/probes/wrap/RESULT.md).
const FIXTURE_A = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture A</title></head><body>
<h1>Fixture A: three links with ids</h1>
<p><a id="a1" data-p="a1" href="#one">One</a></p>
<p><a id="a2" data-p="a2" href="#two">Two</a></p>
<p><a id="a3" data-p="a3" href="#three">Three</a></p>
</body></html>`

const FIXTURE_D = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture D</title></head><body>
<h1>Fixture D: three identical Read more links, no ids</h1>
<p>Story one. <a data-p="r1" href="#more">Read more</a></p>
<p>Story two. <a data-p="r2" href="#more">Read more</a></p>
<p>Story three. <a data-p="r3" href="#more">Read more</a></p>
</body></html>`

const FIXTURE_E = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture E</title></head><body>
<h1>Fixture E: F55 blur-on-focus</h1>
<p><a id="e1" data-p="e1" href="#before">Before</a></p>
<p><a href="#" id="blurme" data-p="blurme" onfocus="this.blur()">Blur me</a></p>
<p><a id="e3" data-p="e3" href="#after">After</a></p>
</body></html>`

const TAB_SWALLOW_TRAP = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Trap</title></head><body>
<p><a id="t1" href="#one">One</a></p>
<p><input id="trap" type="text" aria-label="Trap"></p>
<p><a id="t3" href="#three">Three</a></p>
<script>
document.getElementById('trap').addEventListener('keydown', (e) => { if (e.key === 'Tab') e.preventDefault() })
</script>
</body></html>`

const MODAL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Modal</title></head><body>
<p><a id="before" href="#b">Before</a></p>
<p><button id="open" type="button">Open dialog</button></p>
<div id="dlg" role="dialog" aria-modal="true" aria-label="Dialog">
  <button id="ok" type="button">OK</button>
  <button id="cancel" type="button">Cancel</button>
</div>
<script>
const dlg = document.getElementById('dlg')
const opener = document.getElementById('open')
const items = () => [...dlg.querySelectorAll('button')]
document.addEventListener('keydown', (e) => {
  if (dlg.hidden) return
  if (e.key === 'Tab') {
    e.preventDefault()
    const list = items()
    const i = list.indexOf(document.activeElement)
    const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length
    list[next].focus()
  } else if (e.key === 'Escape') {
    dlg.hidden = true
    opener.focus()
  }
})
items()[0].focus()
</script>
</body></html>`

const NO_FOCUSABLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Empty</title></head><body>
<h1>Nothing to focus</h1><p>Plain text only.</p>
<a>anchor without href</a><button disabled>Disabled</button><input type="hidden" name="h">
<button style="display:none">Hidden</button>
</body></html>`

const LEGACY_FIELDS = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fields</title></head><body>
<button id="close" class="x  y" aria-label="Close" type="button">X</button>
<input name="q" class="field" type="text">
</body></html>`

// Short settle keeps the suite fast; headless shell showed 0 immediate/settled drift in 1,660 presses.
const FAST = 20

function label(read: FocusRead): string {
  if (read.isBody) return read.hasFocus ? 'body' : 'body!'
  return read.id ?? read.tag ?? 'null'
}

describe('runTabWalk', () => {
  let client: BrowserClient
  const pages: BrowserPage[] = []

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
  })

  afterEach(async () => {
    await Promise.all(pages.splice(0).map((p) => p.close()))
  })

  afterAll(async () => {
    await client.close()
  })

  async function open(html: string): Promise<BrowserPage> {
    const page = await client.newPage()
    pages.push(page)
    await page.playwrightPage.setContent(html, { waitUntil: 'load' })
    return page
  }

  it('fixture A: period F+1 with a wrapped marker on every wrap', async () => {
    const page = await open(FIXTURE_A)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(() => TabWalkResultSchema.parse(result)).not.toThrow()
    expect(result.focusableCount).toBe(3)
    expect(result.defaultPresses).toBe(25)
    expect(result.presses).toBe(25)
    expect(result.steps).toHaveLength(25)
    expect(result.steps.map((s) => s.index)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
    expect(result.steps.map((s) => label(s.settled))).toEqual(
      Array.from({ length: 25 }, (_, i) => ['a1', 'a2', 'a3', 'body!'][i % 4]),
    )
    expect(result.steps.filter((s) => s.wrapped).map((s) => s.index)).toEqual([4, 8, 12, 16, 20, 24])
    expect(result.steps.every((s) => s.key === 'Tab' && !s.focusLost && !s.documentReplaced)).toBe(true)
    expect(result.steps.every((s) => s.immediate.backendNodeId === s.settled.backendNodeId)).toBe(true)
    expect(result.steps[0].settled.backendNodeId).toBe(result.steps[4].settled.backendNodeId)
    expect(result.initial.isBody).toBe(true)
    expect(result.initial.hasFocus).toBe(true)
    expect(result.suspectedTrap).toBe(false)
    expect(result.escapeProbe).toBeNull()
    expect(result.error).toBeNull()
  })

  it('fixture D: identical id-less links get three distinct backendNodeIds', async () => {
    const page = await open(FIXTURE_D)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    const firstCycle = result.steps.slice(0, 3).map((s) => s.settled)
    expect(firstCycle.map((r) => [r.tag, r.id, r.text])).toEqual([
      ['a', null, 'Read more'],
      ['a', null, 'Read more'],
      ['a', null, 'Read more'],
    ])
    const ids = firstCycle.map((r) => r.backendNodeId)
    expect(ids.every((id) => typeof id === 'number')).toBe(true)
    expect(new Set(ids).size).toBe(3)
    expect(result.steps.slice(4, 7).map((s) => s.settled.backendNodeId)).toEqual(ids)
  })

  it('fixture E: blur-on-focus yields focusLost, then the next Tab lands on the third link', async () => {
    const page = await open(FIXTURE_E)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    const [s1, s2, s3, s4] = result.steps
    expect(label(s1.settled)).toBe('e1')
    expect(s1.focusLost).toBe(false)
    expect(label(s2.settled)).toBe('body')
    expect(s2.focusLost).toBe(true)
    expect(s2.wrapped).toBe(false)
    expect(label(s3.settled)).toBe('e3')
    expect(s4.wrapped).toBe(true)
    expect(s4.focusLost).toBe(false)
    expect(result.suspectedTrap).toBe(false)
  })

  it('Tab-swallowing element: no wrap, suspectedTrap, escape probe recorded without an exit', async () => {
    const page = await open(TAB_SWALLOW_TRAP)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(3)
    expect(result.steps).toHaveLength(25)
    expect(result.steps.some((s) => s.wrapped)).toBe(false)
    expect(result.steps.slice(1).every((s) => label(s.settled) === 'trap')).toBe(true)
    expect(result.suspectedTrap).toBe(true)

    const probe = result.escapeProbe
    expect(probe).not.toBeNull()
    if (!probe) return
    const trapId = result.steps[24].settled.backendNodeId
    expect(probe.probeKey).toBe('Shift+Tab')
    expect(probe.seenBackendNodeIds).toEqual([trapId])
    expect(probe.before.backendNodeId).toBe(trapId)
    expect(probe.escape.after.backendNodeId).toBe(trapId)
    expect(probe.escape.unseenElement).toBe(false)
    expect(probe.escape.wrapped).toBe(false)
    expect(probe.escape.urlChanged).toBe(false)
    expect(probe.escape.documentReplaced).toBe(false)
    expect(probe.maxPresses).toBe(5)
    expect(probe.steps).toHaveLength(5)
    expect(probe.steps.every((s) => s.key === 'Shift+Tab' && s.settled.backendNodeId === trapId)).toBe(true)
    expect(probe.reachedAt).toBeNull()
  })

  it('modal trapping focus by design: Escape returns focus to an unseen element', async () => {
    const page = await open(MODAL)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(4)
    expect(result.steps).toHaveLength(30)
    expect(label(result.initial)).toBe('ok')
    expect(new Set(result.steps.map((s) => label(s.settled)))).toEqual(new Set(['ok', 'cancel']))
    expect(result.suspectedTrap).toBe(true)

    const probe = result.escapeProbe
    expect(probe).not.toBeNull()
    if (!probe) return
    expect(label(probe.escape.after)).toBe('open')
    expect(probe.escape.unseenElement).toBe(true)
    expect(probe.escape.urlChanged).toBe(false)
    expect(label(probe.steps[0].settled)).toBe('before')
    expect(probe.steps[0].unseenElement).toBe(true)
    expect(probe.reachedAt).toBe(1)
    expect(probe.steps).toHaveLength(1)
  })

  it('page with no focusable elements: F=0, every read is body', async () => {
    const page = await open(NO_FOCUSABLE)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(0)
    expect(result.presses).toBe(10)
    expect(result.steps).toHaveLength(10)
    expect(result.steps.every((s) => s.settled.isBody && !s.focusLost)).toBe(true)
    expect(result.suspectedTrap).toBe(false)
  })

  it('backward walk uses Shift+Tab and visits links in reverse order', async () => {
    const page = await open(FIXTURE_A)
    const result = await runTabWalk(page.playwrightPage, {
      settleMs: FAST,
      direction: 'backward',
    })

    expect(result.direction).toBe('backward')
    expect(result.steps).toHaveLength(25)
    expect(result.steps.every((s) => s.key === 'Shift+Tab')).toBe(true)
    const firstLinks = result.steps
      .map((s) => label(s.settled))
      .filter((l) => !l.startsWith('body'))
      .slice(0, 3)
    expect(firstLinks).toEqual(['a3', 'a2', 'a1'])
    expect(result.steps.filter((s) => s.wrapped).length).toBeGreaterThanOrEqual(5)
    expect(result.suspectedTrap).toBe(false)
  })

  it('records the raw fields the legacy tools.ts identity string is built from, plus focus style', async () => {
    const page = await open(LEGACY_FIELDS)
    const result = await runTabWalk(page.playwrightPage, {
      settleMs: FAST,
      presses: 2,
      allowFewerPresses: true,
      escapeProbe: false,
    })

    const [button, input] = result.steps.map((s) => s.settled)
    expect(button).toMatchObject({
      tag: 'button',
      id: 'close',
      className: 'x  y',
      ariaLabel: 'Close',
      text: 'X',
    })
    expect(input).toMatchObject({
      tag: 'input',
      id: null,
      className: 'field',
      nameAttr: 'q',
      nameProp: 'q',
      ariaLabel: null,
    })
    const style = result.steps[0].focusStyle
    expect(style).not.toBeNull()
    expect(Object.keys(style ?? {}).sort()).toEqual(['boxShadow', 'outlineColor', 'outlineStyle', 'outlineWidth'])
  })

  it('rejects presses below the default unless explicitly allowed', async () => {
    const page = await open(FIXTURE_A)
    await expect(runTabWalk(page.playwrightPage, { presses: 3 })).rejects.toThrow(/presses/)

    const result = await runTabWalk(page.playwrightPage, {
      settleMs: FAST,
      presses: 3,
      allowFewerPresses: true,
      escapeProbe: false,
    })
    expect(result.presses).toBe(3)
    expect(result.steps).toHaveLength(3)
    expect(result.suspectedTrap).toBe(true)
    expect(result.escapeProbe).toBeNull()
  })

  it('flags a document replacement and keeps walking on the new document', async () => {
    const page = await client.newPage()
    pages.push(page)
    const pw = page.playwrightPage
    const one = `<!doctype html><html><body><a id="go" href="#x" onfocus="location.href='/two.html'">Go</a></body></html>`
    const two = `<!doctype html><html><body><a id="t1" href="#t">T1</a></body></html>`
    await pw.route('http://tabwalk.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: new URL(route.request().url()).pathname === '/two.html' ? two : one,
      }),
    )
    await pw.goto('http://tabwalk.test/one.html', { waitUntil: 'load' })

    const result = await runTabWalk(pw, {
      settleMs: 300,
      presses: 6,
      allowFewerPresses: true,
      escapeProbe: false,
    })

    expect(result.error).toBeNull()
    expect(result.steps.filter((s) => s.documentReplaced)).toHaveLength(1)
    expect(result.steps.at(-1)?.settled.url).toBe('http://tabwalk.test/two.html')
    expect(result.steps.some((s) => s.settled.id === 't1')).toBe(true)
  })

  it('opens one CDP session and detaches it after the walk', async () => {
    const page = await open(FIXTURE_A)
    const spy = vi.spyOn(page.playwrightPage.context(), 'newCDPSession')
    await runTabWalk(page.playwrightPage, {
      settleMs: FAST,
      presses: 2,
      allowFewerPresses: true,
    })

    expect(spy).toHaveBeenCalledTimes(1)
    const session: CDPSession = await spy.mock.results[0].value
    await expect(session.send('Runtime.evaluate', { expression: '1' })).rejects.toThrow()
  })

  it('records a mid-walk error, returns partial result, and still detaches', async () => {
    const page = await open(FIXTURE_A)
    const pw = page.playwrightPage
    const spy = vi.spyOn(pw.context(), 'newCDPSession')
    vi.spyOn(pw.keyboard, 'press').mockRejectedValueOnce(new Error('boom'))

    const result = await runTabWalk(pw, { settleMs: FAST })

    expect(result.error).toEqual({ phase: 'walk', index: 1, message: 'boom' })
    expect(result.steps).toHaveLength(0)
    expect(result.suspectedTrap).toBeNull()
    expect(result.escapeProbe).toBeNull()
    const session: CDPSession = await spy.mock.results[0].value
    await expect(session.send('Runtime.evaluate', { expression: '1' })).rejects.toThrow()
  })
})
