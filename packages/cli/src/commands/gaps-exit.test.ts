import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GapSummary } from '@at-agent/accessibility'
import { createProgram } from '../cli.js'
import { runGaps, type GapsCommandResult } from './gaps.js'

vi.mock('./gaps.js', () => ({ runGaps: vi.fn() }))

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`)
  }
}

function summary(bySeverity: Partial<GapSummary['bySeverity']>): GapSummary {
  const severities = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    ...bySeverity,
  }
  return {
    total: severities.critical + severities.serious + severities.moderate + severities.minor,
    byType: {
      missing_from_a11y_tree: 0,
      no_accessible_name: 0,
      wrong_role: 0,
      not_focusable: 0,
      hidden_but_interactive: 0,
    },
    bySeverity: severities,
  }
}

// Runs `at-agent gaps <url>` and returns the code the process would exit with (0 when exit is never called).
async function exitCodeFor(result: GapsCommandResult): Promise<number> {
  vi.mocked(runGaps).mockResolvedValueOnce(result)
  try {
    await createProgram().parseAsync(['gaps', 'https://example.com'], {
      from: 'user',
    })
    return 0
  } catch (error) {
    if (error instanceof ExitCalled) return error.code
    throw error
  }
}

describe('gaps command exit code', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // A real exit stops the action, so the stub throws instead of returning.
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new ExitCalled(Number(code ?? 0))
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exits 1 when a critical gap is found', async () => {
    expect(await exitCodeFor({ success: true, summary: summary({ critical: 1 }) })).toBe(1)
    expect(runGaps).toHaveBeenCalledWith({
      url: 'https://example.com',
      json: undefined,
    })
  })

  it('exits 1 when only serious gaps are found', async () => {
    expect(await exitCodeFor({ success: true, summary: summary({ serious: 2 }) })).toBe(1)
  })

  it('exits 0 when the page has no gaps', async () => {
    expect(await exitCodeFor({ success: true, summary: summary({}) })).toBe(0)
  })

  it('exits 0 when only moderate or minor gaps are found', async () => {
    expect(
      await exitCodeFor({
        success: true,
        summary: summary({ moderate: 1, minor: 1 }),
      }),
    ).toBe(0)
  })

  it('exits 1 and prints the error when detection fails', async () => {
    expect(
      await exitCodeFor({
        success: false,
        error: 'net::ERR_CONNECTION_REFUSED',
      }),
    ).toBe(1)
    expect(console.error).toHaveBeenCalledWith('Error: net::ERR_CONNECTION_REFUSED')
  })
})
