import { BrowserClient, BrowserPage } from '@at-agent/browser'
import type { Violation, FocusHistory, DynamicViolation } from '@at-agent/accessibility'
import { DynamicEvaluator } from '@at-agent/accessibility'
import { createOpenAIClient, generateAction } from './openai.js'
import { executeAction } from './tools.js'
import {
  AgentOptionsSchema,
  type AgentOptions,
  type AgentResult,
  type Step,
  type Action,
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
    const focusHistory: FocusHistory = []
    const dynamicEvaluator = new DynamicEvaluator()
    let trapDetected = false
    let page: BrowserPage | null = null

    try {
      page = await browser.newPage()
      let observation = `Starting at ${opts.startUrl}. Goal: ${goal}`

      for (let stepNumber = 1; stepNumber <= opts.maxSteps; stepNumber++) {
        if (this.stopped) {
          const dynamicResult = dynamicEvaluator.evaluate()
          return this.createResult(
            goal,
            steps,
            violations,
            false,
            'Agent stopped by user',
            focusHistory,
            trapDetected,
            dynamicResult.violations
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

        // Build execute options, including trapContext for checkTrap action
        const executeOptions = action.type === 'checkTrap'
          ? { headed: opts.headed, trapContext: { focusHistory } }
          : { headed: opts.headed }

        const result = await executeAction(action, page, executeOptions)

        // Record interaction events for dynamic WCAG evaluation
        this.recordInteractionEvent(dynamicEvaluator, action, result.focusedElement)

        // Record focus events after tab actions
        if (action.type === 'tab' && result.focusedElement) {
          focusHistory.push({
            element: result.focusedElement,
            timestamp: Date.now(),
          })
        }

        // Track trap detection result
        if (action.type === 'checkTrap' && result.trapDetected) {
          trapDetected = true
        }

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
          const dynamicResult = dynamicEvaluator.evaluate()
          return this.createResult(goal, steps, violations, true, action.reason, focusHistory, trapDetected, dynamicResult.violations)
        }
      }

      // Reached max steps
      const dynamicResult = dynamicEvaluator.evaluate()
      return this.createResult(
        goal,
        steps,
        violations,
        false,
        `Reached max steps (${opts.maxSteps}) without completing goal`,
        focusHistory,
        trapDetected,
        dynamicResult.violations
      )
    } finally {
      if (page) {
        await page.close()
      }
      await browser.close()
    }
  }

  private recordInteractionEvent(
    evaluator: DynamicEvaluator,
    action: Action,
    focusedElement?: string
  ): void {
    // Map agent actions to InteractionEvent types
    switch (action.type) {
      case 'click':
        evaluator.recordEvent({
          type: 'click',
          element: action.target ?? null,
        })
        break
      case 'fill':
        evaluator.recordEvent({
          type: 'input',
          element: action.target ?? null,
          metadata: action.value ? { value: action.value } : undefined,
        })
        break
      case 'navigate':
        evaluator.recordEvent({
          type: 'navigate',
          element: action.target ?? null,
        })
        break
      case 'tab':
        evaluator.recordEvent({
          type: 'focus',
          element: focusedElement ?? null,
        })
        break
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
    summary: string,
    focusHistory: FocusHistory,
    trapDetected: boolean,
    dynamicViolations: DynamicViolation[] = []
  ): AgentResult {
    return {
      success,
      goal,
      steps,
      violations,
      summary,
      focusHistory,
      trapDetected,
      dynamicViolations,
    }
  }
}
