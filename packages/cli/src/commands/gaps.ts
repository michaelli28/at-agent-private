import { BrowserClient } from '@at-agent/browser'
import {
  crawlPageWithGapDetection,
  getElementDescription,
  summarizeGaps,
  type AccessibilityGap,
  type GapSummary,
} from '@at-agent/accessibility'
import { formatJSON } from '../output.js'

export interface GapsCommandOptions {
  url: string
  json?: boolean
}

export interface GapsCommandResult {
  success: boolean
  gaps?: AccessibilityGap[]
  summary?: GapSummary
  output?: string
  error?: string
}

export async function runGaps(options: GapsCommandOptions): Promise<GapsCommandResult> {
  const browser = new BrowserClient()

  try {
    await browser.launch()
    const page = await browser.newPage()

    try {
      // The detector navigates itself (domcontentloaded + fixed settle), so no page.goto here.
      const result = await crawlPageWithGapDetection(page.playwrightPage, options.url)
      const summary = summarizeGaps(result.gaps)

      if (options.json) {
        return {
          success: true,
          gaps: result.gaps,
          summary,
          output: formatJSON({
            url: result.pageUrl,
            summary,
            gaps: result.gaps,
          }),
        }
      }

      return {
        success: true,
        gaps: result.gaps,
        summary,
        output: formatGapReport(summary, result.gaps),
      }
    } finally {
      await page.close()
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  } finally {
    await browser.close()
  }
}

function formatGapReport(summary: GapSummary, gaps: readonly AccessibilityGap[]): string {
  const lines = [
    `Accessibility Gap Detection Results`,
    `-----------------------------------`,
    `${summary.total} gaps found`,
    `  Critical: ${summary.bySeverity.critical}`,
    `  Serious: ${summary.bySeverity.serious}`,
    `  Moderate: ${summary.bySeverity.moderate}`,
    `  Minor: ${summary.bySeverity.minor}`,
  ]

  if (gaps.length > 0) {
    lines.push('', 'Gaps:', '')
    for (const gap of gaps) {
      lines.push(
        `[${gap.severity.toUpperCase()}] ${gap.gapType}`,
        `  ${getElementDescription(gap.domElement)}`,
        `  ${gap.evidence}`,
        `  WCAG: ${gap.wcagViolations.join(', ')}`,
        '',
      )
    }
  }

  return lines.join('\n')
}
