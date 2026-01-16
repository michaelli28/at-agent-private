import type { FocusEvent, FocusHistory, TrapDetectionResult, TrapDetectionConfig } from './types.js'

const DEFAULT_CONFIG: TrapDetectionConfig = {
  minCycleCount: 5,
  maxHistorySize: 50,
}

export class KeyboardTrapDetector {
  private readonly config: TrapDetectionConfig
  private history: FocusHistory = []

  constructor(config?: Partial<TrapDetectionConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    }
  }

  recordFocus(element: string): void {
    const event: FocusEvent = {
      element,
      timestamp: Date.now(),
    }
    this.history.push(event)

    if (this.history.length > this.config.maxHistorySize) {
      this.history = this.history.slice(-this.config.maxHistorySize)
    }
  }

  detectTrap(): TrapDetectionResult {
    const noTrap: TrapDetectionResult = {
      trapped: false,
      element: null,
      cycleLength: 0,
      wcagCriterion: '2.1.2',
    }

    if (this.history.length < this.config.minCycleCount) {
      return noTrap
    }

    const elements = this.history.map(e => e.element)

    for (let cycleLength = 1; cycleLength <= Math.floor(elements.length / this.config.minCycleCount); cycleLength++) {
      if (this.detectCycleOfLength(elements, cycleLength)) {
        return {
          trapped: true,
          element: elements[elements.length - cycleLength],
          cycleLength,
          wcagCriterion: '2.1.2',
        }
      }
    }

    return noTrap
  }

  private detectCycleOfLength(elements: string[], cycleLength: number): boolean {
    const requiredLength = cycleLength * this.config.minCycleCount
    if (elements.length < requiredLength) {
      return false
    }

    const recentElements = elements.slice(-requiredLength)
    const cycle = recentElements.slice(0, cycleLength)

    for (let i = 0; i < this.config.minCycleCount; i++) {
      const startIndex = i * cycleLength
      for (let j = 0; j < cycleLength; j++) {
        if (recentElements[startIndex + j] !== cycle[j]) {
          return false
        }
      }
    }

    return true
  }

  getHistory(): FocusHistory {
    return [...this.history]
  }

  reset(): void {
    this.history = []
  }
}
