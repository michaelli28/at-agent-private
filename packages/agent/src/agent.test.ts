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
})
