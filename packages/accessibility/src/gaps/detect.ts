import type { Page } from 'playwright'
import { z } from 'zod'
import { runTabWalk, TabWalkOptionsSchema } from '../tab-walk.js'
import { convertToElementGraph, getAccessibilityTree } from './ax-tree.js'
import { collectFocusFacts, collectInteractivitySignals, crawlDOM, findHiddenCandidates } from './dom-crawler.js'
import { buildBridgeMap, detectGaps } from './gap-detector.js'
import { groupReach, keyboardEvidence, NO_WALK, walkFailed } from './keyboard.js'
import type { CrawlError, DualCrawlResult, FocusFacts, KeyboardEvidence } from './types.js'

const NAVIGATION_TIMEOUT_MS = 60000
// Same fixed settle time taskgen uses to let dynamic content load.
const SETTLE_MS = 3000

export const GapDetectionOptionsSchema = z.object({
  // Tab walk after the crawl, on the same load (true = runTabWalk defaults). Without it not_focusable is never emitted.
  tabWalk: z.union([z.boolean(), TabWalkOptionsSchema]).optional(),
})
export type GapDetectionOptions = z.input<typeof GapDetectionOptionsSchema>

// Port of taskgen ElementCrawler.crawlPageWithGapDetection on a caller-owned page (taskgen opened its own context).
export async function crawlPageWithGapDetection(
  page: Page,
  url: string,
  options: GapDetectionOptions = {},
): Promise<DualCrawlResult> {
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT_MS,
  })
  await page.waitForTimeout(SETTLE_MS)

  const axNodes = await getAccessibilityTree(page)
  const accessibilityTree = convertToElementGraph(axNodes, url, await page.title())

  const crawl = await crawlDOM(page, url)
  const domElements = crawl.elements
  const visibility = await findHiddenCandidates(page, domElements)
  // A zero-area element may still be a Tab stop (G1b), so it is read like the rest until the walk has run.
  const unrendered = new Set(visibility.hidden.filter((h) => h.reason !== 'zero-area').map((h) => h.backendNodeId))
  const crawled = domElements.filter((e) => !unrendered.has(e.backendNodeId))
  const { signals, errors: signalErrors } = await collectInteractivitySignals(page, crawled)
  const { facts: crawledFocus, errors: focusErrors } = await collectFocusFacts(page, crawled)
  // G1c: a container's keydown handler serves its members whatever the container's own box, so an unrendered
  // (display:contents) container a member names is read too, and a hidden one keeps its facts below.
  const widgetIds = new Set(
    [...crawledFocus.values()].flatMap((f) => (f.compositeWidget === null ? [] : [f.compositeWidget])),
  )
  const unrenderedWidgets = domElements.filter((e) => unrendered.has(e.backendNodeId) && widgetIds.has(e.backendNodeId))
  const { facts: widgetFocus, errors: widgetErrors } = await collectFocusFacts(page, unrenderedWidgets)

  // After the crawl: the walk moves focus and may open or navigate, which must not change what was crawled.
  const walked = await walkKeyboard(page, options.tabWalk)

  // G1c: a zero-area element stays a candidate only as a Tab stop. A complete walk decides by where Tab went alone;
  // after none, or an incomplete one, the DOM's focusability rules read before it count too.
  const reached = new Set(walked.keyboard.reachedBackendNodeIds)
  const walkDecides = walked.keyboard.notFocusableAssessed
  const tabStop = (id: number): boolean => reached.has(id) || (!walkDecides && crawledFocus.get(id)?.focusable === true)
  const hidden = visibility.hidden.filter((h) => !(h.reason === 'zero-area' && tabStop(h.backendNodeId)))
  const hiddenIds = new Set(hidden.map((h) => h.backendNodeId))
  const candidates = domElements.filter((e) => !hiddenIds.has(e.backendNodeId))
  // A hidden container is no Tab stop, so its keydown handler fires only for its own members: it keeps its facts as a
  // widget, never as a member of an outer one.
  const focus = new Map(
    [...crawledFocus, ...widgetFocus].flatMap(([id, f]): Array<[number, FocusFacts]> =>
      !hiddenIds.has(id) ? [[id, f]] : widgetIds.has(id) ? [[id, { ...f, compositeWidget: null }]] : [],
    ),
  )

  const bridgeMap = buildBridgeMap(accessibilityTree)
  const gaps = detectGaps(candidates, accessibilityTree, signals, { keyboard: walked.keyboard, focus })

  return {
    pageUrl: url,
    accessibilityTree,
    domElements,
    hidden,
    gaps,
    bridgeMap,
    keyboard: walked.keyboard,
    reachedByGroup: groupReach(walked.keyboard.reachedBackendNodeIds, focus),
    errors: [...crawl.errors, ...visibility.errors, ...signalErrors, ...focusErrors, ...widgetErrors, ...walked.errors],
  }
}

async function walkKeyboard(
  page: Page,
  tabWalk: GapDetectionOptions['tabWalk'],
): Promise<{ keyboard: KeyboardEvidence; errors: CrawlError[] }> {
  if (!tabWalk) return { keyboard: NO_WALK, errors: [] }
  try {
    // The escape probe only grades traps; its extra Escape and Shift+Tab presses add nothing here.
    const walk = await runTabWalk(page, { escapeProbe: false, ...(tabWalk === true ? {} : tabWalk) })
    const errors: CrawlError[] = walk.error
      ? [{ stage: 'tab-walk', backendNodeId: null, message: walk.error.message }]
      : []
    return { keyboard: keyboardEvidence(walk), errors }
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).split('\n')[0]
    return { keyboard: walkFailed(message), errors: [{ stage: 'tab-walk', backendNodeId: null, message }] }
  }
}
