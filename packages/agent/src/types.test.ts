import { describe, it, expect } from 'vitest'
import {
  ActionTypeSchema,
  ActionSchema,
  ActionResultSchema,
  AgentOptionsSchema,
  StepSchema,
  AgentResultSchema,
} from './types.js'

describe('ActionTypeSchema', () => {
  it('accepts valid action types', () => {
    expect(ActionTypeSchema.parse('navigate')).toBe('navigate')
    expect(ActionTypeSchema.parse('click')).toBe('click')
    expect(ActionTypeSchema.parse('fill')).toBe('fill')
    expect(ActionTypeSchema.parse('audit')).toBe('audit')
    expect(ActionTypeSchema.parse('observe')).toBe('observe')
    expect(ActionTypeSchema.parse('done')).toBe('done')
  })

  it('rejects invalid action types', () => {
    expect(() => ActionTypeSchema.parse('invalid')).toThrow()
  })
})

describe('ActionSchema', () => {
  it('validates action with target', () => {
    const action = {
      type: 'click',
      target: 'button[name="Submit"]',
      reason: 'Submit the form',
    }
    const result = ActionSchema.parse(action)
    expect(result.type).toBe('click')
    expect(result.target).toBe('button[name="Submit"]')
  })

  it('validates action without target', () => {
    const action = {
      type: 'observe',
      reason: 'Check current page state',
    }
    const result = ActionSchema.parse(action)
    expect(result.type).toBe('observe')
    expect(result.target).toBeUndefined()
  })

  it('validates action with value for fill', () => {
    const action = {
      type: 'fill',
      target: 'input[name="email"]',
      value: 'test@example.com',
      reason: 'Enter email address',
    }
    const result = ActionSchema.parse(action)
    expect(result.type).toBe('fill')
    expect(result.value).toBe('test@example.com')
  })

  it('rejects action without reason', () => {
    const action = {
      type: 'click',
      target: 'button',
    }
    expect(() => ActionSchema.parse(action)).toThrow()
  })
})

describe('ActionResultSchema', () => {
  it('validates result without violations', () => {
    const result = {
      success: true,
      observation: 'Page loaded successfully',
    }
    const parsed = ActionResultSchema.parse(result)
    expect(parsed.success).toBe(true)
    expect(parsed.violations).toBeUndefined()
  })

  it('validates result with violations', () => {
    const result = {
      success: true,
      observation: 'Found accessibility issues',
      violations: [
        {
          id: 'color-contrast',
          impact: 'serious',
          description: 'Elements must have sufficient color contrast',
          help: 'Ensure contrast ratio meets WCAG requirements',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.0/color-contrast',
          wcagTags: ['wcag2aa', 'wcag143'],
          nodes: [
            {
              html: '<p class="low-contrast">Text</p>',
              target: ['.low-contrast'],
              failureSummary: 'Fix contrast ratio',
            },
          ],
        },
      ],
    }
    const parsed = ActionResultSchema.parse(result)
    expect(parsed.violations).toHaveLength(1)
    expect(parsed.violations?.[0].id).toBe('color-contrast')
  })
})

describe('AgentOptionsSchema', () => {
  it('applies defaults', () => {
    const options = { startUrl: 'https://example.com' }
    const result = AgentOptionsSchema.parse(options)
    expect(result.maxSteps).toBe(20)
    expect(result.model).toBe('gpt-4o')
  })

  it('allows overriding defaults', () => {
    const options = {
      startUrl: 'https://example.com',
      maxSteps: 50,
      model: 'gpt-4-turbo',
    }
    const result = AgentOptionsSchema.parse(options)
    expect(result.maxSteps).toBe(50)
    expect(result.model).toBe('gpt-4-turbo')
  })

  it('rejects invalid URL', () => {
    expect(() => AgentOptionsSchema.parse({ startUrl: 'not-a-url' })).toThrow()
  })

  it('rejects non-positive maxSteps', () => {
    expect(() =>
      AgentOptionsSchema.parse({ startUrl: 'https://example.com', maxSteps: 0 })
    ).toThrow()
    expect(() =>
      AgentOptionsSchema.parse({ startUrl: 'https://example.com', maxSteps: -1 })
    ).toThrow()
  })
})

describe('StepSchema', () => {
  it('validates a complete step', () => {
    const step = {
      stepNumber: 1,
      action: {
        type: 'navigate',
        target: 'https://example.com',
        reason: 'Go to homepage',
      },
      result: {
        success: true,
        observation: 'Page loaded successfully',
      },
      timestamp: '2024-01-15T00:00:00Z',
    }
    const result = StepSchema.parse(step)
    expect(result.stepNumber).toBe(1)
    expect(result.action.type).toBe('navigate')
  })

  it('validates step with violations in result', () => {
    const step = {
      stepNumber: 2,
      action: {
        type: 'audit',
        reason: 'Check accessibility',
      },
      result: {
        success: true,
        observation: 'Found 1 violation',
        violations: [
          {
            id: 'image-alt',
            impact: 'critical',
            description: 'Images must have alternate text',
            help: 'Add alt attribute to images',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.0/image-alt',
            wcagTags: ['wcag2a', 'wcag111'],
            nodes: [
              {
                html: '<img src="photo.jpg">',
                target: ['img'],
                failureSummary: 'Add alt text',
              },
            ],
          },
        ],
      },
      timestamp: '2024-01-15T00:01:00Z',
    }
    const result = StepSchema.parse(step)
    expect(result.result.violations).toHaveLength(1)
  })
})

describe('AgentResultSchema', () => {
  it('validates a complete agent result', () => {
    const agentResult = {
      success: true,
      goal: 'Test homepage accessibility',
      steps: [
        {
          stepNumber: 1,
          action: {
            type: 'navigate',
            target: 'https://example.com',
            reason: 'Go to homepage',
          },
          result: {
            success: true,
            observation: 'Page loaded',
          },
          timestamp: '2024-01-15T00:00:00Z',
        },
        {
          stepNumber: 2,
          action: {
            type: 'done',
            reason: 'Testing complete',
          },
          result: {
            success: true,
            observation: 'All tests passed',
          },
          timestamp: '2024-01-15T00:01:00Z',
        },
      ],
      violations: [],
      summary: 'No accessibility violations found',
    }
    const result = AgentResultSchema.parse(agentResult)
    expect(result.success).toBe(true)
    expect(result.steps).toHaveLength(2)
    expect(result.violations).toHaveLength(0)
  })

  it('validates result with violations', () => {
    const agentResult = {
      success: false,
      goal: 'Test form accessibility',
      steps: [],
      violations: [
        {
          id: 'label',
          impact: 'critical',
          description: 'Form elements must have labels',
          help: 'Add labels to form inputs',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.0/label',
          wcagTags: ['wcag2a', 'wcag412'],
          nodes: [
            {
              html: '<input type="text">',
              target: ['input'],
              failureSummary: 'Add label element',
            },
          ],
        },
      ],
      summary: 'Found 1 critical violation',
    }
    const result = AgentResultSchema.parse(agentResult)
    expect(result.success).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].impact).toBe('critical')
  })
})
