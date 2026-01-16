import { describe, it, expect } from 'vitest'
import {
  FocusEventSchema,
  FocusHistorySchema,
  TrapDetectionResultSchema,
  TrapDetectionConfigSchema,
  type FocusEvent,
  type FocusHistory,
  type TrapDetectionResult,
  type TrapDetectionConfig,
} from './types.js'

describe('Keyboard Trap Detection Types', () => {
  describe('FocusEventSchema', () => {
    it('validates a focus event with element info and timestamp', () => {
      const focusEvent: FocusEvent = {
        element: 'button#submit',
        timestamp: 1705312800000,
      }
      const parsed = FocusEventSchema.parse(focusEvent)
      expect(parsed.element).toBe('button#submit')
      expect(parsed.timestamp).toBe(1705312800000)
    })

    it('rejects focus event without element', () => {
      expect(() =>
        FocusEventSchema.parse({ timestamp: 1705312800000 })
      ).toThrow()
    })

    it('rejects focus event without timestamp', () => {
      expect(() =>
        FocusEventSchema.parse({ element: 'button#submit' })
      ).toThrow()
    })
  })

  describe('FocusHistorySchema', () => {
    it('validates an array of focus events', () => {
      const history: FocusHistory = [
        { element: 'input#name', timestamp: 1705312800000 },
        { element: 'input#email', timestamp: 1705312801000 },
        { element: 'button#submit', timestamp: 1705312802000 },
      ]
      const parsed = FocusHistorySchema.parse(history)
      expect(parsed).toHaveLength(3)
      expect(parsed[0].element).toBe('input#name')
    })

    it('validates an empty focus history', () => {
      const history: FocusHistory = []
      const parsed = FocusHistorySchema.parse(history)
      expect(parsed).toHaveLength(0)
    })
  })

  describe('TrapDetectionResultSchema', () => {
    it('validates a result when no trap is detected', () => {
      const result: TrapDetectionResult = {
        trapped: false,
        element: null,
        cycleLength: 0,
        wcagCriterion: '2.1.2',
      }
      const parsed = TrapDetectionResultSchema.parse(result)
      expect(parsed.trapped).toBe(false)
      expect(parsed.element).toBeNull()
      expect(parsed.cycleLength).toBe(0)
      expect(parsed.wcagCriterion).toBe('2.1.2')
    })

    it('validates a result when a trap is detected', () => {
      const result: TrapDetectionResult = {
        trapped: true,
        element: 'div.modal',
        cycleLength: 3,
        wcagCriterion: '2.1.2',
      }
      const parsed = TrapDetectionResultSchema.parse(result)
      expect(parsed.trapped).toBe(true)
      expect(parsed.element).toBe('div.modal')
      expect(parsed.cycleLength).toBe(3)
      expect(parsed.wcagCriterion).toBe('2.1.2')
    })

    it('requires wcagCriterion to be 2.1.2', () => {
      expect(() =>
        TrapDetectionResultSchema.parse({
          trapped: false,
          element: null,
          cycleLength: 0,
          wcagCriterion: '2.1.1',
        })
      ).toThrow()
    })
  })

  describe('TrapDetectionConfigSchema', () => {
    it('validates config with all options', () => {
      const config: TrapDetectionConfig = {
        minCycleCount: 5,
        maxHistorySize: 100,
      }
      const parsed = TrapDetectionConfigSchema.parse(config)
      expect(parsed.minCycleCount).toBe(5)
      expect(parsed.maxHistorySize).toBe(100)
    })

    it('provides default for minCycleCount', () => {
      const config = { maxHistorySize: 100 }
      const parsed = TrapDetectionConfigSchema.parse(config)
      expect(parsed.minCycleCount).toBe(5)
    })

    it('requires maxHistorySize', () => {
      expect(() => TrapDetectionConfigSchema.parse({})).toThrow()
    })
  })
})
