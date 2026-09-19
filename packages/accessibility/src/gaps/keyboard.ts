import { focusIdentity, type TabWalkResult } from '../tab-walk.js'
import type { KeyboardEvidence, KeyboardUnassessedReason } from './types.js'

// Keyboard reachability for the gap detector, read from a Tab walk of the same load (F3).

export const NO_WALK: KeyboardEvidence = {
  walkRan: false,
  notFocusableAssessed: false,
  unassessedReasons: ['walk-not-run'],
  walkError: null,
  reachedBackendNodeIds: [],
}

export function walkFailed(message: string): KeyboardEvidence {
  return { ...NO_WALK, unassessedReasons: ['walk-failed'], walkError: message }
}

// An element is keyboard-reachable iff a read after a Tab press focused it (the deep element when resolved).
// Unreached means unfocusable only when the walk finished, wrapped, saw every stop and kept one document.
export function keyboardEvidence(walk: TabWalkResult): KeyboardEvidence {
  const reasons: KeyboardUnassessedReason[] = []
  if (walk.error) reasons.push('walk-error')
  if (walk.fIncomplete) reasons.push('focusables-incomplete')
  if (walk.suspectedTrap === true) reasons.push('no-wrap')
  if (walk.steps.some((s) => s.documentReplaced)) reasons.push('document-replaced')

  const reached = new Set<number>()
  for (const step of walk.steps) {
    for (const read of [step.immediate, step.settled]) {
      const id = focusIdentity(read)
      if (id !== null) reached.add(id)
    }
  }

  return {
    walkRan: true,
    notFocusableAssessed: reasons.length === 0,
    unassessedReasons: reasons,
    walkError: walk.error?.message ?? null,
    reachedBackendNodeIds: [...reached],
  }
}
