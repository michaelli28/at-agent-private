import type { Page } from 'playwright'
import { convertToElementGraph, getAccessibilityTree } from './ax-tree.js'
import { crawlDOM, getInteractivitySignals } from './dom-crawler.js'
import { buildBridgeMap, detectGaps } from './gap-detector.js'
import type { DualCrawlResult, InteractivitySignals } from './types.js'

const NAVIGATION_TIMEOUT_MS = 60000
// Same fixed settle time taskgen uses to let dynamic content load.
const SETTLE_MS = 3000

// Port of taskgen ElementCrawler.crawlPageWithGapDetection on a caller-owned page (taskgen opened its own context).
export async function crawlPageWithGapDetection(page: Page, url: string): Promise<DualCrawlResult> {
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT_MS,
  })
  await page.waitForTimeout(SETTLE_MS)

  const axNodes = await getAccessibilityTree(page)
  const accessibilityTree = convertToElementGraph(axNodes, url, await page.title())

  const domElements = await crawlDOM(page, url)

  const signals = new Map<number, InteractivitySignals>()
  for (const element of domElements) {
    try {
      signals.set(element.backendNodeId, await getInteractivitySignals(page, element))
    } catch {
      // Same as taskgen: an element whose signals cannot be read is silently left out.
    }
  }

  // BASELINE-BUG(F1): isElementVisible is never called, so hidden and unrendered elements reach the classifier.
  const bridgeMap = buildBridgeMap(accessibilityTree)
  const gaps = detectGaps(domElements, accessibilityTree, signals)

  return { pageUrl: url, accessibilityTree, domElements, gaps, bridgeMap }
}
