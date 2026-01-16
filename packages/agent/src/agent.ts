import { BrowserClient, BrowserPage } from '@at-agent/browser'
import type { Violation } from '@at-agent/accessibility'
import { createOpenAIClient, generateAction } from './openai.js'
import { executeAction } from './tools.js'
import {
  AgentOptionsSchema,
  type AgentOptions,
  type AgentResult,
  type Step,
} from './types.js'
import type OpenAI from 'openai'

export class Agent {
  private client: OpenAI
  private stopped = false

  constructor(apiKey: string) {
    this.client = createOpenAIClient(apiKey)
  }

  async run(
    goal: string,
    options: Partial<AgentOptions> & { startUrl: string }
  ): Promise<AgentResult> {
    const opts = AgentOptionsSchema.parse(options)
    this.stopped = false

    const browser = new BrowserClient({ headless: !opts.headed })
    await browser.launch()

    const steps: Step[] = []
    const violations: Violation[] = []
    let page: BrowserPage | null = null

    try {
      page = await browser.newPage()
      let observation = `Starting at ${opts.startUrl}. Goal: ${goal}`

      for (let stepNumber = 1; stepNumber <= opts.maxSteps; stepNumber++) {
        if (this.stopped) {
          return this.createResult(
            goal,
            steps,
            violations,
            false,
            'Agent stopped by user'
          )
        }

        const action = await generateAction(
          this.client,
          opts.model,
          goal,
          observation,
          steps
        )

        // Navigate to start URL on first step if action is not navigate
        if (stepNumber === 1 && action.type !== 'navigate') {
          await page.goto(opts.startUrl)
        }

        const result = await executeAction(action, page, { headed: opts.headed })

        const step: Step = {
          stepNumber,
          action,
          result,
          timestamp: new Date().toISOString(),
        }
        steps.push(step)

        // Collect violations from audit steps
        if (result.violations) {
          violations.push(...result.violations)
        }

        observation = result.observation

        // Check if done
        if (action.type === 'done') {
          return this.createResult(goal, steps, violations, true, action.reason)
        }
      }

      // Reached max steps
      return this.createResult(
        goal,
        steps,
        violations,
        false,
        `Reached max steps (${opts.maxSteps}) without completing goal`
      )
    } finally {
      if (page) {
        await page.close()
      }
      await browser.close()
    }
  }

  stop(): void {
    this.stopped = true
  }

  private createResult(
    goal: string,
    steps: Step[],
    violations: Violation[],
    success: boolean,
    summary: string
  ): AgentResult {
    return {
      success,
      goal,
      steps,
      violations,
      summary,
    }
  }
}
