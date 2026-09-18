import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import type { CDPSession, Page } from 'playwright'

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

const COUNT_FOCUSABLE_EXPR = `Array.from(document.querySelectorAll(${JSON.stringify(FOCUSABLE_SELECTOR)}))
  .filter((el) => !el.matches(':disabled') && el.getClientRects().length > 0).length`

// A per-walk token on window; if it is missing after a press, the document was replaced.
const MARKER_KEY = '__atAgentTabWalk'
const OBJECT_GROUP = 'at-agent-tab-walk'
// A navigation can destroy the execution context mid-read; a retry lands in the new document.
const READ_ATTEMPTS = 3
const READ_RETRY_MS = 50

// Runs in the page with `this` = document.activeElement (or no element). The raw fields
// mirror packages/agent/src/tools.ts executeTab so the legacy identity string can be rebuilt.
const READ_FOCUS_FN = `function (markerKey, token, withStyle) {
  const el = this && this.nodeType === 1 ? this : null
  const name = el ? el.name : undefined
  const style = el && withStyle ? getComputedStyle(el) : null
  return {
    tag: el ? el.tagName.toLowerCase() : null,
    id: el && el.id ? el.id : null,
    className: el && typeof el.className === 'string' ? el.className : null,
    ariaLabel: el ? el.getAttribute('aria-label') : null,
    nameAttr: el ? el.getAttribute('name') : null,
    nameProp: name == null ? null : String(name),
    text: el ? (el.textContent || '').slice(0, 30) : null,
    isBody: el !== null && el === document.body,
    hasFocus: document.hasFocus(),
    url: location.href,
    markerPresent: window[markerKey] === token,
    focusStyle: style ? {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
    } : null,
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

export const FocusReadSchema = z.object({
  backendNodeId: z.number().int().nullable(),
  tag: z.string().nullable(),
  id: z.string().nullable(),
  className: z.string().nullable(),
  ariaLabel: z.string().nullable(),
  nameAttr: z.string().nullable(),
  nameProp: z.string().nullable(),
  // textContent.slice(0, 30), untrimmed (tools.ts trims after slicing).
  text: z.string().nullable(),
  isBody: z.boolean(),
  hasFocus: z.boolean(),
  url: z.string(),
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
  // Computed style of the settled element; null when there is no active element.
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
  // Settled backendNodeIds of the last F+1 walk steps; "unseen" is relative to these.
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

export const TabWalkResultSchema = z.object({
  direction: z.enum(['forward', 'backward']),
  focusableCount: z.number().int().nonnegative(),
  defaultPresses: z.number().int().positive(),
  presses: z.number().int().positive(),
  settleMs: z.number().int().nonnegative(),
  initial: FocusReadSchema,
  steps: z.array(TabWalkStepSchema),
  // No wrapped marker in the whole walk; null when the walk stopped on an error.
  suspectedTrap: z.boolean().nullable(),
  escapeProbe: EscapeProbeSchema.nullable(),
  error: TabWalkErrorSchema.nullable(),
})
export type TabWalkResult = z.infer<typeof TabWalkResultSchema>

const RawReadSchema = FocusReadSchema.omit({ backendNodeId: true }).extend({
  markerPresent: z.boolean(),
  focusStyle: FocusStyleSchema.nullable(),
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
type EvalResult = {
  result: { value?: unknown }
  exceptionDetails?: { text: string }
}

export async function runTabWalk(page: Page, options: TabWalkOptions = {}): Promise<TabWalkResult> {
  const opts = TabWalkOptionsSchema.parse(options)
  const key: TabKey = opts.direction === 'forward' ? 'Tab' : 'Shift+Tab'
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('DOM.getDocument', { depth: 0 })
    const focusableCount = z
      .number()
      .int()
      .nonnegative()
      .parse(
        unwrap(
          await session.send('Runtime.evaluate', {
            expression: COUNT_FOCUSABLE_EXPR,
            returnByValue: true,
          }),
        ),
      )
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
      defaultPresses,
      presses,
      settleMs: opts.settleMs,
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
        .map((s) => s.settled.backendNodeId)
        .filter((id): id is number => id !== null),
    ),
  ]
  const isUnseen = (read: FocusRead): boolean =>
    isRealElement(read) && read.backendNodeId !== null && !seen.includes(read.backendNodeId)
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
  const args = [MARKER_KEY, ctx.token, withStyle]
  try {
    // Identity and fields come from the same element object, so a focus change between
    // CDP calls cannot pair one element's backendNodeId with another's fields.
    const active = await session.send('Runtime.evaluate', {
      expression: 'document.activeElement',
      objectGroup: OBJECT_GROUP,
    })
    const objectId = active.result.objectId
    let backendNodeId: number | null = null
    let value: unknown
    if (objectId) {
      backendNodeId = (await session.send('DOM.describeNode', { objectId })).node.backendNodeId
      value = unwrap(
        await session.send('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: READ_FOCUS_FN,
          arguments: args.map((arg) => ({ value: arg })),
          returnByValue: true,
        }),
      )
    } else {
      value = unwrap(
        await session.send('Runtime.evaluate', {
          expression: `(${READ_FOCUS_FN}).apply(null, ${JSON.stringify(args)})`,
          returnByValue: true,
        }),
      )
    }
    const { markerPresent, focusStyle, ...fields } = RawReadSchema.parse(value)
    return { read: { backendNodeId, ...fields }, focusStyle, markerPresent }
  } finally {
    await session.send('Runtime.releaseObjectGroup', {
      objectGroup: OBJECT_GROUP,
    })
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

function isWrapped(read: FocusRead): boolean {
  return read.isBody && !read.hasFocus
}

function isRealElement(read: FocusRead): boolean {
  return read.tag !== null && !read.isBody
}

function errorMessage(err: unknown): string {
  // Playwright appends a multi-line call log; the first line carries the cause.
  return (err instanceof Error ? err.message : String(err)).split('\n')[0]
}
