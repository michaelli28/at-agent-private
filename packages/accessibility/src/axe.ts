import type { BrowserPage } from '@at-agent/browser'
import type { Violation, PassedRule } from './types.js'

// Axe-core source will be injected into the page
import axeCore from 'axe-core'

export interface AxeResult {
  violations: Violation[]
  passes: PassedRule[]
  incomplete: Array<{ id: string; description: string }>
}

export async function runAxe(
  page: BrowserPage,
  options?: { rules?: string[]; tags?: string[] }
): Promise<AxeResult> {
  // Get the underlying Playwright page to inject axe
  const playwrightPage = (page as any).page

  // Inject axe-core
  await playwrightPage.evaluate(axeCore.source)

  // Run axe
  const axeOptions: Record<string, unknown> = {}
  if (options?.rules) {
    axeOptions.runOnly = { type: 'rule', values: options.rules }
  }
  if (options?.tags) {
    axeOptions.runOnly = { type: 'tag', values: options.tags }
  }

  const results = await playwrightPage.evaluate(
    (opts: Record<string, unknown>) => {
      return (window as any).axe.run(document, opts)
    },
    axeOptions
  )

  return {
    violations: results.violations.map((v: any) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      help: v.help,
      helpUrl: v.helpUrl,
      wcagTags: v.tags.filter((t: string) => t.startsWith('wcag')),
      nodes: v.nodes.map((n: any) => ({
        html: n.html,
        target: n.target,
        failureSummary: n.failureSummary ?? null,
      })),
    })),
    passes: results.passes.map((p: any) => ({
      id: p.id,
      description: p.description,
      nodeCount: p.nodes.length,
    })),
    incomplete: results.incomplete.map((i: any) => ({
      id: i.id,
      description: i.description,
    })),
  }
}
