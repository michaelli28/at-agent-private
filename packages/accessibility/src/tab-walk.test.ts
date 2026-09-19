import { describe, it, expect, beforeAll, afterAll, afterEach, vi, type MockInstance } from 'vitest'
import type { CDPSession, Page } from 'playwright'
import { BrowserClient, BrowserPage } from '@at-agent/browser'
import { runTabWalk, TabWalkResultSchema, focusIdentity, type FocusRead } from './tab-walk.js'

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

const doc = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>\n${body}\n</body></html>`

const links = (prefix: string, n: number): string =>
  Array.from({ length: n }, (_, i) => `<a id="${prefix}${i}" href="#${prefix}${i}">${prefix}${i}</a>`).join('')

const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

// srcdoc is an attribute value, so the inner document's quotes and ampersands must be escaped.
const srcdoc = (html: string): string => html.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

// The verifier's F-undercount cases: one light-DOM link plus 20 links behind an open shadow root or a same-origin frame.
const SHADOW_20 = doc(
  'Shadow 20',
  `<p><a id="light" href="#light">Light</a></p>
<div id="host"></div>
<script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(links('s', 20))}</script>`,
)

const FRAME_20 = doc(
  'Frame 20',
  `<p><a id="light" href="#light">Light</a></p>
<iframe id="frame" srcdoc="${srcdoc(links('f', 20))}"></iframe>`,
)

const SHADOW_TRAP = doc(
  'Shadow trap',
  `<p><a id="light" href="#light">Light</a></p>
<div id="host"></div>
<script>
const root = document.getElementById('host').attachShadow({ mode: 'open' })
root.innerHTML = '<a id="s1" href="#s1">S1</a><input id="trap" type="text" aria-label="Trap"><a id="s3" href="#s3">S3</a>'
root.getElementById('trap').addEventListener('keydown', (e) => { if (e.key === 'Tab') e.preventDefault() })
</script>`,
)

// MODAL moved into one open shadow root: opener, dialog and Escape target all share the host, so
// only deep identity can tell the opener from the dialog buttons.
const SHADOW_MODAL = doc(
  'Shadow modal',
  `<p><a id="light" href="#light">Light</a></p>
<div id="host"></div>
<script>
const root = document.getElementById('host').attachShadow({ mode: 'open' })
root.innerHTML = '<button id="open" type="button">Open</button><div id="dlg" role="dialog" aria-modal="true" aria-label="Dialog"><button id="ok" type="button">OK</button><button id="cancel" type="button">Cancel</button></div>'
const dlg = root.getElementById('dlg')
const opener = root.getElementById('open')
const items = () => [...dlg.querySelectorAll('button')]
root.addEventListener('keydown', (e) => {
  if (dlg.hidden) return
  if (e.key === 'Tab') {
    e.preventDefault()
    const list = items()
    const i = list.indexOf(root.activeElement)
    const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length
    list[next].focus()
  } else if (e.key === 'Escape') {
    dlg.hidden = true
    opener.focus()
  }
})
items()[0].focus()
</script>`,
)

const CLOSED_SHADOW = doc(
  'Closed shadow',
  `<p><a id="light" href="#light">Light</a></p>
<div id="closed"></div>
<div id="hidden-closed" style="display:none"></div>
<script>
document.getElementById('closed').attachShadow({ mode: 'closed' }).innerHTML = ${JSON.stringify(links('k', 3))}
document.getElementById('hidden-closed').attachShadow({ mode: 'closed' }).innerHTML = ${JSON.stringify(links('h', 3))}
</script>`,
)

// Headless shell stops once on a frame with nothing focusable, skips a tabindex=-1 frame with its
// content, and leaves focus on the frame's body after an F55 blur inside it.
const FRAME_STOPS = doc(
  'Frame stops',
  `<p><a id="light" href="#light">Light</a></p>
<iframe id="empty" srcdoc="<p>Nothing to focus</p>"></iframe>
<iframe id="skipped" tabindex="-1" srcdoc="${srcdoc(links('n', 2))}"></iframe>
<iframe id="blur" srcdoc="${srcdoc('<a id="b0" href="#b0" onfocus="this.blur()">B0</a><a id="b1" href="#b1">B1</a>')}"></iframe>`,
)

// Keys are host + path; served through page.route so other.test is a real cross-origin frame.
const CROSS_ORIGIN_ROUTES = {
  'tabwalk.test/xo.html': doc(
    'Cross-origin',
    `<p><a id="light" href="#light">Light</a></p>
<iframe id="xo" src="http://other.test/frame.html"></iframe>
<iframe id="xo-hidden" style="display:none" src="http://other.test/frame.html"></iframe>
<p><a id="after" href="#after">After</a></p>`,
  ),
  'other.test/frame.html': doc('Frame', links('c', 2)),
}

const OBJECT_ROUTES = {
  'tabwalk.test/object.html': doc(
    'Object',
    `<p><a id="light" href="#light">Light</a></p>
<object id="obj" type="text/html" data="/embedded.html" width="300" height="80"></object>`,
  ),
  'tabwalk.test/embedded.html': doc('Embedded', links('o', 2)),
}

const NESTED_ROUTES = {
  'tabwalk.test/nested.html': doc(
    'Nested',
    `<div id="host"></div>
<script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<a id="s0" href="#s0">S0</a><iframe id="inner-frame" src="/inner.html"></iframe>'</script>`,
  ),
  'tabwalk.test/inner.html': doc(
    'Inner',
    `<a id="f0" href="#f0">F0</a><div id="inner-host"></div>
<script>document.getElementById('inner-host').attachShadow({ mode: 'open' }).innerHTML = '<a id="n0" href="#n0">N0</a>'</script>`,
  ),
}

// Copied verbatim from packages/agent/src/tools.ts executeTab (~lines 221-240); keep in sync.
const TOOLS_TS_FOCUS_EXPR = `
      (() => {
        const el = document.activeElement;
        if (!el || el === document.body) {
          return 'body';
        }

        const tag = el.tagName.toLowerCase();
        const id = el.id ? '#' + el.id : '';
        const className = el.className && typeof el.className === 'string'
          ? '.' + el.className.split(' ').filter(Boolean).join('.')
          : '';
        const name = el.getAttribute('aria-label')
          || el.name
          || (el.textContent || '').slice(0, 30).trim()
          || '';

        return tag + id + className + (name ? ' "' + name + '"' : '');
      })()
    `

const LEGACY_CASES = doc(
  'Legacy',
  `<button data-case="long" type="button">
    A label that runs well past the thirty character slice</button>
<input data-case="name" name="query" type="text">
<button data-case="aria" aria-label="Close dialog" type="button">X</button>
<a data-case="class" class="  nav  item active " href="#c">Classy</a>
<a data-case="id" id="home" href="#h">Home</a>
<div data-case="zero" tabindex="0">Zero name</div>
<script>document.querySelector('[data-case=zero]').name = 0</script>`,
)

// Rebuilds TOOLS_TS_FOCUS_EXPR's string from a read's top-level fields (same rebuild as bench/legacy.ts).
function legacyIdentity(read: FocusRead): string {
  if (read.tag === null || read.isBody) return 'body'
  const id = read.id ? `#${read.id}` : ''
  const className = read.className ? `.${read.className.split(' ').filter(Boolean).join('.')}` : ''
  const name = read.ariaLabel || read.nameProp || (read.text ?? '').trim()
  return read.tag + id + className + (name ? ` "${name}"` : '')
}

// Short settle keeps the suite fast; headless shell showed 0 immediate/settled drift in 1,660 presses.
const FAST = 20

function label(read: FocusRead): string {
  if (read.isBody) return read.hasFocus ? 'body' : 'body!'
  return read.id ?? read.tag ?? 'null'
}

// Like label, but names the deep element when focus sits behind a container.
function deepLabel(read: FocusRead): string {
  if (read.isBody) return label(read)
  return read.deep?.id ?? label(read)
}

// Every read sits behind the same top-level container, and each resolves to its own deep element.
function expectBehindOneContainer(reads: FocusRead[], container: FocusRead['container']): void {
  const hostIds = new Set(reads.map((r) => r.backendNodeId))
  expect(hostIds.size).toBe(1)
  expect(reads.every((r) => r.container === container && r.deepUnavailable === null)).toBe(true)
  const deepIds = reads.map(focusIdentity)
  expect(new Set(deepIds).size).toBe(reads.length)
  expect(deepIds.some((id) => hostIds.has(id))).toBe(false)
}

describe('runTabWalk', () => {
  let client: BrowserClient
  const pages: BrowserPage[] = []

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
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

  async function serve(routes: Record<string, string>, path: string): Promise<BrowserPage> {
    const page = await client.newPage()
    pages.push(page)
    const pw = page.playwrightPage
    await pw.route(/^http:\/\/(tabwalk|other)\.test\//, (route) => {
      const url = new URL(route.request().url())
      const body = routes[url.host + url.pathname]
      return body === undefined
        ? route.fulfill({ status: 404, body: '' })
        : route.fulfill({ contentType: 'text/html', body })
    })
    await pw.goto(`http://tabwalk.test${path}`, { waitUntil: 'load' })
    return page
  }

  // Wraps the next CDP session the walk opens so a test can stub it before the walk uses it.
  function interceptNextSession(pw: Page, arm: (session: CDPSession) => void): CDPSession[] {
    const context = pw.context()
    const create = context.newCDPSession.bind(context)
    const opened: CDPSession[] = []
    vi.spyOn(context, 'newCDPSession').mockImplementationOnce(async (target) => {
      const session = await create(target)
      arm(session)
      opened.push(session)
      return session
    })
    return opened
  }

  // Resolves backendNodeIds through a fresh CDP session, independently of the walk's own reads, and
  // returns each node's id attribute: proves a deep id names that element in its own frame or root.
  async function resolveIds(pw: Page, backendNodeIds: (number | null)[]): Promise<(string | null)[]> {
    const session = await pw.context().newCDPSession(pw)
    try {
      await session.send('DOM.getDocument', { depth: 0 })
      const out: (string | null)[] = []
      for (const backendNodeId of backendNodeIds) {
        if (backendNodeId === null) {
          out.push(null)
          continue
        }
        const { object } = await session.send('DOM.resolveNode', {
          backendNodeId,
        })
        const res = await session.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: 'function () { return this.id || null }',
          returnByValue: true,
        })
        out.push(res.result.value as string | null)
      }
      return out
    } finally {
      await session.detach()
    }
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

  it('detaches the CDP session when setup throws', async () => {
    const page = await open(FIXTURE_A)
    const pw = page.playwrightPage
    const spies: { detach?: MockInstance<CDPSession['detach']> } = {}
    const opened = interceptNextSession(pw, (session) => {
      vi.spyOn(session, 'send').mockRejectedValueOnce(new Error('setup boom'))
      spies.detach = vi.spyOn(session, 'detach')
    })

    await expect(runTabWalk(pw, { settleMs: FAST })).rejects.toThrow('setup boom')

    expect(opened).toHaveLength(1)
    expect(spies.detach).toHaveBeenCalledTimes(1)
    await expect(opened[0].send('Runtime.evaluate', { expression: '1' })).rejects.toThrow()
  })

  it('records the error and still detaches when the page closes mid-walk', async () => {
    const page = await open(FIXTURE_A)
    const pw = page.playwrightPage
    const spies: { detach?: MockInstance<CDPSession['detach']> } = {}
    interceptNextSession(pw, (session) => {
      spies.detach = vi.spyOn(session, 'detach')
    })
    const press = pw.keyboard.press.bind(pw.keyboard)
    let count = 0
    vi.spyOn(pw.keyboard, 'press').mockImplementation(async (key, options) => {
      count++
      return count === 3 ? pw.close() : press(key, options)
    })

    const result = await runTabWalk(pw, { settleMs: FAST })

    expect(result.steps).toHaveLength(2)
    expect(result.error).toMatchObject({ phase: 'walk', index: 3 })
    expect(result.suspectedTrap).toBeNull()
    expect(spies.detach).toHaveBeenCalledTimes(1)
  })

  it('open shadow root: F counts shadow links, the walk wraps, deep reads name each link', async () => {
    const page = await open(SHADOW_20)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(() => TabWalkResultSchema.parse(result)).not.toThrow()
    expect(result.focusableCount).toBe(21)
    expect(result.fIncomplete).toBe(false)
    expect(result.presses).toBe(115)
    expect(result.steps.filter((s) => s.wrapped).map((s) => s.index)).toEqual([22, 44, 66, 88, 110])
    expect(result.suspectedTrap).toBe(false)
    expect(result.escapeProbe).toBeNull()

    const cycle = result.steps.slice(0, 22).map((s) => s.settled)
    expect(cycle.map(deepLabel)).toEqual(['light', ...ids('s', 20), 'body!'])
    expectBehindOneContainer(cycle.slice(1, 21), 'shadow-host')
    expect(await resolveIds(page.playwrightPage, cycle.slice(1, 21).map(focusIdentity))).toEqual(ids('s', 20))
    expect(cycle[0]).toMatchObject({ container: null, deepUnavailable: null })
    expect(cycle[0].deep?.backendNodeId).toBe(cycle[0].backendNodeId)
  })

  it('same-origin frame: F counts frame links, the walk wraps, deep reads name each link', async () => {
    const page = await open(FRAME_20)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(21)
    expect(result.fIncomplete).toBe(false)
    expect(result.presses).toBe(115)
    expect(result.steps.filter((s) => s.wrapped).map((s) => s.index)).toEqual([22, 44, 66, 88, 110])
    expect(result.suspectedTrap).toBe(false)

    const cycle = result.steps.slice(0, 22).map((s) => s.settled)
    expect(cycle.map(deepLabel)).toEqual(['light', ...ids('f', 20), 'body!'])
    expectBehindOneContainer(cycle.slice(1, 21), 'iframe')
    expect(await resolveIds(page.playwrightPage, cycle.slice(1, 21).map(focusIdentity))).toEqual(ids('f', 20))
  })

  it('modal inside a shadow root: Escape to the opener in the same root counts as an unseen element', async () => {
    const page = await open(SHADOW_MODAL)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(4)
    expect(deepLabel(result.initial)).toBe('ok')
    expect(new Set(result.steps.map((s) => deepLabel(s.settled)))).toEqual(new Set(['ok', 'cancel']))
    expect(result.suspectedTrap).toBe(true)

    const probe = result.escapeProbe
    expect(probe).not.toBeNull()
    if (!probe) return
    expect(await resolveIds(page.playwrightPage, probe.seenBackendNodeIds)).toEqual(
      expect.arrayContaining(['ok', 'cancel']),
    )
    expect(probe.seenBackendNodeIds).toHaveLength(2)
    expect(probe.escape.after.backendNodeId).toBe(probe.before.backendNodeId)
    expect(deepLabel(probe.escape.after)).toBe('open')
    expect(probe.escape.unseenElement).toBe(true)
    expect(label(probe.steps[0].settled)).toBe('light')
    expect(probe.reachedAt).toBe(1)
  })

  it('Tab-swallowing input inside a shadow root: still a suspected trap, escape probe finds no exit', async () => {
    const page = await open(SHADOW_TRAP)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(4)
    expect(result.steps).toHaveLength(30)
    expect(result.steps.some((s) => s.wrapped)).toBe(false)
    expect(result.steps.slice(2).every((s) => s.settled.deep?.id === 'trap')).toBe(true)
    expect(result.suspectedTrap).toBe(true)

    const probe = result.escapeProbe
    expect(probe).not.toBeNull()
    if (!probe) return
    const trap = result.steps[29].settled
    expect(trap.container).toBe('shadow-host')
    expect(focusIdentity(trap)).not.toBe(trap.backendNodeId)
    expect(probe.seenBackendNodeIds).toEqual([focusIdentity(trap)])
    expect(probe.escape.unseenElement).toBe(false)
    expect(probe.escape.wrapped).toBe(false)
    expect(probe.maxPresses).toBe(6)
    expect(probe.steps).toHaveLength(6)
    expect(probe.steps.every((s) => s.settled.deep?.id === 'trap' && !s.unseenElement && !s.wrapped)).toBe(true)
    expect(probe.reachedAt).toBeNull()
  })

  it('nested containers: the deep read follows shadow root -> frame -> shadow root', async () => {
    const page = await serve(NESTED_ROUTES, '/nested.html')
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(3)
    expect(result.fIncomplete).toBe(false)
    const cycle = result.steps.slice(0, 4).map((s) => s.settled)
    expect(cycle.map(deepLabel)).toEqual(['s0', 'f0', 'n0', 'body!'])
    expectBehindOneContainer(cycle.slice(0, 3), 'shadow-host')
    expect(await resolveIds(page.playwrightPage, cycle.slice(0, 3).map(focusIdentity))).toEqual(['s0', 'f0', 'n0'])
    expect(result.suspectedTrap).toBe(false)
  })

  it('same-origin object: F counts its document, deep reads name each link behind the object', async () => {
    const page = await serve(OBJECT_ROUTES, '/object.html')
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(3)
    expect(result.fIncomplete).toBe(false)
    const cycle = result.steps.slice(0, 4).map((s) => s.settled)
    expect(cycle.map(deepLabel)).toEqual(['light', 'o0', 'o1', 'body!'])
    expectBehindOneContainer(cycle.slice(1, 3), 'object')
    expect(await resolveIds(page.playwrightPage, cycle.slice(1, 3).map(focusIdentity))).toEqual(['o0', 'o1'])
    expect(result.suspectedTrap).toBe(false)
  })

  it('cross-origin frame: container recorded, deep null with a reason, F flagged incomplete', async () => {
    const page = await serve(CROSS_ORIGIN_ROUTES, '/xo.html')
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(3)
    expect(result.fIncomplete).toBe(true)
    expect(result.fIncompleteCauses).toEqual({
      crossOriginFrames: 1,
      closedShadowRoots: 0,
    })
    const cycle = result.steps.slice(0, 5).map((s) => s.settled)
    expect(cycle.map(deepLabel)).toEqual(['light', 'xo', 'xo', 'after', 'body!'])
    for (const read of cycle.slice(1, 3)) {
      expect(read).toMatchObject({
        container: 'iframe',
        deep: null,
        deepUnavailable: 'cross-origin',
      })
      expect(focusIdentity(read)).toBe(read.backendNodeId)
    }
    expect(result.suspectedTrap).toBe(false)
  })

  it('closed shadow root: deep null with a reason, F flagged incomplete, hidden hosts ignored', async () => {
    const page = await open(CLOSED_SHADOW)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(1)
    expect(result.fIncomplete).toBe(true)
    expect(result.fIncompleteCauses).toEqual({
      crossOriginFrames: 0,
      closedShadowRoots: 1,
    })
    const cycle = result.steps.slice(0, 5).map((s) => s.settled)
    expect(cycle.map(deepLabel)).toEqual(['light', 'closed', 'closed', 'closed', 'body!'])
    for (const read of cycle.slice(1, 4)) {
      expect(read).toMatchObject({
        container: 'shadow-host',
        deep: null,
        deepUnavailable: 'closed-shadow-root',
      })
    }
    expect(result.suspectedTrap).toBe(false)
  })

  it('frame stops: an empty frame is one stop, a tabindex=-1 frame is skipped, a blur inside a frame is not focusLost', async () => {
    const page = await open(FRAME_STOPS)
    const result = await runTabWalk(page.playwrightPage, { settleMs: FAST })

    expect(result.focusableCount).toBe(4)
    expect(result.fIncomplete).toBe(false)
    const [light, empty, blurred, b1, wrap] = result.steps.slice(0, 5)
    expect(label(light.settled)).toBe('light')
    expect(empty.settled).toMatchObject({
      id: 'empty',
      container: 'iframe',
      deep: { tag: 'body', isBody: true },
    })
    expect(blurred.settled).toMatchObject({
      id: 'blur',
      container: 'iframe',
      deep: { tag: 'body', isBody: true },
    })
    expect([empty, blurred].every((s) => !s.focusLost && !s.wrapped)).toBe(true)
    expect(b1.settled.deep?.id).toBe('b1')
    expect(wrap.wrapped).toBe(true)
    expect(result.suspectedTrap).toBe(false)
  })

  it.each(['long', 'name', 'aria', 'class', 'id', 'zero', 'body'])(
    'legacy identity matches the tools.ts expression: %s',
    async (kase) => {
      const page = await open(LEGACY_CASES)
      const pw = page.playwrightPage
      if (kase !== 'body') await pw.evaluate(`document.querySelector('[data-case="${kase}"]').focus()`)
      const expected = await pw.evaluate<string>(TOOLS_TS_FOCUS_EXPR)

      const result = await runTabWalk(pw, {
        settleMs: 0,
        presses: 1,
        allowFewerPresses: true,
        escapeProbe: false,
      })

      expect(legacyIdentity(result.initial)).toBe(expected)
    },
  )

  it("records launch facts from the page's browser, or nulls when it has none", async () => {
    const page = await open(FIXTURE_A)
    const pw = page.playwrightPage
    const short = {
      settleMs: FAST,
      presses: 1,
      allowFewerPresses: true,
      escapeProbe: false,
    }

    const result = await runTabWalk(pw, short)
    expect(result.launchFacts.browserVersion).toBe(pw.context().browser()?.version())
    // BrowserClient launches headless, which Playwright serves with the headless-shell binary.
    expect(result.launchFacts.executableBasename).toMatch(/^chrome-headless-shell(\.exe)?$/)

    vi.spyOn(pw.context(), 'browser').mockReturnValue(null)
    const orphan = await runTabWalk(pw, short)
    expect(orphan.launchFacts).toEqual({
      browserVersion: null,
      executableBasename: null,
    })
  })
})
