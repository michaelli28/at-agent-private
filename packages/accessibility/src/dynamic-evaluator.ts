import type {
  InteractionEvent,
  InteractionTrace,
  DynamicViolation,
  DynamicEvaluationResult,
  DynamicEvaluatorConfig,
} from './types.js'

const DEFAULT_CONFIG: DynamicEvaluatorConfig = {
  checkFocusOrder: true,
  checkFocusIndicator: true,
  checkContextChanges: true,
}

const FOCUS_WINDOW_SIZE = 5

export class DynamicEvaluator {
  private readonly config: DynamicEvaluatorConfig
  private trace: InteractionTrace = []

  constructor(config?: Partial<DynamicEvaluatorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  recordEvent(event: Omit<InteractionEvent, 'timestamp'>): void {
    const eventWithTimestamp: InteractionEvent = {
      ...event,
      timestamp: Date.now(),
    }
    this.trace = [...this.trace, eventWithTimestamp]
  }

  evaluate(): DynamicEvaluationResult {
    const violations: DynamicViolation[] = []

    if (this.config.checkFocusOrder) {
      const focusOrderViolations = this.checkFocusOrder()
      violations.push(...focusOrderViolations)
    }

    if (this.config.checkContextChanges) {
      const contextViolations = this.checkContextChanges()
      violations.push(...contextViolations)
    }

    return {
      violations,
      trace: this.getTrace(),
      evaluatedAt: Date.now(),
    }
  }

  getTrace(): InteractionTrace {
    return [...this.trace]
  }

  reset(): void {
    this.trace = []
  }

  private checkFocusOrder(): DynamicViolation[] {
    const violations: DynamicViolation[] = []
    const focusEvents = this.trace.filter(e => e.type === 'focus')

    for (let i = 0; i < focusEvents.length; i++) {
      const windowStart = Math.max(0, i - FOCUS_WINDOW_SIZE + 1)
      const window = focusEvents.slice(windowStart, i)
      const currentElement = focusEvents[i].element

      const hasDuplicate = window.some(e => e.element === currentElement)
      if (hasDuplicate) {
        const evidence = [...window.filter(e => e.element === currentElement), focusEvents[i]]
        violations.push({
          criterion: '2.4.3',
          description: 'Focus cycling detected - focus returned to previously visited element within short sequence',
          severity: 'moderate',
          evidence,
        })
        break
      }
    }

    return violations
  }

  private checkContextChanges(): DynamicViolation[] {
    const violations: DynamicViolation[] = []

    for (let i = 1; i < this.trace.length; i++) {
      const current = this.trace[i]
      const previous = this.trace[i - 1]

      if (current.type === 'navigate' && previous.type === 'focus') {
        violations.push({
          criterion: '3.2.1',
          description: 'Context change on focus - navigation occurred immediately after focus event',
          severity: 'serious',
          evidence: [previous, current],
        })
      }
    }

    return violations
  }
}
