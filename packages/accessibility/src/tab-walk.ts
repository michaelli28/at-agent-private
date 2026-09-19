import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import type { Browser, CDPSession, Page } from 'playwright'

// Scripted Tab walk: records where focus goes after each keypress. It marks facts
// (wrapped, focusLost, suspectedTrap) but never issues a WCAG verdict.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'select',
  'textarea',
  'summary',
  '[contenteditable=true]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// Counts Tab stops page JS can see: light DOM, open shadow roots and same-origin frames. Headless
// shell gives a rendered frame with nothing focusable one stop and skips a tabindex=-1 frame with
// its content; a cross-origin frame counts as one stop (a lower bound) and is reported.
const COUNT_FOCUSABLE_FN = `function (selector, frameTags) {
  const rendered = (el) => el.getClientRects().length > 0
  let count = 0
  let crossOriginFrames = 0
  const visit = (root) => {
    for (const el of root.querySelectorAll(selector)) {
      if (!el.matches(':disabled') && rendered(el)) count++
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) visit(el.shadowRoot)
      if (!frameTags.includes(el.localName) || el.tabIndex < 0 || !rendered(el)) continue
      if (el.contentDocument) {
        const before = count
        visit(el.contentDocument)
        if (count === before) count++
      } else if (el.contentWindow) {
        crossOriginFrames++
        count++
      }
    }
  }
  visit(document)
  return { count, crossOriginFrames }
}`

// A per-walk token on window; if it is missing after a press, the document was replaced.
const MARKER_KEY = '__atAgentTabWalk'
const OBJECT_GROUP = 'at-agent-tab-walk'
// A navigation can destroy the execution context mid-read; a retry lands in the new document.
const READ_ATTEMPTS = 3
const READ_RETRY_MS = 50

// Runs in the page with `this` = document.activeElement (or no element). The raw fields
// mirror packages/agent/src/tools.ts executeTab so the legacy identity string can be rebuilt.
// container misses closed shadow hosts; the caller adds those from DOM.describeNode.
const READ_FOCUS_FN = `function (markerKey, token, withStyle, frameTags) {
  const el = this && this.nodeType === 1 ? this : null
  const name = el ? el.name : undefined
  const style = el && withStyle ? getComputedStyle(el) : null
  return {
    tag: el ? el.tagName.toLowerCase() : null,
    id: el && el.id ? el.id : null,
    className: el && typeof el.className === 'string' ? el.className : null,
    ariaLabel: el ? el.getAttribute('aria-label') : null,
    nameAttr: el ? el.getAttribute('name') : null,
    nameProp: name ? String(name) : null,
    text: el ? (el.textContent || '').slice(0, 30) : null,
    isBody: el !== null && el === document.body,
    hasFocus: document.hasFocus(),
    url: location.href,
    container: !el ? null : el.shadowRoot ? 'shadow-host' : frameTags.includes(el.localName) ? el.localName : null,
    markerPresent: window[markerKey] === token,
    focusStyle: style ? {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
    } : null,
  }
}`

// Runs on the top-level active element; follows focus through open shadow roots and
// same-origin frames and returns the deepest focused element (itself when nothing is deeper).
const DEEP_FOCUS_FN = `function (frameTags) {
  let el = this
  for (;;) {
    const inner = el.shadowRoot
      ? el.shadowRoot.activeElement
      : frameTags.includes(el.localName) && el.contentDocument
        ? el.contentDocument.activeElement
        : null
    if (!inner) return el
    el = inner
  }
}`

const READ_DEEP_FN = `function (frameTags) {
  return {
    tag: this.tagName.toLowerCase(),
    id: this.id ? this.id : null,
    isBody: this === this.ownerDocument.body,
    crossOrigin: frameTags.includes(this.localName) && !this.contentDocument && !!this.contentWindow,
  }
}`

export const TabKeySchema = z.enum(['Tab', 'Shift+Tab'])
export type TabKey = z.infer<typeof TabKeySchema>

export const TabWalkOptionsSchema = z.object({
  // Must be >= the default (5 full cycles) unless allowFewerPresses is set (tests only).
  presses: z.number().int().positive().optional(),
  allowFewerPresses: z.boolean().default(false),
  settleMs: z.number().int().nonnegative().default(150),
  direction: z.enum(['forward', 'backward']).default('forward'),
  escapeProbe: z.boolean().default(true),
})
export type TabWalkOptions = z.input<typeof TabWalkOptionsSchema>

export const FocusContainerSchema = z.enum(['shadow-host', 'iframe', 'frame', 'object', 'embed'])
export type FocusContainer = z.infer<typeof FocusContainerSchema>
// Elements that can host a nested document; their localNames double as container kinds.
const FRAME_TAGS = FocusContainerSchema.options.filter((kind) => kind !== 'shadow-host')

export const DeepFocusSchema = z.object({
  backendNodeId: z.number().int(),
  tag: z.string(),
  id: z.string().nullable(),
  // Body of its own document. Inside a frame that is the frame's own Tab stop (nothing focusable
  // in it, or focus dropped inside it), so it is neither a wrap nor focusLost.
  isBody: z.boolean(),
})
export type DeepFocus = z.infer<typeof DeepFocusSchema>

export const DeepUnavailableSchema = z.enum(['cross-origin', 'closed-shadow-root'])
export type DeepUnavailable = z.infer<typeof DeepUnavailableSchema>

export const FocusReadSchema = z.object({
  // Top-level fields: document.activeElement, as packages/agent/src/tools.ts sees it.
  backendNodeId: z.number().int().nullable(),
  tag: z.string().nullable(),
  id: z.string().nullable(),
  className: z.string().nullable(),
  ariaLabel: z.string().nullable(),
  nameAttr: z.string().nullable(),
  // el.name when truthy, else null (tools.ts skips a falsy name).
  nameProp: z.string().nullable(),
  // textContent.slice(0, 30), untrimmed (tools.ts trims after slicing).
  text: z.string().nullable(),
  isBody: z.boolean(),
  hasFocus: z.boolean(),
  url: z.string(),
  // Kind of the top-level element when focus can sit inside it.
  container: FocusContainerSchema.nullable(),
  // Deepest focused element through open shadow roots and same-origin frames; the top-level
  // element itself when it is not a container. Null when nothing is focused, or when focus is
  // behind a boundary page JS cannot cross (deepUnavailable says which).
  deep: DeepFocusSchema.nullable(),
  deepUnavailable: DeepUnavailableSchema.nullable(),
})
export type FocusRead = z.infer<typeof FocusReadSchema>

export const FocusStyleSchema = z.object({
  outlineStyle: z.string(),
  outlineWidth: z.string(),
  outlineColor: z.string(),
  boxShadow: z.string(),
})
export type FocusStyle = z.infer<typeof FocusStyleSchema>

export const TabWalkStepSchema = z.object({
  index: z.number().int().positive(),
  key: TabKeySchema,
  immediate: FocusReadSchema,
  settled: FocusReadSchema,
  // Computed style of the settled top-level element; null when there is no active element.
  focusStyle: FocusStyleSchema.nullable(),
  documentReplaced: z.boolean(),
  wrapped: z.boolean(),
  focusLost: z.boolean(),
})
export type TabWalkStep = z.infer<typeof TabWalkStepSchema>

export const EscapeProbeStepSchema = z.object({
  index: z.number().int().positive(),
  key: TabKeySchema,
  settled: FocusReadSchema,
  documentReplaced: z.boolean(),
  unseenElement: z.boolean(),
  wrapped: z.boolean(),
})
export type EscapeProbeStep = z.infer<typeof EscapeProbeStepSchema>

export const EscapeProbeSchema = z.object({
  // Opposite of the walk key: Shift+Tab after a forward walk, Tab after a backward one.
  probeKey: TabKeySchema,
  // focusIdentity of the last F+1 walk steps; "unseen" is relative to these.
  seenBackendNodeIds: z.array(z.number().int()),
  before: FocusReadSchema,
  escape: z.object({
    after: FocusReadSchema,
    documentReplaced: z.boolean(),
    urlChanged: z.boolean(),
    unseenElement: z.boolean(),
    wrapped: z.boolean(),
  }),
  maxPresses: z.number().int().positive(),
  steps: z.array(EscapeProbeStepSchema),
  // Probe press that first reached an unseen element or a wrapped state; null if none did.
  reachedAt: z.number().int().positive().nullable(),
})
export type EscapeProbe = z.infer<typeof EscapeProbeSchema>

export const TabWalkErrorSchema = z.object({
  phase: z.enum(['walk', 'escapeProbe']),
  // Press being attempted: walk 1..presses; escape probe 0 = Escape, 1..maxPresses after it.
  index: z.number().int().nonnegative(),
  message: z.string(),
})
export type TabWalkError = z.infer<typeof TabWalkErrorSchema>

export const LaunchFactsSchema = z.object({
  browserVersion: z.string().nullable(),
  // Basename of the browser process's argv[0], e.g. chrome-headless-shell; null when unknown.
  executableBasename: z.string().nullable(),
})
export type LaunchFacts = z.infer<typeof LaunchFactsSchema>

export const TabWalkResultSchema = z.object({
  direction: z.enum(['forward', 'backward']),
  // F: light DOM + open shadow roots + same-origin frames (see COUNT_FOCUSABLE_FN).
  focusableCount: z.number().int().nonnegative(),
  // A rendered cross-origin frame or closed shadow root may hide stops that F does not count.
  fIncomplete: z.boolean(),
  fIncompleteCauses: z.object({
    crossOriginFrames: z.number().int().nonnegative(),
    closedShadowRoots: z.number().int().nonnegative(),
  }),
  defaultPresses: z.number().int().positive(),
  presses: z.number().int().positive(),
  settleMs: z.number().int().nonnegative(),
  launchFacts: LaunchFactsSchema,
  initial: FocusReadSchema,
  steps: z.array(TabWalkStepSchema),
  // No wrapped marker in the whole walk; null when the walk stopped on an error.
  suspectedTrap: z.boolean().nullable(),
  escapeProbe: EscapeProbeSchema.nullable(),
  error: TabWalkErrorSchema.nullable(),
})
export type TabWalkResult = z.infer<typeof TabWalkResultSchema>

const RawReadSchema = FocusReadSchema.omit({
  backendNodeId: true,
  deep: true,
  deepUnavailable: true,
}).extend({
  markerPresent: z.boolean(),
  focusStyle: FocusStyleSchema.nullable(),
})
const DeepFieldsSchema = DeepFocusSchema.omit({ backendNodeId: true }).extend({
  crossOrigin: z.boolean(),
})
const InPageCountSchema = z.object({
  count: z.number().int().nonnegative(),
  crossOriginFrames: z.number().int().nonnegative(),
})

type WalkContext = {
  page: Page
  session: CDPSession
  token: string
  settleMs: number
}
type RawRead = {
  read: FocusRead
  focusStyle: FocusStyle | null
  markerPresent: boolean
}
type DeepPart = Pick<FocusRead, 'deep' | 'deepUnavailable'>
type FocusableCount = z.infer<typeof InPageCountSchema> & {
  closedShadowRoots: number
}
type EvalResult = {
  result: { value?: unknown }
  exceptionDetails?: { text: string }
}

export async function runTabWalk(page: Page, options: TabWalkOptions = {}): Promise<TabWalkResult> {
  const opts = TabWalkOptionsSchema.parse(options)
  const key: TabKey = opts.direction === 'forward' ? 'Tab' : 'Shift+Tab'
  const session = await page.context().newCDPSession(page)
  try {
    const launchFacts = await readLaunchFacts(page)
    const counted = await countFocusables(session)
    // Shallow re-request after the pierced one: the DOM agent then tracks only the root, so the
    // walk does not receive mutation events for the whole page.
    await session.send('DOM.getDocument', { depth: 0 })
    const focusableCount = counted.count
    const defaultPresses = 5 * (focusableCount + 1) + 5
    const presses = opts.presses ?? defaultPresses
    if (presses < defaultPresses && !opts.allowFewerPresses) {
      throw new Error(
        `presses ${presses} is below the default ${defaultPresses} for ${focusableCount} focusable elements; set allowFewerPresses to override`,
      )
    }

    const ctx: WalkContext = {
      page,
      session,
      token: randomUUID(),
      settleMs: opts.settleMs,
    }
    await injectMarker(ctx)
    const initial = (await readFocus(ctx, false)).read

    const steps: TabWalkStep[] = []
    let error: TabWalkError | null = null
    let index = 1
    try {
      for (; index <= presses; index++) {
        const r = await pressAndRead(ctx, key)
        const previous = steps.at(-1)?.settled
        steps.push({
          index,
          key,
          immediate: r.immediate,
          settled: r.settled,
          focusStyle: r.focusStyle,
          documentReplaced: r.documentReplaced,
          wrapped: isWrapped(r.settled),
          focusLost: r.settled.isBody && r.settled.hasFocus && previous !== undefined && isRealElement(previous),
        })
      }
    } catch (err) {
      error = { phase: 'walk', index, message: errorMessage(err) }
    }

    const suspectedTrap = error ? null : !steps.some((s) => s.wrapped)
    let escapeProbe: EscapeProbe | null = null
    if (suspectedTrap && opts.escapeProbe) {
      const probed = await runEscapeProbe(ctx, key, focusableCount, steps)
      escapeProbe = probed.probe
      error = probed.error
    }

    return TabWalkResultSchema.parse({
      direction: opts.direction,
      focusableCount,
      fIncomplete: counted.crossOriginFrames + counted.closedShadowRoots > 0,
      fIncompleteCauses: {
        crossOriginFrames: counted.crossOriginFrames,
        closedShadowRoots: counted.closedShadowRoots,
      },
      defaultPresses,
      presses,
      settleMs: opts.settleMs,
      launchFacts,
      initial,
      steps,
      suspectedTrap,
      escapeProbe,
      error,
    })
  } finally {
    // Detach fails if the page already closed; that must not mask the walk's own error.
    await session.detach().catch(() => undefined)
  }
}

// The element focus is really on: the deep element when resolved, else the top-level one.
export function focusIdentity(read: FocusRead): number | null {
  return read.deep?.backendNodeId ?? read.backendNodeId
}

async function runEscapeProbe(
  ctx: WalkContext,
  walkKey: TabKey,
  focusableCount: number,
  walkSteps: TabWalkStep[],
): Promise<{ probe: EscapeProbe | null; error: TabWalkError | null }> {
  const probeKey: TabKey = walkKey === 'Tab' ? 'Shift+Tab' : 'Tab'
  const seen = [
    ...new Set(
      walkSteps
        .slice(-(focusableCount + 1))
        .map((s) => focusIdentity(s.settled))
        .filter((id): id is number => id !== null),
    ),
  ]
  const isUnseen = (read: FocusRead): boolean => {
    const id = focusIdentity(read)
    return isRealElement(read) && id !== null && !seen.includes(id)
  }
  const maxPresses = focusableCount + 2

  let index = 0
  try {
    const before = (await readFocus(ctx, false)).read
    const esc = await pressAndRead(ctx, 'Escape')
    const escape = {
      after: esc.settled,
      documentReplaced: esc.documentReplaced,
      urlChanged: esc.settled.url !== before.url,
      unseenElement: isUnseen(esc.settled),
      wrapped: isWrapped(esc.settled),
    }

    const steps: EscapeProbeStep[] = []
    let reachedAt: number | null = null
    for (index = 1; index <= maxPresses && reachedAt === null; index++) {
      const r = await pressAndRead(ctx, probeKey)
      const step = {
        index,
        key: probeKey,
        settled: r.settled,
        documentReplaced: r.documentReplaced,
        unseenElement: isUnseen(r.settled),
        wrapped: isWrapped(r.settled),
      }
      steps.push(step)
      if (step.unseenElement || step.wrapped) reachedAt = index
    }
    return {
      probe: {
        probeKey,
        seenBackendNodeIds: seen,
        before,
        escape,
        maxPresses,
        steps,
        reachedAt,
      },
      error: null,
    }
  } catch (err) {
    return {
      probe: null,
      error: { phase: 'escapeProbe', index, message: errorMessage(err) },
    }
  }
}

async function pressAndRead(
  ctx: WalkContext,
  key: string,
): Promise<{
  immediate: FocusRead
  settled: FocusRead
  focusStyle: FocusStyle | null
  documentReplaced: boolean
}> {
  await ctx.page.keyboard.press(key)
  const immediate = await readFocus(ctx, false)
  await sleep(ctx.settleMs)
  const settled = await readFocus(ctx, true)
  if (!settled.markerPresent) {
    await ctx.session.send('DOM.getDocument', { depth: 0 })
    await injectMarker(ctx)
  }
  return {
    immediate: immediate.read,
    settled: settled.read,
    focusStyle: settled.focusStyle,
    documentReplaced: !immediate.markerPresent || !settled.markerPresent,
  }
}

async function readFocus(ctx: WalkContext, withStyle: boolean): Promise<RawRead> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readFocusOnce(ctx, withStyle)
    } catch (err) {
      if (attempt >= READ_ATTEMPTS) throw err
      await sleep(READ_RETRY_MS)
    }
  }
}

async function readFocusOnce(ctx: WalkContext, withStyle: boolean): Promise<RawRead> {
  const { session } = ctx
  const args = [MARKER_KEY, ctx.token, withStyle, FRAME_TAGS]
  try {
    // Identity and fields come from the same element object, so a focus change between
    // CDP calls cannot pair one element's backendNodeId with another's fields.
    const active = await session.send('Runtime.evaluate', {
      expression: 'document.activeElement',
      objectGroup: OBJECT_GROUP,
    })
    const objectId = active.result.objectId
    if (!objectId) {
      const value = unwrap(
        await session.send('Runtime.evaluate', {
          expression: `(${READ_FOCUS_FN}).apply(null, ${JSON.stringify(args)})`,
          returnByValue: true,
        }),
      )
      return toRawRead(RawReadSchema.parse(value), null, {
        deep: null,
        deepUnavailable: null,
      })
    }
    const node = (await session.send('DOM.describeNode', { objectId })).node
    const value = unwrap(
      await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: READ_FOCUS_FN,
        arguments: args.map((arg) => ({ value: arg })),
        returnByValue: true,
      }),
    )
    const raw = RawReadSchema.parse(value)
    const top = {
      ...raw,
      container: raw.container ?? (hasClosedShadowRoot(node) ? 'shadow-host' : null),
    }
    const deepPart = top.container === null ? topAsDeep(node.backendNodeId, top) : await readDeep(session, objectId)
    return toRawRead(top, node.backendNodeId, deepPart)
  } finally {
    await session.send('Runtime.releaseObjectGroup', {
      objectGroup: OBJECT_GROUP,
    })
  }
}

// Not a container: the top-level element is the deepest focused element.
function topAsDeep(backendNodeId: number, top: Pick<FocusRead, 'tag' | 'id' | 'isBody'>): DeepPart {
  const deep = top.tag === null ? null : { backendNodeId, tag: top.tag, id: top.id, isBody: top.isBody }
  return { deep, deepUnavailable: null }
}

// The deep element's fields and backendNodeId come from one handle, like the top-level read.
async function readDeep(session: CDPSession, topObjectId: string): Promise<DeepPart> {
  const frameTags = [{ value: FRAME_TAGS }]
  const handle = await session.send('Runtime.callFunctionOn', {
    objectId: topObjectId,
    functionDeclaration: DEEP_FOCUS_FN,
    arguments: frameTags,
    objectGroup: OBJECT_GROUP,
  })
  unwrap(handle)
  const objectId = handle.result.objectId
  if (!objectId) throw new Error('deep focus lookup returned no element')
  const fields = DeepFieldsSchema.parse(
    unwrap(
      await session.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: READ_DEEP_FN,
        arguments: frameTags,
        returnByValue: true,
      }),
    ),
  )
  if (fields.crossOrigin) return { deep: null, deepUnavailable: 'cross-origin' }
  const node = (await session.send('DOM.describeNode', { objectId })).node
  if (hasClosedShadowRoot(node)) return { deep: null, deepUnavailable: 'closed-shadow-root' }
  return {
    deep: {
      backendNodeId: node.backendNodeId,
      tag: fields.tag,
      id: fields.id,
      isBody: fields.isBody,
    },
    deepUnavailable: null,
  }
}

function toRawRead(raw: z.infer<typeof RawReadSchema>, backendNodeId: number | null, deepPart: DeepPart): RawRead {
  const { markerPresent, focusStyle, ...fields } = raw
  return {
    read: { backendNodeId, ...fields, ...deepPart },
    focusStyle,
    markerPresent,
  }
}

async function countFocusables(session: CDPSession): Promise<FocusableCount> {
  const inPage = InPageCountSchema.parse(
    unwrap(
      await session.send('Runtime.evaluate', {
        expression: `(${COUNT_FOCUSABLE_FN})(${JSON.stringify(FOCUSABLE_SELECTOR)}, ${JSON.stringify(FRAME_TAGS)})`,
        returnByValue: true,
      }),
    ),
  )
  return {
    ...inPage,
    closedShadowRoots: await countClosedShadowRoots(session),
  }
}

// Page JS cannot see closed shadow roots; a pierced DOM tree can. Hidden hosts hold no stops.
async function countClosedShadowRoots(session: CDPSession): Promise<number> {
  const { root } = await session.send('DOM.getDocument', {
    depth: -1,
    pierce: true,
  })
  const hosts: number[] = []
  const stack = [root]
  for (let node = stack.pop(); node; node = stack.pop()) {
    for (const shadow of node.shadowRoots ?? []) {
      if (shadow.shadowRootType === 'closed') hosts.push(node.backendNodeId)
      stack.push(shadow)
    }
    for (const child of node.children ?? []) stack.push(child)
    if (node.contentDocument) stack.push(node.contentDocument)
  }
  let rendered = 0
  try {
    for (const backendNodeId of hosts) {
      const { object } = await session.send('DOM.resolveNode', {
        backendNodeId,
        objectGroup: OBJECT_GROUP,
      })
      if (!object.objectId) continue
      const visible = unwrap(
        await session.send('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: 'function () { return this.getClientRects().length > 0 }',
          returnByValue: true,
        }),
      )
      if (visible === true) rendered++
    }
  } finally {
    await session.send('Runtime.releaseObjectGroup', {
      objectGroup: OBJECT_GROUP,
    })
  }
  return rendered
}

async function readLaunchFacts(page: Page): Promise<LaunchFacts> {
  const browser = page.context().browser()
  if (!browser) return { browserVersion: null, executableBasename: null }
  return {
    browserVersion: browser.version(),
    executableBasename: await readExecutableBasename(browser),
  }
}

// browserType().executablePath() names full Chromium even when Playwright launched the headless
// shell, so ask the browser process for its own argv[0].
async function readExecutableBasename(browser: Browser): Promise<string | null> {
  let session: CDPSession | undefined
  try {
    session = await browser.newBrowserCDPSession()
    const { arguments: argv } = await session.send('Browser.getBrowserCommandLine')
    return argv[0] ? basename(argv[0]) : null
  } catch {
    // Non-Chromium, or a browser started without --enable-automation: unknown, recorded as null.
    return null
  } finally {
    await session?.detach().catch(() => undefined)
  }
}

async function injectMarker(ctx: WalkContext): Promise<void> {
  unwrap(
    await ctx.session.send('Runtime.evaluate', {
      expression: `window[${JSON.stringify(MARKER_KEY)}] = ${JSON.stringify(ctx.token)}`,
    }),
  )
}

function unwrap(res: EvalResult): unknown {
  if (res.exceptionDetails) throw new Error(`in-page evaluation failed: ${res.exceptionDetails.text}`)
  return res.result.value
}

// Wrap and focusLost are states of the top document's body, which is never a container, so the
// deep read cannot change them; a frame's own body is a Tab stop (see DeepFocusSchema.isBody).
function isWrapped(read: FocusRead): boolean {
  return read.isBody && !read.hasFocus
}

function isRealElement(read: FocusRead): boolean {
  return read.tag !== null && !read.isBody
}

// DOM.describeNode lists an element's shadow root even when it is closed.
function hasClosedShadowRoot(node: { shadowRoots?: { shadowRootType?: string }[] }): boolean {
  return node.shadowRoots?.some((root) => root.shadowRootType === 'closed') ?? false
}

function errorMessage(err: unknown): string {
  // Playwright appends a multi-line call log; the first line carries the cause.
  return (err instanceof Error ? err.message : String(err)).split('\n')[0]
}
