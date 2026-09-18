import { describe, it, expect } from 'vitest'
import {
  InteractionEventSchema,
  InteractionTraceSchema,
  DynamicViolationSchema,
  DynamicEvaluationResultSchema,
  DynamicEvaluatorConfigSchema,
  type InteractionEvent,
  type InteractionTrace,
  type DynamicViolation,
  type DynamicEvaluationResult,
  type DynamicEvaluatorConfig,
} from './types.js'

describe('Dynamic WCAG Evaluation Types', () => {
  describe('InteractionEventSchema', () => {
    it('validates a focus event', () => {
      const event: InteractionEvent = {
        type: 'focus',
        element: 'button#submit',
        timestamp: 1705312800000,
      }
      const parsed = InteractionEventSchema.parse(event)
      expect(parsed.type).toBe('focus')
      expect(parsed.element).toBe('button#submit')
      expect(parsed.timestamp).toBe(1705312800000)
    })

    it('validates a click event', () => {
      const event: InteractionEvent = {
        type: 'click',
        element: 'a.nav-link',
        timestamp: 1705312801000,
      }
      const parsed = InteractionEventSchema.parse(event)
      expect(parsed.type).toBe('click')
      expect(parsed.element).toBe('a.nav-link')
    })

    it('validates an input event', () => {
      const event: InteractionEvent = {
        type: 'input',
        element: 'input#email',
        timestamp: 1705312802000,
      }
      const parsed = InteractionEventSchema.parse(event)
      expect(parsed.type).toBe('input')
    })

    it('validates a navigate event with null element', () => {
      const event: InteractionEvent = {
        type: 'navigate',
        element: null,
        timestamp: 1705312803000,
      }
      const parsed = InteractionEventSchema.parse(event)
      expect(parsed.type).toBe('navigate')
      expect(parsed.element).toBeNull()
    })

    it('validates event with metadata', () => {
      const event: InteractionEvent = {
        type: 'focus',
        element: 'div.modal',
        timestamp: 1705312804000,
        metadata: { previousElement: 'button#open', focusVisible: true },
      }
      const parsed = InteractionEventSchema.parse(event)
      expect(parsed.metadata).toEqual({ previousElement: 'button#open', focusVisible: true })
    })

    it('rejects invalid event type', () => {
      expect(() =>
        InteractionEventSchema.parse({
          type: 'hover',
          element: 'div',
          timestamp: 1705312800000,
        })
      ).toThrow()
    })

    it('rejects event without timestamp', () => {
      expect(() =>
        InteractionEventSchema.parse({
          type: 'focus',
          element: 'button',
        })
      ).toThrow()
    })
  })

  describe('InteractionTraceSchema', () => {
    it('validates a sequence of interaction events', () => {
      const trace: InteractionTrace = [
        { type: 'focus', element: 'input#name', timestamp: 1705312800000 },
        { type: 'input', element: 'input#name', timestamp: 1705312801000 },
        { type: 'focus', element: 'input#email', timestamp: 1705312802000 },
        { type: 'click', element: 'button#submit', timestamp: 1705312803000 },
      ]
      const parsed = InteractionTraceSchema.parse(trace)
      expect(parsed).toHaveLength(4)
      expect(parsed[0].type).toBe('focus')
      expect(parsed[3].element).toBe('button#submit')
    })

    it('validates an empty trace', () => {
      const trace: InteractionTrace = []
      const parsed = InteractionTraceSchema.parse(trace)
      expect(parsed).toHaveLength(0)
    })
  })

  describe('DynamicViolationSchema', () => {
    it('validates a focus order violation (WCAG 2.4.3)', () => {
      const violation: DynamicViolation = {
        criterion: '2.4.3',
        description: 'Focus moved to an unexpected element, breaking logical focus order',
        severity: 'serious',
        evidence: [
          { type: 'focus', element: 'input#first', timestamp: 1705312800000 },
          { type: 'focus', element: 'button#last', timestamp: 1705312801000 },
        ],
      }
      const parsed = DynamicViolationSchema.parse(violation)
      expect(parsed.criterion).toBe('2.4.3')
      expect(parsed.severity).toBe('serious')
      expect(parsed.evidence).toHaveLength(2)
    })

    it('validates a focus indicator violation (WCAG 2.4.7)', () => {
      const violation: DynamicViolation = {
        criterion: '2.4.7',
        description: 'Focused element lacks visible focus indicator',
        severity: 'serious',
        evidence: [
          { type: 'focus', element: 'a.nav-link', timestamp: 1705312800000, metadata: { focusVisible: false } },
        ],
      }
      const parsed = DynamicViolationSchema.parse(violation)
      expect(parsed.criterion).toBe('2.4.7')
    })

    it('validates a context change violation (WCAG 3.2.1)', () => {
      const violation: DynamicViolation = {
        criterion: '3.2.1',
        description: 'Context changed unexpectedly on focus',
        severity: 'critical',
        evidence: [
          { type: 'focus', element: 'select#country', timestamp: 1705312800000 },
          { type: 'navigate', element: null, timestamp: 1705312801000 },
        ],
      }
      const parsed = DynamicViolationSchema.parse(violation)
      expect(parsed.criterion).toBe('3.2.1')
      expect(parsed.severity).toBe('critical')
    })

    it('validates all severity levels', () => {
      const severities = ['critical', 'serious', 'moderate', 'minor'] as const
      severities.forEach((severity) => {
        const violation: DynamicViolation = {
          criterion: '2.4.3',
          description: 'Test violation',
          severity,
          evidence: [],
        }
        const parsed = DynamicViolationSchema.parse(violation)
        expect(parsed.severity).toBe(severity)
      })
    })

    it('rejects invalid severity', () => {
      expect(() =>
        DynamicViolationSchema.parse({
          criterion: '2.4.3',
          description: 'Test',
          severity: 'high',
          evidence: [],
        })
      ).toThrow()
    })

    it('rejects violation without criterion', () => {
      expect(() =>
        DynamicViolationSchema.parse({
          description: 'Test',
          severity: 'serious',
          evidence: [],
        })
      ).toThrow()
    })
  })

  describe('DynamicEvaluationResultSchema', () => {
    it('validates a complete evaluation result with violations', () => {
      const result: DynamicEvaluationResult = {
        violations: [
          {
            criterion: '2.4.3',
            description: 'Focus order issue',
            severity: 'serious',
            evidence: [{ type: 'focus', element: 'button', timestamp: 1705312800000 }],
          },
        ],
        trace: [
          { type: 'focus', element: 'input', timestamp: 1705312799000 },
          { type: 'focus', element: 'button', timestamp: 1705312800000 },
        ],
        evaluatedAt: 1705312900000,
      }
      const parsed = DynamicEvaluationResultSchema.parse(result)
      expect(parsed.violations).toHaveLength(1)
      expect(parsed.trace).toHaveLength(2)
      expect(parsed.evaluatedAt).toBe(1705312900000)
    })

    it('validates a result with no violations', () => {
      const result: DynamicEvaluationResult = {
        violations: [],
        trace: [
          { type: 'focus', element: 'input#name', timestamp: 1705312800000 },
          { type: 'focus', element: 'input#email', timestamp: 1705312801000 },
        ],
        evaluatedAt: 1705312900000,
      }
      const parsed = DynamicEvaluationResultSchema.parse(result)
      expect(parsed.violations).toHaveLength(0)
      expect(parsed.trace).toHaveLength(2)
    })

    it('rejects result without evaluatedAt timestamp', () => {
      expect(() =>
        DynamicEvaluationResultSchema.parse({
          violations: [],
          trace: [],
        })
      ).toThrow()
    })
  })

  describe('DynamicEvaluatorConfigSchema', () => {
    it('validates config with all options enabled', () => {
      const config: DynamicEvaluatorConfig = {
        checkFocusOrder: true,
        checkFocusIndicator: true,
        checkContextChanges: true,
      }
      const parsed = DynamicEvaluatorConfigSchema.parse(config)
      expect(parsed.checkFocusOrder).toBe(true)
      expect(parsed.checkFocusIndicator).toBe(true)
      expect(parsed.checkContextChanges).toBe(true)
    })

    it('validates config with all options disabled', () => {
      const config: DynamicEvaluatorConfig = {
        checkFocusOrder: false,
        checkFocusIndicator: false,
        checkContextChanges: false,
      }
      const parsed = DynamicEvaluatorConfigSchema.parse(config)
      expect(parsed.checkFocusOrder).toBe(false)
      expect(parsed.checkFocusIndicator).toBe(false)
      expect(parsed.checkContextChanges).toBe(false)
    })

    it('validates config with mixed options', () => {
      const config: DynamicEvaluatorConfig = {
        checkFocusOrder: true,
        checkFocusIndicator: false,
        checkContextChanges: true,
      }
      const parsed = DynamicEvaluatorConfigSchema.parse(config)
      expect(parsed.checkFocusOrder).toBe(true)
      expect(parsed.checkFocusIndicator).toBe(false)
      expect(parsed.checkContextChanges).toBe(true)
    })

    it('rejects config missing required options', () => {
      expect(() =>
        DynamicEvaluatorConfigSchema.parse({
          checkFocusOrder: true,
        })
      ).toThrow()
    })
  })
})

// Tests for DynamicEvaluator class
import { DynamicEvaluator } from './dynamic-evaluator.js'

// Factory for creating test events
const createFocusEvent = (
  element: string,
  overrides?: Partial<Omit<InteractionEvent, 'type' | 'timestamp'>>
): Omit<InteractionEvent, 'timestamp'> => ({
  type: 'focus',
  element,
  ...overrides,
})

const createNavigateEvent = (
  element: string | null = null
): Omit<InteractionEvent, 'timestamp'> => ({
  type: 'navigate',
  element,
})

const createClickEvent = (
  element: string
): Omit<InteractionEvent, 'timestamp'> => ({
  type: 'click',
  element,
})

describe('DynamicEvaluator', () => {
  describe('constructor', () => {
    it('uses default config with all checks enabled', () => {
      const evaluator = new DynamicEvaluator()

      // Verify default config by checking that all checks run
      // Record events that would trigger violations if checks are enabled
      evaluator.recordEvent(createFocusEvent('button-1'))
      evaluator.recordEvent(createNavigateEvent())

      const result = evaluator.evaluate()

      // Context change check is enabled by default, so should detect violation
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.violations.some(v => v.criterion === '3.2.1')).toBe(true)
    })
  })

  describe('recordEvent', () => {
    it('adds event to trace with timestamp', () => {
      const evaluator = new DynamicEvaluator()
      const beforeRecord = Date.now()

      evaluator.recordEvent(createFocusEvent('button-1'))

      const trace = evaluator.getTrace()
      expect(trace).toHaveLength(1)
      expect(trace[0].type).toBe('focus')
      expect(trace[0].element).toBe('button-1')
      expect(trace[0].timestamp).toBeGreaterThanOrEqual(beforeRecord)
      expect(trace[0].timestamp).toBeLessThanOrEqual(Date.now())
    })

    it('preserves metadata when provided', () => {
      const evaluator = new DynamicEvaluator()

      evaluator.recordEvent({
        type: 'click',
        element: 'submit-btn',
        metadata: { screenX: 100, screenY: 200 },
      })

      const trace = evaluator.getTrace()
      expect(trace[0].metadata).toEqual({ screenX: 100, screenY: 200 })
    })
  })

  describe('evaluate', () => {
    it('returns no violations for clean trace', () => {
      const evaluator = new DynamicEvaluator()

      // Record normal interaction flow: focus different elements, then navigate on click
      evaluator.recordEvent(createFocusEvent('input-1'))
      evaluator.recordEvent(createFocusEvent('input-2'))
      evaluator.recordEvent(createFocusEvent('submit-btn'))
      evaluator.recordEvent(createClickEvent('submit-btn'))
      evaluator.recordEvent(createNavigateEvent())

      const result = evaluator.evaluate()

      expect(result.violations).toHaveLength(0)
      expect(result.trace).toHaveLength(5)
      expect(typeof result.evaluatedAt).toBe('number')
    })

    it('detects focus cycling violation (WCAG 2.4.3)', () => {
      const evaluator = new DynamicEvaluator()

      // Focus same element multiple times within 5 focus events
      evaluator.recordEvent(createFocusEvent('button-1'))
      evaluator.recordEvent(createFocusEvent('button-2'))
      evaluator.recordEvent(createFocusEvent('button-1')) // Repeat within window

      const result = evaluator.evaluate()

      expect(result.violations.some(v => v.criterion === '2.4.3')).toBe(true)
      const focusViolation = result.violations.find(v => v.criterion === '2.4.3')
      expect(focusViolation?.description).toContain('focus')
      expect(focusViolation?.evidence.length).toBeGreaterThan(0)
    })

    it('detects context change on focus violation (WCAG 3.2.1)', () => {
      const evaluator = new DynamicEvaluator()

      // Focus causes navigation (on-focus context change)
      evaluator.recordEvent(createFocusEvent('auto-nav-link'))
      evaluator.recordEvent(createNavigateEvent())

      const result = evaluator.evaluate()

      expect(result.violations.some(v => v.criterion === '3.2.1')).toBe(true)
      const contextViolation = result.violations.find(v => v.criterion === '3.2.1')
      expect(contextViolation?.description.toLowerCase()).toContain('context')
      expect(contextViolation?.severity).toBe('serious')
    })

    it('respects config - disabled checks do not fire', () => {
      const config: DynamicEvaluatorConfig = {
        checkFocusOrder: false,
        checkFocusIndicator: false,
        checkContextChanges: false,
      }
      const evaluator = new DynamicEvaluator(config)

      // Record events that would trigger violations if checks were enabled
      evaluator.recordEvent(createFocusEvent('button-1'))
      evaluator.recordEvent(createFocusEvent('button-2'))
      evaluator.recordEvent(createFocusEvent('button-1')) // Would be focus cycling
      evaluator.recordEvent(createNavigateEvent()) // Would be context change if focus came before

      const result = evaluator.evaluate()

      expect(result.violations).toHaveLength(0)
    })

    it('includes trace and evaluatedAt in result', () => {
      const evaluator = new DynamicEvaluator()
      const beforeEvaluate = Date.now()

      evaluator.recordEvent(createFocusEvent('element-1'))

      const result = evaluator.evaluate()

      expect(result.trace).toHaveLength(1)
      expect(result.evaluatedAt).toBeGreaterThanOrEqual(beforeEvaluate)
    })
  })

  describe('getTrace', () => {
    it('returns copy of trace (not reference)', () => {
      const evaluator = new DynamicEvaluator()
      evaluator.recordEvent(createFocusEvent('button-1'))

      const trace1 = evaluator.getTrace()
      const trace2 = evaluator.getTrace()

      expect(trace1).toEqual(trace2)
      expect(trace1).not.toBe(trace2) // Different references

      // Modifying returned trace should not affect internal state
      trace1.push({
        type: 'click',
        element: 'fake',
        timestamp: 0,
      })

      expect(evaluator.getTrace()).toHaveLength(1)
    })
  })

  describe('reset', () => {
    it('clears trace', () => {
      const evaluator = new DynamicEvaluator()
      evaluator.recordEvent(createFocusEvent('button-1'))
      evaluator.recordEvent(createFocusEvent('button-2'))

      expect(evaluator.getTrace()).toHaveLength(2)

      evaluator.reset()

      expect(evaluator.getTrace()).toHaveLength(0)
    })
  })
})
