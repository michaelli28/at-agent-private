import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
import {
  TabWalkResultSchema,
  type EscapeProbe,
  type FocusRead,
  type TabWalkResult,
  type TabWalkStep,
} from './tab-walk.js'
import { endOfPage, judgeKeyboardTrap } from './keyboard-trap.js'

// Dev material only (never bench/corpus/test or bench/results/*/test-*): the committed recorded walks.
const RECORDS = join(dirname(fileURLToPath(import.meta.url)), '../../../bench/results/cd3b122')

// bench/ sits outside this package's tsconfig rootDir, and `tsc` compiles src/**/*.test.ts, so a
// static import of the frozen baseline would break `npm run build -w @at-agent/accessibility`.
// The specifier is built at runtime so TypeScript never pulls bench/ into this program.
type ReplayLegacy = (steps: ReadonlyArray<{ index: number; immediate: FocusRead }>) => {
  trap: { firstTrappedPress: number | null }
}

async function loadReplayLegacy(): Promise<ReplayLegacy> {
  const href = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../../../bench/legacy.ts')).href
  const mod = (await import(href)) as { replayLegacy: ReplayLegacy }
  return mod.replayLegacy
}

// The records predate two schema fields that the trap judge never reads: DeepFocus.classAttr and
// TabWalkStep.indicator. Backfilling them with null is what makes the recording parse; it cannot move
// a verdict, because no clause of the judge looks at either field.
function backfill(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(backfill)
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = backfill(v)
  if ('backendNodeId' in out && 'tag' in out && 'isBody' in out && !('classAttr' in out)) out.classAttr = null
  if ('index' in out && 'immediate' in out && 'settled' in out && !('indicator' in out)) out.indicator = null
  return out
}

function recorded(set: 'dev-fixtures' | 'dev-variants', page: string): TabWalkResult {
  const raw = JSON.parse(gunzipSync(readFileSync(join(RECORDS, set, 'raw', `${page}.json.gz`))).toString('utf8'))
  return TabWalkResultSchema.parse(backfill(raw.walk))
}

const EMPTY_READ: FocusRead = {
  backendNodeId: null,
  tag: null,
  id: null,
  className: null,
  ariaLabel: null,
  nameAttr: null,
  nameProp: null,
  text: null,
  isBody: false,
  hasFocus: false,
  url: 'http://localhost/p',
  container: null,
  deep: null,
  deepUnavailable: null,
}

function elementRead(backendNodeId: number, tag = 'a', id: string | null = null): FocusRead {
  return {
    ...EMPTY_READ,
    backendNodeId,
    tag,
    id,
    hasFocus: true,
    deep: { backendNodeId, tag, id, isBody: false, classAttr: null },
  }
}

function bodyRead(hasFocus: boolean): FocusRead {
  return {
    ...EMPTY_READ,
    backendNodeId: 9,
    tag: 'body',
    id: null,
    isBody: true,
    hasFocus,
    deep: {
      backendNodeId: 9,
      tag: 'body',
      id: null,
      isBody: true,
      classAttr: null,
    },
  }
}

function synthStep(index: number, settled: FocusRead, over: Partial<TabWalkStep> = {}): TabWalkStep {
  return {
    index,
    key: 'Tab',
    immediate: settled,
    settled,
    focusStyle: null,
    documentReplaced: false,
    wrapped: false,
    focusLost: false,
    indicator: null,
    ...over,
  }
}

// Escape and every Shift+Tab stay inside `region`: a probe that got nowhere.
function confinedProbe(region: number[]): EscapeProbe {
  const last = elementRead(region[region.length - 1])
  return {
    probeKey: 'Shift+Tab',
    seenBackendNodeIds: region,
    before: last,
    escape: { after: last, documentReplaced: false, urlChanged: false, unseenElement: false, wrapped: false },
    maxPresses: 5,
    steps: [1, 2, 3, 4, 5].map((index) => ({
      index,
      key: 'Shift+Tab' as const,
      // Shift+Tab walks the region backwards from its last member, wrapping inside it.
      settled: elementRead(region[(((region.length - 1 - index) % region.length) + region.length) % region.length]),
      documentReplaced: false,
      unseenElement: false,
      wrapped: false,
    })),
    reachedAt: null,
  }
}

function synthWalk(steps: TabWalkStep[], over: Partial<TabWalkResult> = {}): TabWalkResult {
  return {
    direction: 'forward',
    focusableCount: 3,
    fIncomplete: false,
    fIncompleteCauses: { crossOriginFrames: 0, closedShadowRoots: 0 },
    defaultPresses: steps.length,
    presses: steps.length,
    settleMs: 150,
    launchFacts: { browserVersion: null, executableBasename: null },
    initial: bodyRead(true),
    idle: null,
    focusableCountEnd: null,
    steps,
    suspectedTrap: steps.some((s) => s.wrapped) ? false : true,
    escapeProbe: null,
    error: null,
    ...over,
  }
}

describe('judgeKeyboardTrap', () => {
  // 1
  it('clean page: the wrap is the end of the page, not a cycle', () => {
    const walk = recorded('dev-fixtures', 'three-links')
    const result = judgeKeyboardTrap([walk])
    expect(result.verdict).toBe('pass')
    expect(result.keyboardTrap).toBe(false)
    expect(result.trapEscapable).toBeNull()
    expect(result.directions[0].endOfPage).toEqual({
      signal: 'body-unfocused',
      atPress: 4,
    })
    expect(endOfPage(walk)).toEqual({ signal: 'body-unfocused', atPress: 4 })
  })

  // 2
  it('the false alarm is gone while the frozen baseline still reproduces it', async () => {
    const replayLegacy = await loadReplayLegacy()
    const walk = recorded('dev-fixtures', 'three-links')
    // The frozen pre-fix checker on the very same recorded walk.
    expect(replayLegacy(walk.steps).trap.firstTrappedPress).toBe(20)
    expect(judgeKeyboardTrap([walk]).verdict).toBe('pass')
  })

  // 3
  it('truncated clean walk: every counted stop visited is also the end of the page', () => {
    const ids = [11, 12, 13, 11, 12, 13]
    const walk = synthWalk(
      ids.map((id, i) => synthStep(i + 1, elementRead(id))),
      {
        focusableCount: 3,
        defaultPresses: 25,
        presses: 6,
        suspectedTrap: true,
      },
    )
    const result = judgeKeyboardTrap([walk])
    expect(result.verdict).toBe('pass')
    expect(result.keyboardTrap).toBe(false)
    expect(result.directions[0].endOfPage).toEqual({
      signal: 'all-stops-visited',
      atPress: 3,
    })
  })

  // KNOWN FALSE PASSES, pinned so that fixing them is noticed: a trap the walk meets only after it has
  // visited every counted stop — stuck on the last stop, cycling on the last two (a dialog appended to
  // <body> that does not take focus), or closing after one lap of the page. The count is complete, so
  // clause 4 passes the page before clauses 9-11 read the probe that already failed. Every recorded M5
  // trap catches focus earlier, so no recorded walk reaches this; bench/REPORT.md §7 discloses it.
  // When the judge is fixed, drop `.fails`.
  it.fails('KNOWN FALSE PASS: a Tab-swallow trap on the last stop is judged a trap', () => {
    const ids = [11, 12, 13, ...Array<number>(22).fill(13)]
    const walk = synthWalk(
      ids.map((id, i) => synthStep(i + 1, elementRead(id))),
      { focusableCount: 3, suspectedTrap: true, escapeProbe: confinedProbe([13]) },
    )
    expect(judgeKeyboardTrap([walk]).verdict).toBe('fail')
  })

  it.fails('KNOWN FALSE PASS: a cyclic trap on the last two stops is judged a trap', () => {
    const ids = [11, 12, 13, 14, ...Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 13 : 14))]
    const walk = synthWalk(
      ids.map((id, i) => synthStep(i + 1, elementRead(id))),
      { focusableCount: 4, suspectedTrap: true, escapeProbe: confinedProbe([13, 14]) },
    )
    expect(judgeKeyboardTrap([walk]).verdict).toBe('fail')
  })

  it.fails('KNOWN FALSE PASS: a trap that closes after one lap of the page is judged a trap', () => {
    const lap = [11, 12, 13].map((id, i) => synthStep(i + 1, elementRead(id)))
    const wrap = synthStep(4, bodyRead(false), { wrapped: true })
    const stuck = [11, 12, ...Array<number>(19).fill(13)].map((id, i) => synthStep(i + 5, elementRead(id)))
    const walk = synthWalk([...lap, wrap, ...stuck], {
      focusableCount: 3,
      suspectedTrap: true,
      escapeProbe: confinedProbe([13]),
    })
    expect(judgeKeyboardTrap([walk]).verdict).toBe('fail')
  })

  // 4
  it('M5 Tab-swallow is a trap: Escape and Shift+Tab both fail', () => {
    const walk = recorded('dev-variants', 'three-links__M5__link-1')
    const result = judgeKeyboardTrap([walk])
    expect(result.verdict).toBe('fail')
    expect(result.keyboardTrap).toBe(true)
    expect(result.trapEscapable).toBe(false)
    expect(result.directions[0].release).toBe('none')
    expect(result.directions[0].confined).toBe(true)
    expect(result.directions[0].stuckOn?.backendNodeId).toBe(13)
    expect(result.directions[0].region).toEqual([13])
    expect(result.directions[0].focusableCount).toBe(3)
  })

  // 5
  it('a cyclic trap is not end-of-page: the M5 record returns to its first element on press 2', () => {
    const singleId = [
      'three-links__M5__link-1',
      'navbar__M5__brand',
      'identical-links__M5__read-more-01',
      'js-handlers__M5__custom-button',
    ]
    for (const page of singleId) {
      const walk = recorded('dev-variants', page)
      // The premise the deleted rule would have tripped on: press 2 is already back on press 1's element.
      expect(walk.steps[1].settled.deep?.backendNodeId).toBe(walk.steps[0].settled.deep?.backendNodeId)
      expect(endOfPage(walk)).toBeNull()
      expect(judgeKeyboardTrap([walk]).verdict).toBe('fail')
      expect(judgeKeyboardTrap([walk]).directions[0].endOfPage).toBeNull()
    }
  })

  // 6
  it('a correct modal is confined but escapable', () => {
    const walk = recorded('dev-fixtures', 'modal')
    const result = judgeKeyboardTrap([walk])
    expect(result.verdict).toBe('pass')
    expect(result.keyboardTrap).toBe(true)
    expect(result.trapEscapable).toBe(true)
    expect(result.directions[0].release).toBe('escape-key')
    expect(result.directions[0].region).toHaveLength(4)
    expect(result.directions[0].focusableCount).toBe(8)
  })

  // 7
  it('region size is recorded, never a verdict input', () => {
    const navbar = recorded('dev-fixtures', 'navbar')
    const navbarResult = judgeKeyboardTrap([navbar])
    expect(navbar.focusableCount).toBe(12)
    expect(navbarResult.verdict).toBe('pass')
    expect(navbarResult.directions[0].endOfPage?.signal).toBe('body-unfocused')
    expect(navbarResult.directions[0].region.length).toBeLessThan(navbar.focusableCount)

    const modal = recorded('dev-fixtures', 'modal')
    const modalResult = judgeKeyboardTrap([modal])
    expect(modalResult.verdict).toBe('pass')
    expect(modalResult.directions[0].release).toBe('escape-key')
    expect(modalResult.directions[0].region.length).toBeLessThan(modal.focusableCount)
  })

  // 8
  it('undetermined never reads as a pass', () => {
    const stuck = (n: number) => Array.from({ length: n }, (_, i) => synthStep(i + 1, elementRead(11)))

    const walkError = synthWalk(stuck(3), {
      suspectedTrap: null,
      error: { phase: 'walk', index: 4, message: 'page closed' },
    })
    const incomplete = synthWalk(stuck(25), {
      fIncomplete: true,
      defaultPresses: 25,
    })
    const changed = synthWalk(stuck(25), {
      focusableCountEnd: 5,
      defaultPresses: 25,
    })
    const short = synthWalk(stuck(3), { defaultPresses: 25 })
    const noProbe = synthWalk(stuck(25), { defaultPresses: 25 })

    const cases: ReadonlyArray<[TabWalkResult, string]> = [
      [walkError, 'walk-error'],
      [changed, 'focusables-changed'],
      [incomplete, 'focusables-incomplete'],
      [short, 'short-walk'],
      [noProbe, 'no-release-probe'],
    ]
    for (const [walk, reason] of cases) {
      const result = judgeKeyboardTrap([walk])
      expect(result.verdict).toBe('undetermined')
      expect(result.reason).toBe(reason)
      expect(result.keyboardTrap).toBe(false)
      expect(result.trapEscapable).toBeNull()
    }
  })

  // 9
  it('identities are never compared across a document replacement', () => {
    // Press 3 replaces the document and the new document re-mints 11 and 12: without segmentation the
    // walk reads as a revisit of presses 1-2.
    const steps = [
      synthStep(1, elementRead(11)),
      synthStep(2, elementRead(12)),
      synthStep(3, elementRead(11), { documentReplaced: true }),
      synthStep(4, elementRead(12)),
      synthStep(5, elementRead(13)),
    ]
    const replaced = synthWalk(steps, {
      focusableCount: 3,
      defaultPresses: 5,
      presses: 5,
    })
    const replacedResult = judgeKeyboardTrap([replaced])
    expect(replacedResult.verdict).toBe('undetermined')
    expect(replacedResult.reason).toBe('document-replaced')
    expect(replacedResult.directions[0].documentReplacements).toEqual([3])

    const wrappedSteps = [...steps.slice(0, 4), synthStep(5, bodyRead(false), { wrapped: true })]
    const wrapped = synthWalk(wrappedSteps, {
      focusableCount: 3,
      defaultPresses: 5,
      presses: 5,
    })
    const wrappedResult = judgeKeyboardTrap([wrapped])
    expect(wrappedResult.verdict).toBe('pass')
    expect(wrappedResult.directions[0].endOfPage?.signal).toBe('body-unfocused')
  })

  // 10
  it('fail on one direction is a page fail; pass on one direction is recorded as single-direction', () => {
    const clean = recorded('dev-fixtures', 'three-links')
    const trapped = recorded('dev-variants', 'three-links__M5__link-1')

    expect(judgeKeyboardTrap([trapped]).verdict).toBe('fail')

    const forwardOnly = judgeKeyboardTrap([clean])
    expect(forwardOnly.verdict).toBe('pass')
    expect(forwardOnly.singleDirection).toBe(true)
    expect(forwardOnly.directionsWalked).toEqual(['forward'])

    const both = judgeKeyboardTrap([clean, { ...trapped, direction: 'backward' }])
    expect(both.verdict).toBe('fail')
    expect(both.singleDirection).toBe(false)
    expect(both.directionsWalked).toEqual(['forward', 'backward'])
  })
})
