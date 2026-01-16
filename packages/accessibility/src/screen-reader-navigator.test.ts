import { describe, it, expect } from 'vitest'
import { NavigatorState, NavigationResult, NavigableNode } from './types.js'

describe('Screen Reader Navigator Types', () => {
  it('should have NavigableNode type with required fields', () => {
    const node: NavigableNode = {
      role: 'button',
      name: 'Submit',
      value: null,
      level: undefined,
      children: [],
      isInteresting: true,
    }
    expect(node.role).toBe('button')
    expect(node.name).toBe('Submit')
    expect(node.isInteresting).toBe(true)
  })

  it('should have NavigatorState type', () => {
    const state: NavigatorState = {
      currentIndex: 0,
      nodes: [],
      mode: 'browse',
    }
    expect(state.mode).toBe('browse')
  })

  it('should have NavigationResult type', () => {
    const result: NavigationResult = {
      success: true,
      node: null,
      message: 'End of page',
    }
    expect(result.success).toBe(true)
  })
})
