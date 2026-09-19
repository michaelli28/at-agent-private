import { describe, it, expect, vi, beforeEach } from 'vitest'
import { crawlPageWithGapDetection } from '@at-agent/accessibility'
import { runGaps, GapsCommandOptions } from './gaps.js'

// Mock the browser and accessibility packages
vi.mock('@at-agent/browser', () => ({
  BrowserClient: vi.fn().mockImplementation(() => ({
    launch: vi.fn(),
    close: vi.fn(),
    newPage: vi.fn().mockResolvedValue({
      playwrightPage: { marker: 'playwright-page' },
      close: vi.fn(),
    }),
  })),
}))

vi.mock('@at-agent/accessibility', () => ({
  crawlPageWithGapDetection: vi.fn().mockResolvedValue({
    pageUrl: 'https://example.com',
    accessibilityTree: { elements: new Map() },
    domElements: [],
    hidden: [],
    bridgeMap: new Map(),
    errors: [],
    keyboard: {
      walkRan: true,
      notFocusableAssessed: true,
      unassessedReasons: [],
      walkError: null,
      reachedBackendNodeIds: [7],
    },
    gaps: [
      {
        domElement: {
          nodeId: 1,
          backendNodeId: 2,
          nodeName: 'DIV',
          localName: 'div',
          attributes: { class: 'btn' },
          boundingBox: null,
          pageUrl: 'https://example.com',
        },
        signals: {
          hasClickHandler: true,
          hasCursorPointer: false,
          isSemanticInteractive: false,
          hasTabindex: false,
          tabindexValue: null,
          hasRoleAttribute: false,
          roleValue: null,
          hasAriaExpanded: false,
          classNameHints: ['btn'],
        },
        gapType: 'missing_from_a11y_tree',
        severity: 'critical',
        wcagViolations: ['4.1.2'],
        suggestedFix: 'Use a button.',
        evidence: 'DIV element with interactivity signals is not exposed in the accessibility tree',
      },
    ],
  }),
  summarizeGaps: vi.fn().mockReturnValue({
    total: 1,
    byType: {
      missing_from_a11y_tree: 1,
      no_accessible_name: 0,
      wrong_role: 0,
      not_focusable: 0,
      hidden_but_interactive: 0,
    },
    bySeverity: { critical: 1, serious: 0, moderate: 0, minor: 0 },
  }),
  getElementDescription: vi.fn().mockReturnValue('<div> class="btn"'),
}))

describe('runGaps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs gap detection on the url and returns gaps with a summary', async () => {
    const options: GapsCommandOptions = {
      url: 'https://example.com',
      json: false,
    }

    const result = await runGaps(options)

    expect(result.success).toBe(true)
    expect(crawlPageWithGapDetection).toHaveBeenCalledWith({ marker: 'playwright-page' }, 'https://example.com', {
      tabWalk: true,
    })
    expect(result.gaps).toHaveLength(1)
    expect(result.summary?.bySeverity.critical).toBe(1)
  })

  it('returns JSON output with url, summary and gaps when requested', async () => {
    const options: GapsCommandOptions = {
      url: 'https://example.com',
      json: true,
    }

    const result = await runGaps(options)

    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.output!)
    expect(parsed.url).toBe('https://example.com')
    expect(parsed.summary.total).toBe(1)
    expect(parsed.gaps[0].gapType).toBe('missing_from_a11y_tree')
  })

  it('lists each gap with severity, element and evidence in text output', async () => {
    const result = await runGaps({ url: 'https://example.com' })

    expect(result.output).toContain('1 gaps found')
    expect(result.output).toContain('[CRITICAL] missing_from_a11y_tree')
    expect(result.output).toContain('<div> class="btn"')
    expect(result.output).toContain('DIV element with interactivity signals is not exposed in the accessibility tree')
  })

  it('skips the Tab walk only when asked (F3)', async () => {
    await runGaps({ url: 'https://example.com', tabWalk: false })

    expect(crawlPageWithGapDetection).toHaveBeenCalledWith({ marker: 'playwright-page' }, 'https://example.com', {
      tabWalk: false,
    })
  })

  it('says in text and JSON output when not_focusable was not assessed, and why (F3)', async () => {
    const detected = await crawlPageWithGapDetection(
      {} as Parameters<typeof crawlPageWithGapDetection>[0],
      'https://example.com',
    )
    const unassessed = {
      ...detected,
      keyboard: {
        walkRan: true,
        notFocusableAssessed: false,
        unassessedReasons: ['no-wrap' as const],
        walkError: null,
        reachedBackendNodeIds: [],
      },
    }
    vi.mocked(crawlPageWithGapDetection).mockResolvedValueOnce(unassessed).mockResolvedValueOnce(unassessed)

    const text = await runGaps({ url: 'https://example.com' })
    expect(text.output).toContain('not_focusable not assessed: no-wrap')

    const json = await runGaps({ url: 'https://example.com', json: true })
    expect(JSON.parse(json.output!).keyboard).toEqual({
      notFocusableAssessed: false,
      unassessedReasons: ['no-wrap'],
      walkError: null,
    })
  })

  it('returns the error when detection fails', async () => {
    vi.mocked(crawlPageWithGapDetection).mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))

    const result = await runGaps({ url: 'http://127.0.0.1:9' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('net::ERR_CONNECTION_REFUSED')
  })
})
