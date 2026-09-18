import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Agent } from './agent.js'
import * as openai from './openai.js'
import * as tools from './tools.js'

// Mock OpenAI module
vi.mock('./openai.js', () => ({
  createOpenAIClient: vi.fn(),
  generateAction: vi.fn(),
}))

// Mock browser module
vi.mock('@at-agent/browser', () => ({
  BrowserClient: vi.fn().mockImplementation(() => ({
    launch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue({
      goto: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  })),
  BrowserPage: vi.fn(),
}))

import { BrowserClient } from '@at-agent/browser'

// Mock tools module
vi.mock('./tools.js', () => ({
  executeAction: vi.fn(),
}))

describe('Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock for executeAction
    const mockExecuteAction = vi.mocked(tools.executeAction)
    mockExecuteAction.mockResolvedValue({
      success: true,
      observation: 'Action completed',
    })
  })

  describe('constructor', () => {
    it('creates agent with API key', () => {
      const agent = new Agent('test-api-key')
      expect(agent).toBeDefined()
    })
  })

  describe('run', () => {
    it('executes goal and returns result', async () => {
      // Mock generateAction to return navigate, observe, audit, then done
      const mockGenerateAction = vi.mocked(openai.generateAction)
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'navigate',
          target: 'https://example.com',
          reason: 'Navigate to target',
        })
        .mockResolvedValueOnce({
          type: 'observe',
          reason: 'Check page state',
        })
        .mockResolvedValueOnce({
          type: 'audit',
          reason: 'Run accessibility check',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Audit complete',
        })

      const agent = new Agent('test-api-key')
      const result = await agent.run('Audit example.com for accessibility', {
        startUrl: 'https://example.com',
        maxSteps: 10,
      })

      expect(result.success).toBe(true)
      expect(result.steps.length).toBe(4)
      expect(result.goal).toBe('Audit example.com for accessibility')
    }, 60000)

    it('stops after maxSteps', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      // Always return observe (never done)
      mockGenerateAction.mockResolvedValue({
        type: 'observe',
        reason: 'Keep observing',
      })

      const agent = new Agent('test-api-key')
      const result = await agent.run('Never-ending goal', {
        startUrl: 'https://example.com',
        maxSteps: 3,
      })

      expect(result.success).toBe(false)
      expect(result.steps.length).toBe(3)
      expect(result.summary).toContain('max steps')
    }, 60000)

    it('collects violations from audit steps', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'navigate',
          target: 'https://example.com',
          reason: 'Navigate',
        })
        .mockResolvedValueOnce({
          type: 'audit',
          reason: 'Check accessibility',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Complete',
        })

      // Mock executeAction to return violations on audit step
      const mockExecuteAction = vi.mocked(tools.executeAction)
      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Navigated to page',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Audit complete',
          violations: [
            {
              id: 'test-violation',
              impact: 'serious',
              description: 'Test violation',
              help: 'Fix this',
              helpUrl: 'https://example.com/help',
              wcagTags: ['wcag2aa'],
              nodes: [],
            },
          ],
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const agent = new Agent('test-api-key')
      const result = await agent.run('Audit the page', {
        startUrl: 'https://example.com',
      })

      expect(result.violations).toBeDefined()
      expect(Array.isArray(result.violations)).toBe(true)
      expect(result.violations.length).toBe(1)
      expect(result.violations[0].id).toBe('test-violation')
    }, 60000)
  })

  describe('stop', () => {
    it('stops running agent', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      mockGenerateAction.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  type: 'observe',
                  reason: 'Slow action',
                }),
              1000
            )
          )
      )

      const agent = new Agent('test-api-key')
      const runPromise = agent.run('Long running goal', {
        startUrl: 'https://example.com',
        maxSteps: 100,
      })

      // Stop after short delay
      setTimeout(() => agent.stop(), 100)

      const result = await runPromise
      expect(result.success).toBe(false)
      expect(result.summary).toContain('stopped')
    }, 60000)
  })

  describe('headed option', () => {
    it('passes headed option to BrowserClient', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      mockGenerateAction.mockResolvedValue({
        type: 'done',
        reason: 'Goal achieved',
      })

      const agent = new Agent('test-api-key')
      await agent.run('test goal', { startUrl: 'https://example.com', headed: true })

      expect(BrowserClient).toHaveBeenCalledWith({ headless: false })
    })

    it('defaults to headless mode', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      mockGenerateAction.mockResolvedValue({
        type: 'done',
        reason: 'Goal achieved',
      })

      const agent = new Agent('test-api-key')
      await agent.run('test goal', { startUrl: 'https://example.com' })

      expect(BrowserClient).toHaveBeenCalledWith({ headless: true })
    })

    it('passes headed option to executeAction', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      mockGenerateAction.mockResolvedValue({
        type: 'done',
        reason: 'Goal achieved',
      })

      const agent = new Agent('test-api-key')
      await agent.run('test goal', { startUrl: 'https://example.com', headed: true })

      expect(tools.executeAction).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ headed: true })
      )
    })
  })

  describe('keyboard trap detection integration', () => {
    it('records focus events after tab actions to focus history', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'navigate',
          target: 'https://example.com',
          reason: 'Navigate to page',
        })
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab to next element',
        })
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab to next element',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Complete',
        })

      const mockExecuteAction = vi.mocked(tools.executeAction)
      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Navigated to page',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: button#submit "Submit"',
          focusedElement: 'button#submit "Submit"',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: input#email "Email"',
          focusedElement: 'input#email "Email"',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const agent = new Agent('test-api-key')
      const result = await agent.run('Test keyboard navigation', {
        startUrl: 'https://example.com',
      })

      expect(result.success).toBe(true)
      // The agent should have accumulated focus history internally
      // We verify this by checking that checkTrap would receive the history
      expect(result.focusHistory).toBeDefined()
      expect(result.focusHistory).toHaveLength(2)
      expect(result.focusHistory![0].element).toBe('button#submit "Submit"')
      expect(result.focusHistory![1].element).toBe('input#email "Email"')
    }, 60000)

    it('passes accumulated focus history to checkTrap action', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'navigate',
          target: 'https://example.com',
          reason: 'Navigate to page',
        })
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab to next element',
        })
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab again',
        })
        .mockResolvedValueOnce({
          type: 'checkTrap',
          reason: 'Check for keyboard trap',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Complete',
        })

      const mockExecuteAction = vi.mocked(tools.executeAction)
      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Navigated to page',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: button#btn1',
          focusedElement: 'button#btn1',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: button#btn2',
          focusedElement: 'button#btn2',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'No keyboard trap detected',
          trapDetected: false,
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const agent = new Agent('test-api-key')
      await agent.run('Test keyboard trap detection', {
        startUrl: 'https://example.com',
      })

      // Verify that executeAction was called with trapContext containing focus history
      const checkTrapCall = mockExecuteAction.mock.calls.find(
        (call) => call[0].type === 'checkTrap'
      )
      expect(checkTrapCall).toBeDefined()
      expect(checkTrapCall![2]).toEqual(
        expect.objectContaining({
          trapContext: expect.objectContaining({
            focusHistory: expect.arrayContaining([
              expect.objectContaining({ element: 'button#btn1' }),
              expect.objectContaining({ element: 'button#btn2' }),
            ]),
          }),
        })
      )
    }, 60000)

    it('detects keyboard trap and reports as violation', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      // Simulate multiple tabs that create a cycle
      const tabActions = Array(10).fill(null).map(() => ({
        type: 'tab' as const,
        reason: 'Tab to next',
      }))

      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'navigate',
          target: 'https://example.com',
          reason: 'Navigate',
        })
      tabActions.forEach(() => {
        mockGenerateAction.mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab to next',
        })
      })
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'checkTrap',
          reason: 'Check for trap',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Complete',
        })

      const mockExecuteAction = vi.mocked(tools.executeAction)
      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Navigated',
        })
      // Simulate cycling through 2 elements repeatedly
      for (let i = 0; i < 10; i++) {
        const element = i % 2 === 0 ? 'button#a' : 'button#b'
        mockExecuteAction.mockResolvedValueOnce({
          success: true,
          observation: `Focused on: ${element}`,
          focusedElement: element,
        })
      }
      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Keyboard trap detected (WCAG 2.1.2 violation)',
          trapDetected: true,
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const agent = new Agent('test-api-key')
      const result = await agent.run('Test keyboard trap', {
        startUrl: 'https://example.com',
      })

      expect(result.success).toBe(true)
      // Trap detection result should be captured in violations or accessible
      expect(result.trapDetected).toBe(true)
    }, 60000)

    it('resets focus history between runs', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      const mockExecuteAction = vi.mocked(tools.executeAction)

      // First run
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Done',
        })

      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: button#first-run',
          focusedElement: 'button#first-run',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const agent = new Agent('test-api-key')
      const result1 = await agent.run('First run', {
        startUrl: 'https://example.com',
      })

      expect(result1.focusHistory).toHaveLength(1)
      expect(result1.focusHistory![0].element).toBe('button#first-run')

      // Reset mocks for second run
      vi.clearAllMocks()

      // Second run
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Done',
        })

      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: button#second-run',
          focusedElement: 'button#second-run',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const result2 = await agent.run('Second run', {
        startUrl: 'https://example.com',
      })

      // Should only have the second run's focus history
      expect(result2.focusHistory).toHaveLength(1)
      expect(result2.focusHistory![0].element).toBe('button#second-run')
    }, 60000)
  })

  describe('dynamic WCAG evaluation integration', () => {
    it('records interaction events during actions and includes them in result', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'navigate',
          target: 'https://example.com',
          reason: 'Navigate to page',
        })
        .mockResolvedValueOnce({
          type: 'click',
          target: 'button#submit',
          reason: 'Click submit button',
        })
        .mockResolvedValueOnce({
          type: 'fill',
          target: 'input#email',
          value: 'test@example.com',
          reason: 'Fill email field',
        })
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab to next element',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Complete',
        })

      const mockExecuteAction = vi.mocked(tools.executeAction)
      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Navigated to page',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Clicked button',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Filled email',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: input#password',
          focusedElement: 'input#password',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const agent = new Agent('test-api-key')
      const result = await agent.run('Test dynamic evaluation', {
        startUrl: 'https://example.com',
      })

      expect(result.success).toBe(true)
      // Should have dynamicViolations field (empty array if no violations detected)
      expect(result.dynamicViolations).toBeDefined()
      expect(Array.isArray(result.dynamicViolations)).toBe(true)
    }, 60000)

    it('detects dynamic WCAG violations during navigation', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      // Simulate a pattern that triggers context change on focus (3.2.1 violation)
      // This happens when a navigate event immediately follows a focus event
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab to link',
        })
        .mockResolvedValueOnce({
          type: 'navigate',
          target: 'https://example.com/other',
          reason: 'Navigate away',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Complete',
        })

      const mockExecuteAction = vi.mocked(tools.executeAction)
      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: a#auto-nav "Auto-navigate link"',
          focusedElement: 'a#auto-nav "Auto-navigate link"',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Navigated to other page',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const agent = new Agent('test-api-key')
      const result = await agent.run('Test context change detection', {
        startUrl: 'https://example.com',
      })

      expect(result.success).toBe(true)
      expect(result.dynamicViolations).toBeDefined()
      // Should detect 3.2.1 violation (context change on focus)
      expect(result.dynamicViolations!.length).toBeGreaterThanOrEqual(1)
      const contextChangeViolation = result.dynamicViolations!.find(
        (v) => v.criterion === '3.2.1'
      )
      expect(contextChangeViolation).toBeDefined()
      expect(contextChangeViolation!.description).toContain('Context change')
    }, 60000)

    it('detects focus cycling violations (2.4.3)', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      // Simulate focus cycling - focus returns to same element within short sequence
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab 1',
        })
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab 2',
        })
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab 3',
        })
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab 4 - back to first',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Complete',
        })

      const mockExecuteAction = vi.mocked(tools.executeAction)
      // Cycle through elements: A -> B -> C -> A (cycling)
      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: button#A',
          focusedElement: 'button#A',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: button#B',
          focusedElement: 'button#B',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: button#C',
          focusedElement: 'button#C',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: button#A',
          focusedElement: 'button#A',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const agent = new Agent('test-api-key')
      const result = await agent.run('Test focus cycling detection', {
        startUrl: 'https://example.com',
      })

      expect(result.success).toBe(true)
      expect(result.dynamicViolations).toBeDefined()
      // Should detect 2.4.3 violation (focus cycling)
      const focusCyclingViolation = result.dynamicViolations!.find(
        (v) => v.criterion === '2.4.3'
      )
      expect(focusCyclingViolation).toBeDefined()
      expect(focusCyclingViolation!.description).toContain('Focus cycling')
    }, 60000)

    it('resets dynamic evaluator between runs', async () => {
      const mockGenerateAction = vi.mocked(openai.generateAction)
      const mockExecuteAction = vi.mocked(tools.executeAction)

      // First run - trigger a violation
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'tab',
          reason: 'Tab',
        })
        .mockResolvedValueOnce({
          type: 'navigate',
          target: 'https://example.com/other',
          reason: 'Navigate',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Done',
        })

      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Focused on: link#nav',
          focusedElement: 'link#nav',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Navigated',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const agent = new Agent('test-api-key')
      const result1 = await agent.run('First run with violation', {
        startUrl: 'https://example.com',
      })

      expect(result1.dynamicViolations!.length).toBeGreaterThan(0)

      // Reset mocks for second run
      vi.clearAllMocks()

      // Second run - no violations
      mockGenerateAction
        .mockResolvedValueOnce({
          type: 'click',
          target: 'button#ok',
          reason: 'Click',
        })
        .mockResolvedValueOnce({
          type: 'done',
          reason: 'Done',
        })

      mockExecuteAction
        .mockResolvedValueOnce({
          success: true,
          observation: 'Clicked',
        })
        .mockResolvedValueOnce({
          success: true,
          observation: 'Done',
        })

      const result2 = await agent.run('Second run without violation', {
        startUrl: 'https://example.com',
      })

      // Second run should NOT have violations from the first run
      expect(result2.dynamicViolations).toBeDefined()
      expect(result2.dynamicViolations!.length).toBe(0)
    }, 60000)
  })
})
