import { describe, it, expect } from 'vitest'
import { NavigatorState, NavigationResult, NavigableNode } from './types.js'
import { ScreenReaderNavigator } from './screen-reader-navigator.js'
import type { AccessibilityNode } from '@at-agent/browser'

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

describe('ScreenReaderNavigator', () => {
  const mockTree: AccessibilityNode = {
    role: 'WebArea',
    name: 'Test Page',
    value: null,
    description: null,
    children: [
      {
        role: 'heading',
        name: 'Welcome',
        value: null,
        description: null,
        children: [],
      },
      {
        role: 'button',
        name: 'Click me',
        value: null,
        description: null,
        children: [],
      },
      {
        role: 'link',
        name: 'Learn more',
        value: null,
        description: null,
        children: [],
      },
    ],
  }

  it('should initialize with empty state', () => {
    const navigator = new ScreenReaderNavigator()
    expect(navigator.getCurrentNode()).toBeNull()
  })

  it('should load accessibility tree', () => {
    const navigator = new ScreenReaderNavigator()
    navigator.loadTree(mockTree)
    expect(navigator.getNodeCount()).toBeGreaterThan(0)
  })

  it('should move to next node', () => {
    const navigator = new ScreenReaderNavigator()
    navigator.loadTree(mockTree)

    const result = navigator.moveNext()
    expect(result.success).toBe(true)
    expect(result.node?.role).toBe('heading')
    expect(result.node?.name).toBe('Welcome')
  })

  it('should move to previous node', () => {
    const navigator = new ScreenReaderNavigator()
    navigator.loadTree(mockTree)

    navigator.moveNext() // heading
    navigator.moveNext() // button

    const result = navigator.movePrev()
    expect(result.success).toBe(true)
    expect(result.node?.role).toBe('heading')
  })

  it('should return failure at end of page', () => {
    const navigator = new ScreenReaderNavigator()
    navigator.loadTree(mockTree)

    navigator.moveNext() // heading
    navigator.moveNext() // button
    navigator.moveNext() // link

    const result = navigator.moveNext()
    expect(result.success).toBe(false)
    expect(result.message).toBe('End of page')
  })
})
