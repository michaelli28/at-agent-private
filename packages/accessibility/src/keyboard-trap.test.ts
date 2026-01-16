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
import { KeyboardTrapDetector } from './keyboard-trap-detector.js'

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

describe('KeyboardTrapDetector', () => {
  describe('constructor', () => {
    it('uses default config if none provided', () => {
      const detector = new KeyboardTrapDetector()

      // Verify defaults by checking behavior - maxHistorySize defaults to 50
      // Record more than default maxHistorySize elements
      for (let i = 0; i < 60; i++) {
        detector.recordFocus(`element-${i}`)
      }
      const history = detector.getHistory()
      expect(history.length).toBe(50) // default maxHistorySize
    })

    it('accepts custom config', () => {
      const detector = new KeyboardTrapDetector({
        minCycleCount: 3,
        maxHistorySize: 20,
      })

      for (let i = 0; i < 30; i++) {
        detector.recordFocus(`element-${i}`)
      }
      const history = detector.getHistory()
      expect(history.length).toBe(20)
    })
  })

  describe('recordFocus', () => {
    it('adds focus event to history', () => {
      const detector = new KeyboardTrapDetector()

      detector.recordFocus('button#submit')
      const history = detector.getHistory()

      expect(history.length).toBe(1)
      expect(history[0].element).toBe('button#submit')
      expect(typeof history[0].timestamp).toBe('number')
    })

    it('maintains order of focus events', () => {
      const detector = new KeyboardTrapDetector()

      detector.recordFocus('input#first')
      detector.recordFocus('input#second')
      detector.recordFocus('button#third')

      const history = detector.getHistory()
      expect(history.map(e => e.element)).toEqual([
        'input#first',
        'input#second',
        'button#third',
      ])
    })
  })

  describe('detectTrap', () => {
    it('returns no trap for empty history', () => {
      const detector = new KeyboardTrapDetector()

      const result = detector.detectTrap()

      expect(result.trapped).toBe(false)
      expect(result.element).toBeNull()
      expect(result.cycleLength).toBe(0)
      expect(result.wcagCriterion).toBe('2.1.2')
    })

    it('returns no trap for varied focus sequence', () => {
      const detector = new KeyboardTrapDetector()

      const elements = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
      elements.forEach(el => detector.recordFocus(el))

      const result = detector.detectTrap()

      expect(result.trapped).toBe(false)
      expect(result.element).toBeNull()
      expect(result.cycleLength).toBe(0)
    })

    it('returns trap when same cycle repeats minCycleCount times', () => {
      const detector = new KeyboardTrapDetector({ minCycleCount: 5 })

      // Cycle: A -> B -> C repeated 5 times = 15 focus events
      const cycle = ['A', 'B', 'C']
      for (let i = 0; i < 5; i++) {
        cycle.forEach(el => detector.recordFocus(el))
      }

      const result = detector.detectTrap()

      expect(result.trapped).toBe(true)
      expect(result.element).toBe('A')
      expect(result.cycleLength).toBe(3)
      expect(result.wcagCriterion).toBe('2.1.2')
    })

    it('detects trap with cycle of length 2', () => {
      const detector = new KeyboardTrapDetector({ minCycleCount: 5 })

      // Cycle: X -> Y repeated 5 times
      for (let i = 0; i < 5; i++) {
        detector.recordFocus('X')
        detector.recordFocus('Y')
      }

      const result = detector.detectTrap()

      expect(result.trapped).toBe(true)
      expect(result.cycleLength).toBe(2)
    })

    it('does not detect trap when cycle repeats fewer than minCycleCount times', () => {
      const detector = new KeyboardTrapDetector({ minCycleCount: 5 })

      // Cycle: A -> B -> C repeated only 4 times
      const cycle = ['A', 'B', 'C']
      for (let i = 0; i < 4; i++) {
        cycle.forEach(el => detector.recordFocus(el))
      }

      const result = detector.detectTrap()

      expect(result.trapped).toBe(false)
    })

    it('detects single element trap', () => {
      const detector = new KeyboardTrapDetector({ minCycleCount: 5 })

      // Same element focused 5+ times in a row (focus stuck on one element)
      for (let i = 0; i < 5; i++) {
        detector.recordFocus('stuck-button')
      }

      const result = detector.detectTrap()

      expect(result.trapped).toBe(true)
      expect(result.element).toBe('stuck-button')
      expect(result.cycleLength).toBe(1)
    })
  })

  describe('getHistory', () => {
    it('returns copy of history', () => {
      const detector = new KeyboardTrapDetector()
      detector.recordFocus('element-a')

      const history1 = detector.getHistory()
      const history2 = detector.getHistory()

      expect(history1).not.toBe(history2)
      expect(history1).toEqual(history2)
    })
  })

  describe('reset', () => {
    it('clears history', () => {
      const detector = new KeyboardTrapDetector()

      detector.recordFocus('element-1')
      detector.recordFocus('element-2')
      expect(detector.getHistory().length).toBe(2)

      detector.reset()

      expect(detector.getHistory().length).toBe(0)
    })

    it('allows recording new events after reset', () => {
      const detector = new KeyboardTrapDetector()

      detector.recordFocus('old-element')
      detector.reset()
      detector.recordFocus('new-element')

      const history = detector.getHistory()
      expect(history.length).toBe(1)
      expect(history[0].element).toBe('new-element')
    })
  })

  describe('history size management', () => {
    it('respects maxHistorySize by removing oldest events', () => {
      const detector = new KeyboardTrapDetector({ maxHistorySize: 5 })

      detector.recordFocus('element-1')
      detector.recordFocus('element-2')
      detector.recordFocus('element-3')
      detector.recordFocus('element-4')
      detector.recordFocus('element-5')
      detector.recordFocus('element-6')
      detector.recordFocus('element-7')

      const history = detector.getHistory()

      expect(history.length).toBe(5)
      expect(history[0].element).toBe('element-3')
      expect(history[4].element).toBe('element-7')
    })
  })
})
