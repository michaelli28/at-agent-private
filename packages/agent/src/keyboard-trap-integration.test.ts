import { describe, it, expect, vi } from 'vitest'
import { BrowserPage } from '@at-agent/browser'
import { executeAction } from './tools.js'
import type { Action } from './types.js'

// Tests for keyboard trap detection integration
// WCAG 2.1.2 - No Keyboard Trap

describe('Keyboard Trap Detection Integration', () => {
  describe('tab action', () => {
    function createMockPage() {
      return {
        playwrightPage: {
          keyboard: {
            press: vi.fn(),
          },
          evaluate: vi.fn(),
        },
        goto: vi.fn(),
        title: vi.fn().mockResolvedValue('Test Page'),
        url: vi.fn().mockResolvedValue('https://example.com'),
        accessibilityTree: vi.fn().mockResolvedValue({ role: 'document', name: 'Test' }),
      } as unknown as BrowserPage
    }

    it('executes tab action and returns focused element', async () => {
      const mockPage = createMockPage()
      const evaluateMock = mockPage.playwrightPage.evaluate as ReturnType<typeof vi.fn>
      evaluateMock.mockResolvedValue('button#submit')

      const action: Action = {
        type: 'tab',
        reason: 'Navigate to next focusable element',
      }

      const result = await executeAction(action, mockPage)

      expect(result.success).toBe(true)
      expect(result.observation).toContain('Focused on')
      expect(result.focusedElement).toBe('button#submit')
      expect(mockPage.playwrightPage.keyboard.press).toHaveBeenCalledWith('Tab')
    })

    it('executes shift+tab action when target is "previous"', async () => {
      const mockPage = createMockPage()
      const evaluateMock = mockPage.playwrightPage.evaluate as ReturnType<typeof vi.fn>
      evaluateMock.mockResolvedValue('input#email')

      const action: Action = {
        type: 'tab',
        target: 'previous',
        reason: 'Navigate to previous focusable element',
      }

      const result = await executeAction(action, mockPage)

      expect(result.success).toBe(true)
      expect(mockPage.playwrightPage.keyboard.press).toHaveBeenCalledWith('Shift+Tab')
    })

    it('executes multiple tabs when count is specified', async () => {
      const mockPage = createMockPage()
      const evaluateMock = mockPage.playwrightPage.evaluate as ReturnType<typeof vi.fn>
      evaluateMock.mockResolvedValue('button#third')

      const action: Action = {
        type: 'tab',
        value: '3',
        reason: 'Tab 3 times',
      }

      const result = await executeAction(action, mockPage)

      expect(result.success).toBe(true)
      expect(mockPage.playwrightPage.keyboard.press).toHaveBeenCalledTimes(3)
    })

    it('returns failure when keyboard action fails', async () => {
      const mockPage = createMockPage()
      const pressMock = mockPage.playwrightPage.keyboard.press as ReturnType<typeof vi.fn>
      pressMock.mockRejectedValue(new Error('Keyboard error'))

      const action: Action = {
        type: 'tab',
        reason: 'Tab forward',
      }

      const result = await executeAction(action, mockPage)

      expect(result.success).toBe(false)
      expect(result.observation).toContain('Tab failed')
    })
  })

  describe('checkTrap action', () => {
    function createMockPage() {
      return {
        playwrightPage: {
          keyboard: {
            press: vi.fn(),
          },
          evaluate: vi.fn(),
        },
      } as unknown as BrowserPage
    }

    it('executes checkTrap action and returns trap detection result', async () => {
      const mockPage = createMockPage()

      const action: Action = {
        type: 'checkTrap',
        reason: 'Check for keyboard traps',
      }

      // Pass trap detector context to executeAction
      const trapContext = {
        focusHistory: [
          { element: 'button#a', timestamp: 1 },
          { element: 'button#b', timestamp: 2 },
          { element: 'button#a', timestamp: 3 },
          { element: 'button#b', timestamp: 4 },
          { element: 'button#a', timestamp: 5 },
          { element: 'button#b', timestamp: 6 },
          { element: 'button#a', timestamp: 7 },
          { element: 'button#b', timestamp: 8 },
          { element: 'button#a', timestamp: 9 },
          { element: 'button#b', timestamp: 10 },
        ],
      }

      const result = await executeAction(action, mockPage, { trapContext })

      expect(result.success).toBe(true)
      expect(result.trapDetected).toBe(true)
      expect(result.observation).toContain('trap')
      expect(result.observation).toContain('WCAG 2.1.2')
    })

    it('returns no trap when focus history is varied', async () => {
      const mockPage = createMockPage()

      const action: Action = {
        type: 'checkTrap',
        reason: 'Check for keyboard traps',
      }

      const trapContext = {
        focusHistory: [
          { element: 'button#a', timestamp: 1 },
          { element: 'button#b', timestamp: 2 },
          { element: 'button#c', timestamp: 3 },
          { element: 'button#d', timestamp: 4 },
          { element: 'button#e', timestamp: 5 },
        ],
      }

      const result = await executeAction(action, mockPage, { trapContext })

      expect(result.success).toBe(true)
      expect(result.trapDetected).toBe(false)
      expect(result.observation).toContain('No keyboard trap detected')
    })
  })
})
