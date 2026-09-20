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
// Top window's store of focused-state snapshots, one per visit, until its unfocused reads are done.
const INDICATOR_STORE_KEY = '__atAgentTabWalkIndicator'
const OBJECT_GROUP = 'at-agent-tab-walk'
// A navigation can destroy the execution context mid-read; a retry lands in the new document.
const READ_ATTEMPTS = 3
const READ_RETRY_MS = 50

// Computed properties that draw nothing themselves (z-index only through overlap): never compared.
const NON_VISUAL_PROPERTIES = [
  '^(?:(?:transition|animation|caret|interest-delay|scroll|overscroll|view-timeline|view-transition|anchor|position-try|contain|container)(?:-.*)?',
  'cursor|will-change|pointer-events|touch-action|user-select|-webkit-user-drag|-webkit-user-modify',
  '-webkit-tap-highlight-color|z-index|resize|app-region|interactivity|reading-flow|reading-order|speak',
  'timeline-scope|position-anchor|interpolate-size|buffered-rendering|print-color-adjust|-webkit-locale)$',
].join('|')

const BORDER_SIDES = ['top', 'right', 'bottom', 'left', 'block-start', 'block-end', 'inline-start', 'inline-end']
export type LineGroup = { style: string; width: string; color: string }
// Outlines, border sides and column rules draw only when style, width and colour all allow it.
export const LINE_GROUPS: readonly LineGroup[] = [
  { style: 'outline-style', width: 'outline-width', color: 'outline-color' },
  ...BORDER_SIDES.map((side) => ({
    style: `border-${side}-style`,
    width: `border-${side}-width`,
    color: `border-${side}-color`,
  })),
  {
    style: 'column-rule-style',
    width: 'column-rule-width',
    color: 'column-rule-color',
  },
]
const lineProps = (group: LineGroup): string[] => [group.style, group.width, group.color]
// What a box paints on its own: whether a radius change or a generated box can be seen at all.
export const PAINT_PROPERTIES = [
  'background-color',
  'background-image',
  'box-shadow',
  ...LINE_GROUPS.slice(0, 5).flatMap(lineProps),
]
const TRANSFORM_PROPERTIES = ['transform', 'rotate', 'scale', 'translate']
// Changed property (regex source) -> unchanged properties recorded with it, so the checker can tell
// whether the change draws anything.
const STYLE_CONTEXT: [string, string[]][] = [
  ['^outline-', lineProps(LINE_GROUPS[0])],
  ...LINE_GROUPS.slice(1, -1).map((group): [string, string[]] => [
    `^${group.style.replace(/-style$/, '')}-(?:style|width|color)$`,
    lineProps(group),
  ]),
  ['^column-rule-', lineProps(LINE_GROUPS[LINE_GROUPS.length - 1])],
  ['-radius$|^corner-', PAINT_PROPERTIES],
  ['^text-decoration|^text-underline-', ['text-decoration-line']],
  ['^text-emphasis-', ['text-emphasis-style']],
  ['^-webkit-text-stroke-color$', ['-webkit-text-stroke-width']],
  ['^transform-origin$', TRANSFORM_PROPERTIES],
  ['^perspective-origin$', ['perspective']],
]

// Runs in the top window. The focused snapshot of a visit stays in the page (element references and
// every compared property of: the element, its ::before/::after, 3 ancestors, previous and next element
// siblings); only the properties that differ between reads come back.
const INDICATOR_API_FN = `function (cfg) {
  let store = window[cfg.storeKey]
  if (!store || store.token !== cfg.token) {
    const deny = new RegExp(cfg.deny)
    const names = Array.from(getComputedStyle(document.documentElement)).filter((n) => !n.startsWith('--') && !deny.test(n))
    const index = new Map(names.map((n, i) => [n, i]))
    const indices = (list) => list.map((n) => index.get(n)).filter((i) => i !== undefined)
    store = {
      token: cfg.token,
      names,
      rules: cfg.context.map(([source, extra]) => [new RegExp(source), indices(extra)]),
      presence: indices([...cfg.paint, 'content']),
      visits: new Map(),
    }
    Object.defineProperty(window, cfg.storeKey, { value: store, configurable: true, writable: true })
  }
  const names = store.names
  const up = (n) => n.parentElement || n.getRootNode().host || null
  const targetsOf = (el) => {
    const list = [['element', el, null], ['before', el, '::before'], ['after', el, '::after']]
    let a = up(el)
    for (const name of ['parent', 'grandparent', 'great-grandparent']) {
      if (!a) break
      list.push([name, a, null])
      a = up(a)
    }
    if (el.previousElementSibling) list.push(['previous-sibling', el.previousElementSibling, null])
    if (el.nextElementSibling) list.push(['next-sibling', el.nextElementSibling, null])
    return list
  }
  // A finished transition shows the style the element settles on, so a fade still running from the
  // previous press is not read as a change; keyframe animations keep running and show up as drift.
  const finish = (targets) => {
    for (const [, t, pseudo] of targets) {
      if (!t.isConnected) continue
      for (const a of t.getAnimations(pseudo ? { subtree: true } : undefined)) {
        const effect = a.effect
        if (a.transitionProperty === undefined || !effect || effect.target !== t) continue
        if ((effect.pseudoElement || null) !== pseudo) continue
        // finish() throws only for a zero playback rate; that transition is left to run.
        try { a.finish() } catch {}
      }
    }
  }
  const read = (targets) => targets.map(([, t, pseudo]) => {
    const view = t.isConnected ? t.ownerDocument.defaultView : null
    if (!view) return null
    const style = view.getComputedStyle(t, pseudo)
    if (pseudo && (style.content === 'none' || style.content === 'normal' || style.display === 'none')) return null
    return names.map((n) => style.getPropertyValue(n))
  })
  // An ancestor or sibling holding focus shows that focus, not the element's.
  const busy = (targets) => new Set(targets.flatMap(([, t], i) => (i >= 3 && t.isConnected && t.matches(':focus-within') ? [i] : [])))
  const pick = (values, keep) => Object.fromEntries([...keep].map((k) => [names[k], values[k]]))
  const changes = (targets, a, b, skip) => {
    const out = []
    targets.forEach(([name, , pseudo], i) => {
      const [fa, fb] = [a[i], b[i]]
      if (skip.has(i) || (fa === null && fb === null)) return
      if (fa === null || fb === null) {
        // A generated box in one state only; a context element gone in one state has nothing to compare.
        if (pseudo) out.push({ target: name, focused: fa && pick(fa, store.presence), unfocused: fb && pick(fb, store.presence) })
        return
      }
      const keep = new Set()
      for (let k = 0; k < names.length; k++) {
        if (fa[k] === fb[k]) continue
        keep.add(k)
        for (const [re, extra] of store.rules) if (re.test(names[k])) extra.forEach((x) => keep.add(x))
      }
      if (keep.size > 0) out.push({ target: name, focused: pick(fa, keep), unfocused: pick(fb, keep) })
    })
    return out
  }
  // wasBusy: left out of the unfocused read; nowBusy: holding focus now. A context element compared at the
  // unfocused read but holding focus now cannot be re-read unfocused: 'target:*' marks it unverified.
  const drift = (targets, a, b, wasBusy, nowBusy) => {
    const keys = []
    targets.forEach(([name, , pseudo], i) => {
      const [fa, fb] = [a[i], b[i]]
      if (wasBusy.has(i) || (fa === null && fb === null)) return
      if (nowBusy.has(i)) {
        keys.push(name + ':*')
        return
      }
      if (fa === null || fb === null) {
        if (pseudo) keys.push(name + ':content')
        return
      }
      for (let k = 0; k < names.length; k++) if (fa[k] !== fb[k]) keys.push(name + ':' + names[k])
    })
    return keys
  }
  // First read after focus has left the element's subtree: changes; the read one press later: drift.
  function processVisit(visit) {
    const entry = store.visits.get(visit)
    if (!entry) return { visit, kind: 'lost' }
    const el = entry.targets[0][1]
    const recheck = entry.unfocused !== null
    if (!el.isConnected || !el.ownerDocument.defaultView) {
      store.visits.delete(visit)
      return recheck ? { visit, kind: 'drift', drift: null } : { visit, kind: 'removed' }
    }
    if (el.matches(':focus-within')) {
      const refocused = el.matches(':focus')
      if (recheck || refocused) store.visits.delete(visit)
      if (recheck) return { visit, kind: 'drift', drift: null }
      return { visit, kind: refocused ? 'still-focused' : 'focus-inside' }
    }
    finish(entry.targets)
    const values = read(entry.targets)
    const skip = busy(entry.targets)
    if (!recheck) {
      entry.unfocused = values
      entry.skip = skip
      return { visit, kind: 'captured', changes: changes(entry.targets, entry.focused, values, skip) }
    }
    store.visits.delete(visit)
    return { visit, kind: 'drift', drift: drift(entry.targets, entry.unfocused, values, entry.skip, skip) }
  }
  return {
    focused(el, visit) {
      const targets = targetsOf(el)
      finish(targets)
      store.visits.set(visit, { targets, focused: read(targets), unfocused: null, skip: null })
    },
    // One visit's failure is reported for that visit only.
    process(ids, drop) {
      for (const id of drop) store.visits.delete(id)
      return ids.map((visit) => {
        try {
          return processVisit(visit)
        } catch (err) {
          store.visits.delete(visit)
          return { visit, kind: 'failed', error: String(err && err.message ? err.message : err) }
        }
      })
    },
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

// Runs in the page with `this` = document.activeElement (or no element). The raw fields
// mirror packages/agent/src/tools.ts executeTab so the legacy identity string can be rebuilt.
// container misses closed shadow hosts; the caller adds those from DOM.describeNode.
// indicator ({ ...config, visit } or null) snapshots the deep element's focused state for that visit.
const READ_FOCUS_FN = `function (markerKey, token, withStyle, frameTags, indicator) {
  const el = this && this.nodeType === 1 ? this : null
  const name = el ? el.name : undefined
  const style = el && withStyle ? getComputedStyle(el) : null
  // Read before the snapshot, which finishes running transitions.
  const focusStyle = style ? {
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    outlineColor: style.outlineColor,
    boxShadow: style.boxShadow,
  } : null
  // [stored, error]: a failing style read must not fail the focus read.
  const snapshot = () => {
    if (!el || !indicator || el === document.body) return [false, null]
    try {
      const deep = (${DEEP_FOCUS_FN}).call(el, frameTags)
      if (deep === deep.ownerDocument.body || (frameTags.includes(deep.localName) && !deep.contentDocument)) return [false, null]
      ;(${INDICATOR_API_FN})(indicator).focused(deep, indicator.visit)
      return [true, null]
    } catch (err) {
      return [false, String(err && err.message ? err.message : err)]
    }
  }
  const [snapshotted, snapshotError] = snapshot()
  return {
    tag: el ? el.tagName.toLowerCase() : null,
    id: el && el.id ? el.id : null,
    className: el && typeof el.className === 'string' ? el.className : null,
    classAttr: el ? el.getAttribute('class') : null,
    ariaLabel: el ? el.getAttribute('aria-label') : null,
    nameAttr: el ? el.getAttribute('name') : null,
    nameProp: name ? String(name) : null,
    text: el ? (el.textContent || '').slice(0, 30) : null,
    isBody: el !== null && el === document.body,
    hasFocus: document.hasFocus(),
    url: location.href,
    container: !el ? null : el.shadowRoot ? 'shadow-host' : frameTags.includes(el.localName) ? el.localName : null,
    markerPresent: window[markerKey] === token,
    focusStyle,
    snapshotted,
    snapshotError,
  }
}`

const READ_DEEP_FN = `function (frameTags) {
  return {
    tag: this.tagName.toLowerCase(),
    id: this.id ? this.id : null,
    classAttr: this.getAttribute('class'),
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
  // Raw class attribute (also set on SVG elements, unlike className); groups findings by component.
  // Defaulted: the walks recorded at cd3b122 predate this field and are the judges' test fixtures.
  classAttr: z.string().nullable().default(null),
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

// Where a style change was seen, relative to the focused element. Ancestors cross shadow roots to
// the host but not frames.
export const IndicatorTargetSchema = z.enum([
  'element',
  'before',
  'after',
  'parent',
  'grandparent',
  'great-grandparent',
  'previous-sibling',
  'next-sibling',
])
export type IndicatorTarget = z.infer<typeof IndicatorTargetSchema>

export const StyleChangeSchema = z.object({
  target: IndicatorTargetSchema,
  // Computed values (kebab-case keys) of the properties that differ, plus the unchanged ones needed to
  // tell whether they draw anything. Null: a ::before/::after with no box in that state.
  focused: z.record(z.string()).nullable(),
  unfocused: z.record(z.string()).nullable(),
})
export type StyleChange = z.infer<typeof StyleChangeSchema>

export const UnfocusedStatusSchema = z.enum([
  // Read at the first press after which neither the element nor anything inside it had focus.
  'captured',
  // Focus came back to the element, or stayed in it or its subtree until the walk ended.
  'still-focused',
  // Disconnected, or its frame gone, when read.
  'removed',
  // A press replaced the document, taking the element with it.
  'document-replaced',
  // The read failed; unfocusedError has the message.
  'read-failed',
  // No later press: the walk ended or stopped on an error.
  'not-read',
])
export type UnfocusedStatus = z.infer<typeof UnfocusedStatusSchema>

export const StepIndicatorSchema = z.object({
  unfocusedStatus: UnfocusedStatusSchema,
  // Press whose read decided unfocusedStatus; null while not-read.
  unfocusedAt: z.number().int().positive().nullable(),
  unfocusedError: z.string().nullable(),
  // Style differences between the settled read and the unfocused read; empty unless captured.
  // Non-visual properties are never compared, running CSS transitions are finished before each read,
  // and an ancestor or sibling holding focus at the unfocused read is left out.
  changes: z.array(StyleChangeSchema),
  // target:property keys that differ between the unfocused read and a second one on the next press
  // (focus still elsewhere): changes unrelated to focus. target:* when that ancestor or sibling holds
  // focus at the second read, so its changes cannot be checked. Null when no second read was taken.
  unfocusedDrift: z.array(z.string()).nullable(),
})
export type StepIndicator = z.infer<typeof StepIndicatorSchema>

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
  // Focus-indicator facts for the settled deep element; null when there is none to read (body,
  // nothing focused, or focus behind a cross-origin frame or closed shadow root).
  // Defaulted for the same reason as DeepFocusSchema.classAttr.
  indicator: StepIndicatorSchema.nullable().default(null),
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

export const IdleBaselineSchema = z.object({
  // Focus/URL state read before any keypress and again after one settle. A page that navigates or
  // replaces itself with no input cannot have its later context changes attributed to focus.
  after: FocusReadSchema,
  documentReplaced: z.boolean(),
  urlChanged: z.boolean(),
})
export type IdleBaseline = z.infer<typeof IdleBaselineSchema>

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
  // Defaulted so walks recorded before these fields existed still parse.
  idle: IdleBaselineSchema.nullable().default(null),
  // F re-counted after the last press. When it differs from focusableCount the page added or
  // removed tab stops during the walk, which makes every F-based verdict unsafe.
  focusableCountEnd: z.number().int().nonnegative().nullable().default(null),
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
  classAttr: z.string().nullable(),
  markerPresent: z.boolean(),
  focusStyle: FocusStyleSchema.nullable(),
  snapshotted: z.boolean(),
  snapshotError: z.string().nullable(),
})
const DeepFieldsSchema = DeepFocusSchema.omit({ backendNodeId: true }).extend({
  crossOrigin: z.boolean(),
})
const InPageCountSchema = z.object({
  count: z.number().int().nonnegative(),
  crossOriginFrames: z.number().int().nonnegative(),
})
const visitField = { visit: z.number().int().positive() }
const VisitOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    ...visitField,
    kind: z.literal('captured'),
    changes: z.array(StyleChangeSchema),
  }),
  z.object({
    ...visitField,
    kind: z.literal('drift'),
    drift: z.array(z.string()).nullable(),
  }),
  // The in-page read of this visit threw.
  z.object({ ...visitField, kind: z.literal('failed'), error: z.string() }),
  // Focus is still inside the element's subtree: the visit stays open.
  z.object({ ...visitField, kind: z.literal('focus-inside') }),
  z.object({
    ...visitField,
    kind: z.enum(['still-focused', 'removed', 'lost']),
  }),
])
type VisitOutcome = z.infer<typeof VisitOutcomeSchema>

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
  // The deep element's focused state was stored in the page for this read's visit.
  snapshotted: boolean
  // Why storing it threw; the focus read itself still succeeded.
  snapshotError: string | null
}
type DeepPart = Pick<FocusRead, 'deep' | 'deepUnavailable'>
type PressRead = {
  immediate: FocusRead
  settled: FocusRead
  focusStyle: FocusStyle | null
  documentReplaced: boolean
  snapshotted: boolean
  snapshotError: string | null
}
// A visit still waiting for its unfocused read, or for the drift read one press after it.
type OpenVisit = { drift: boolean; checkedAt: number | null }
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
    const initial = (await readFocus(ctx)).read

    // The causality control: a page that navigates or replaces itself with no keypress at all
    // cannot have its later context changes attributed to focus.
    const idle = await readIdleBaseline(ctx, initial)
    const walked = await walkPresses(ctx, key, presses, initial)
    const steps = walked.steps
    let error = walked.error
    const focusableCountEnd = await recountFocusables(session)

    const suspectedTrap = error ? null : !steps.some((s) => s.wrapped)
    // The probe is gated on the END of the walk, not the whole of it: a page that wrapped early and
    // then opened a trapping dialog is invisible to suspectedTrap, which gaps/keyboard.ts still reads.
    const tailWrapped = steps.slice(-(focusableCount + 1)).some((s) => s.wrapped)
    let escapeProbe: EscapeProbe | null = null
    if (!error && !tailWrapped && opts.escapeProbe) {
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
      idle,
      focusableCountEnd,
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

// The tab stop a read is on, for naming it in a finding. `deep` is already the top-level element
// unless focus sits inside a container; when focus is behind a boundary page JS cannot cross, the
// container itself is the most specific stop we can name.
export function focusStop(read: FocusRead): DeepFocus | null {
  if (read.deep !== null) return read.deep
  if (read.tag === null || read.isBody || read.backendNodeId === null) return null
  return { backendNodeId: read.backendNodeId, tag: read.tag, id: read.id, isBody: false, classAttr: read.className }
}

// Each press stores the settled element's focused style in the page as a visit; later presses read
// every open visit until focus has left the element's subtree (the unfocused read), then once more.
async function walkPresses(
  ctx: WalkContext,
  key: TabKey,
  presses: number,
  initial: FocusRead,
): Promise<{ steps: TabWalkStep[]; error: TabWalkError | null }> {
  const steps: TabWalkStep[] = []
  const open = new Map<number, OpenVisit>()
  let error: TabWalkError | null = null
  let index = 1
  // Walk-scoped: has focus been on a real element at any point in the current document? Reading the
  // previous step instead would make press 1 unable to lose focus and would miss a second drop in a row.
  let lastRealSeen = isRealElement(initial)
  try {
    for (; index <= presses; index++) {
      const r = await pressAndRead(ctx, key, index)
      // A closed shadow host is stored in the page too, but its deep element is unknown: dropped.
      const tried = r.snapshotted || r.snapshotError !== null
      const readable = tried && r.settled.deep !== null && !r.settled.deep.isBody
      const drop = r.snapshotted && !readable ? [index] : []
      if (open.size > 0 || drop.length > 0) {
        const outcomes = await processVisits(ctx, [...open.keys()], drop)
        applyOutcomes(steps, open, outcomes, {
          at: index,
          documentReplaced: r.documentReplaced,
        })
      }
      steps.push({
        index,
        key,
        immediate: r.immediate,
        settled: r.settled,
        focusStyle: r.focusStyle,
        documentReplaced: r.documentReplaced,
        wrapped: isWrapped(r.settled),
        focusLost: r.settled.isBody && r.settled.hasFocus && lastRealSeen,
        indicator: !readable
          ? null
          : r.snapshotError === null
            ? notRead()
            : {
                ...notRead(),
                unfocusedStatus: 'read-failed',
                unfocusedAt: index,
                unfocusedError: `focused read failed: ${r.snapshotError}`,
              },
      })
      // Updated only after the step is pushed, so each step is computed with the incoming value. A
      // replaced document re-mints every element, so what the old one showed says nothing about it.
      const sawReal = isRealElement(r.immediate) || isRealElement(r.settled)
      lastRealSeen = r.documentReplaced ? sawReal : lastRealSeen || sawReal
      if (readable && r.snapshotted) open.set(index, { drift: false, checkedAt: null })
    }
  } catch (err) {
    error = { phase: 'walk', index, message: errorMessage(err) }
  }
  // Focus never left these elements' subtrees after they were checked.
  for (const [visit, o] of open) {
    if (!o.drift && o.checkedAt !== null) {
      updateIndicator(steps, visit, {
        unfocusedStatus: 'still-focused',
        unfocusedAt: o.checkedAt,
      })
    }
  }
  // Best effort: the store holds element references; a closed page has already dropped it.
  await ctx.session
    .send('Runtime.evaluate', {
      expression: `delete window[${JSON.stringify(INDICATOR_STORE_KEY)}]`,
    })
    .catch(() => undefined)
  return { steps, error }
}

function notRead(): StepIndicator {
  return {
    unfocusedStatus: 'not-read',
    unfocusedAt: null,
    unfocusedError: null,
    changes: [],
    unfocusedDrift: null,
  }
}

async function processVisits(ctx: WalkContext, ids: number[], drop: number[]): Promise<VisitOutcome[]> {
  const expression = `(${INDICATOR_API_FN})(${JSON.stringify(indicatorConfig(ctx))}).process(${JSON.stringify(ids)}, ${JSON.stringify(drop)})`
  try {
    return await withRetry(async () =>
      z.array(VisitOutcomeSchema).parse(
        unwrap(
          await ctx.session.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
          }),
        ),
      ),
    )
  } catch (err) {
    return ids.map((visit) => ({
      visit,
      kind: 'failed' as const,
      error: errorMessage(err),
    }))
  }
}

function applyOutcomes(
  steps: TabWalkStep[],
  open: Map<number, OpenVisit>,
  outcomes: VisitOutcome[],
  press: { at: number; documentReplaced: boolean },
): void {
  const at = press.at
  for (const outcome of outcomes) {
    const { visit } = outcome
    const drift = open.get(visit)?.drift ?? false
    if (outcome.kind === 'focus-inside') {
      open.set(visit, { drift, checkedAt: at })
      continue
    }
    if (outcome.kind === 'captured') {
      open.set(visit, { drift: true, checkedAt: at })
      updateIndicator(steps, visit, {
        unfocusedStatus: 'captured',
        unfocusedAt: at,
        changes: outcome.changes,
      })
      continue
    }
    open.delete(visit)
    if (outcome.kind === 'drift') {
      updateIndicator(steps, visit, { unfocusedDrift: outcome.drift })
    } else if (!drift) {
      // A drift read that could not be taken just leaves unfocusedDrift null.
      updateIndicator(steps, visit, unfocusedEnd(outcome, press))
    }
  }
}

function unfocusedEnd(
  outcome: Extract<VisitOutcome, { kind: 'still-focused' | 'removed' | 'lost' | 'failed' }>,
  press: { at: number; documentReplaced: boolean },
): Partial<StepIndicator> {
  const at = press.at
  if (outcome.kind === 'still-focused' || outcome.kind === 'removed') {
    return { unfocusedStatus: outcome.kind, unfocusedAt: at }
  }
  // A replaced top document takes the store with it.
  if (press.documentReplaced) return { unfocusedStatus: 'document-replaced', unfocusedAt: at }
  return {
    unfocusedStatus: 'read-failed',
    unfocusedAt: at,
    unfocusedError: outcome.kind === 'failed' ? outcome.error : 'focused snapshot missing from the page',
  }
}

// Visits are press indices, and steps[i] is press i + 1.
function updateIndicator(steps: TabWalkStep[], visit: number, patch: Partial<StepIndicator>): void {
  const step = steps[visit - 1]
  if (!step?.indicator) return
  steps[visit - 1] = { ...step, indicator: { ...step.indicator, ...patch } }
}

function indicatorConfig(ctx: WalkContext) {
  return {
    storeKey: INDICATOR_STORE_KEY,
    token: ctx.token,
    deny: NON_VISUAL_PROPERTIES,
    context: STYLE_CONTEXT,
    paint: PAINT_PROPERTIES,
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
    const before = (await readFocus(ctx)).read
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

// One settle with no keypress in between: the control every focus-attributed finding is measured
// against. A page that navigates or replaces itself here did so on its own.
async function readIdleBaseline(ctx: WalkContext, initial: FocusRead): Promise<IdleBaseline> {
  await sleep(ctx.settleMs)
  const after = await readFocus(ctx)
  if (!after.markerPresent) {
    await ctx.session.send('DOM.getDocument', { depth: 0 })
    await injectMarker(ctx)
  }
  return {
    after: after.read,
    documentReplaced: !after.markerPresent,
    urlChanged: after.read.url !== initial.url,
  }
}

// visit: store the settled deep element's focused style under this press index.
async function pressAndRead(ctx: WalkContext, key: string, visit?: number): Promise<PressRead> {
  await ctx.page.keyboard.press(key)
  const immediate = await readFocus(ctx)
  await sleep(ctx.settleMs)
  const settled = await readFocus(ctx, { withStyle: true, visit })
  if (!settled.markerPresent) {
    await ctx.session.send('DOM.getDocument', { depth: 0 })
    await injectMarker(ctx)
  }
  return {
    immediate: immediate.read,
    settled: settled.read,
    focusStyle: settled.focusStyle,
    documentReplaced: !immediate.markerPresent || !settled.markerPresent,
    snapshotted: settled.snapshotted,
    snapshotError: settled.snapshotError,
  }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= READ_ATTEMPTS) throw err
      await sleep(READ_RETRY_MS)
    }
  }
}

function readFocus(ctx: WalkContext, opts: { withStyle?: boolean; visit?: number } = {}): Promise<RawRead> {
  return withRetry(() => readFocusOnce(ctx, opts.withStyle ?? false, opts.visit))
}

async function readFocusOnce(ctx: WalkContext, withStyle: boolean, visit: number | undefined): Promise<RawRead> {
  const { session } = ctx
  const indicator = visit === undefined ? null : { ...indicatorConfig(ctx), visit }
  const args = [MARKER_KEY, ctx.token, withStyle, FRAME_TAGS, indicator]
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
function topAsDeep(
  backendNodeId: number,
  top: Pick<FocusRead, 'tag' | 'id' | 'isBody'> & { classAttr: string | null },
): DeepPart {
  const deep =
    top.tag === null
      ? null
      : {
          backendNodeId,
          tag: top.tag,
          id: top.id,
          isBody: top.isBody,
          classAttr: top.classAttr,
        }
  return { deep, deepUnavailable: null }
}

// The deep element's fields and backendNodeId come from one handle, like the top-level read.
async function readDeep(session: CDPSession, topObjectId: string): Promise<DeepPart> {
  const handle = await session.send('Runtime.callFunctionOn', {
    objectId: topObjectId,
    functionDeclaration: DEEP_FOCUS_FN,
    arguments: [{ value: FRAME_TAGS }],
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
        arguments: [{ value: FRAME_TAGS }],
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
      classAttr: fields.classAttr,
    },
    deepUnavailable: null,
  }
}

function toRawRead(raw: z.infer<typeof RawReadSchema>, backendNodeId: number | null, part: DeepPart): RawRead {
  const { markerPresent, focusStyle, classAttr, snapshotted, snapshotError, ...fields } = raw
  return {
    read: { backendNodeId, ...fields, ...part },
    focusStyle,
    markerPresent,
    snapshotted,
    snapshotError,
  }
}

async function countFocusables(session: CDPSession): Promise<FocusableCount> {
  return {
    ...(await countFocusablesInPage(session)),
    closedShadowRoots: await countClosedShadowRoots(session),
  }
}

// The in-page half of the count on its own: what focusableCount is, and what the end-of-walk
// re-count must be, so the two numbers are only ever compared like with like.
async function countFocusablesInPage(session: CDPSession): Promise<z.infer<typeof InPageCountSchema>> {
  return InPageCountSchema.parse(
    unwrap(
      await session.send('Runtime.evaluate', {
        expression: `(${COUNT_FOCUSABLE_FN})(${JSON.stringify(FOCUSABLE_SELECTOR)}, ${JSON.stringify(FRAME_TAGS)})`,
        returnByValue: true,
      }),
    ),
  )
}

// F after the last press. A difference from focusableCount means the page added or removed tab stops
// during the walk, which makes every F-based verdict unsafe. Unreadable (closed page, dead context)
// is recorded as null rather than failing a walk that otherwise succeeded.
async function recountFocusables(session: CDPSession): Promise<number | null> {
  try {
    return (await countFocusablesInPage(session)).count
  } catch {
    return null
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
