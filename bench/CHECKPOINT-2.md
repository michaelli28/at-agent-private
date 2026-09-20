# Checkpoint 2 — each fix's failing-then-passing pair, plus the full suite

What `prompts/2-at-agent.md:130` asks for. Every row names a test that is RED at the stated base
commit and GREEN now, and says **why** it was red — a test that would also have passed before the
fix is not evidence of a fix.

Base for Stage B is **d9e2cb5**. Gates below ran at **118bb99**.

## The suite, now

| gate                      | result                      |
| ------------------------- | --------------------------- |
| `npm run build:packages`  | exit 0                      |
| `@at-agent/browser`       | 28 passed                   |
| `@at-agent/accessibility` | 308 passed                  |
| `@at-agent/agent`         | 64 passed                   |
| `@at-agent/cli`           | 26 passed                   |
| `npx vitest run bench`    | 227 passed, 1 expected skip |

Evidence class: units and fixture replays, plus browser tests in real headless Chromium. The dev
harness runs at 118bb99 are local runs in the headless shell. **No held-out set has been run.**

---

## F4 — keyboard trap (WCAG 2.1.2)

`packages/accessibility/src/keyboard-trap.ts` replaces `keyboard-trap-detector.ts`, deleted at
e822472. Every test below calls `judgeKeyboardTrap`, which did not exist at d9e2cb5, so all were red
by construction; the substantive point is what each pins.

| test (`keyboard-trap.test.ts`)                                                              | why it is a real guard                                                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| clean page: the wrap is the end of the page, not a cycle                                    | the old detector called this exact recorded sequence trapped at press 20                                                |
| **the false alarm is gone while the frozen baseline still reproduces it**                   | the before/after in one assertion: same walk, frozen replay says trap@20, judge says pass                               |
| truncated clean walk: every counted stop visited is also the end of the page                | the second end-of-page signal; new-headless skips body on the first wrap, so a body-only test misses it                 |
| M5 Tab-swallow is a trap: Escape and Shift+Tab both fail                                    | detection, with `release: none` — the conjunction, not repetition                                                       |
| **a cyclic trap is not end-of-page: the M5 record returns to its first element on press 2** | regression guard against the rule two of three candidate designs shipped, which silently passes 4 of 6 real M5 fixtures |
| a correct modal is confined but escapable                                                   | the prompt's stated F4 acceptance case; `keyboardTrap: true, trapEscapable: true`                                       |
| region size is recorded, never a verdict input                                              | F legitimately over-counts (recorded navbar: F=12, 8 real stops)                                                        |
| undetermined never reads as a pass                                                          | five reasons, each scored as a miss                                                                                     |
| identities are never compared across a document replacement                                 | backendNodeIds are re-minted on replacement                                                                             |
| fail on one direction is a page fail; pass on one direction is recorded as single-direction | the disclosed coverage limit                                                                                            |

## F5 — context change (WCAG 3.2.1, incl. F55)

`packages/accessibility/src/context-change.ts` replaces the `DynamicEvaluator` rule.

| test (`context-change.test.ts`)                                                  | why it is a real guard                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M6 first-stop navigation: exactly one finding, no element named                  | the old rule scored 0/6 here — it needed a `navigate` agent event a scripted walk never produces                                                                                                                             |
| M6 second-stop navigation names the preceding stop                               | attribution without inventing an element                                                                                                                                                                                     |
| all six M6 variants: exactly one url-changed finding each                        | table-driven over the recorded walks                                                                                                                                                                                         |
| clean pages and M5 traps produce nothing                                         | the same sequences used to emit a spurious `2.4.3`                                                                                                                                                                           |
| F55: a drop after a real stop is a 3.2.1 failure                                 | `isBody && hasFocus` is a drop; the old trace could not express it                                                                                                                                                           |
| a wrap is never a context change                                                 | `isBody && !hasFocus` is the end of the page                                                                                                                                                                                 |
| refused, not reported: the three unattributed classes                            | a 15–60 s walk must not blame the page for a timer                                                                                                                                                                           |
| fragment-only URL changes are not context changes                                | a scroll-spy page would otherwise fire on every press                                                                                                                                                                        |
| a page that navigates with no input cannot attribute anything to focus           | the idle baseline                                                                                                                                                                                                            |
| **the causality control outranks a finding a load-time navigation manufactures** | found by a verifier reading across lanes: `walk.initial` is read before the idle settle, so the control was unreachable on exactly the page it exists for. Reproduced (`expected 'fail' to be 'undetermined'`) before fixing |
| F55 live: blur-on-focus on the second of four links                              | real Chromium; no dev-corpus page set `focusLostOnArrival` until M7                                                                                                                                                          |

## F6 — the 2.4.3 cut

| test                                                                                                | why it is a real guard                                                                                            |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `bench/coverage.test.ts` :: records the retired rule and its price, and no source still emits 2.4.3 | `COVERAGE.md` was 10 lines about Section2Evaluator at d9e2cb5, and `dynamic-evaluator.ts` still emitted `'2.4.3'` |

The rule is deleted, not repaired. Its price is recorded rather than hidden: 1/1 detection and 7/7
false alarms on clean pages in the pre-fix baseline. The report keeps the 2.4.3 row at zero with a
`COVERAGE.md` footnote, and the headline block labels it `SCOPE CUT — rule deleted`.

## Agent wiring

| test (`keyboard-integration.test.ts`, `agent.test.ts`, `openai.test.ts`, `types.test.ts`) | why it is a real guard                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| every Tab press is recorded                                                               | `executeTab` pressed N times and read focus once                                                                                |
| checkKeyboard exists and is walk-driven                                                   | `ActionTypeSchema` had no such value; `executeCheckTrap` took no page, so it could never press Escape                           |
| checkKeyboard on a real trap and on a correct modal                                       | real Chromium, both fixtures                                                                                                    |
| the agent's own navigate is no longer a 3.2.1                                             | **inverts** a test that certified the bug: `agent.test.ts` asserted a 3.2.1 with "Context change"                               |
| no 2.4.3 survives                                                                         | inverts the "Focus cycling" assertion                                                                                           |
| the model is told the keyboard actions exist                                              | `SYSTEM_PROMPT` listed only navigate/observe/click/fill/audit/done — the whole keyboard path was unreachable from the live loop |

## Tab-walk instrumentation

`tab-walk.test.ts`: the probe gate now fires on a page that wraps early then traps late (the
whole-walk flag was `false` there, so no probe ran at all); `focusLost` now catches a press-1 drop
and a second consecutive drop (`previous !== undefined` made both impossible); `idle` and
`focusableCountEnd` are recorded (neither field existed).

## F8 — heading level (Stage C, cleanup, outside the headline)

`screen-reader.test.ts` :: carries the real level through from the snapshot. `parseAriaLine`
documented the `[level=N]` form it reads and never parsed it, so `getHeadingLevel` returned a
literal `1` and an h1/h2/h3 page read as `[1, 1, 1]`.

## The freeze

`bench/legacy.test.ts` :: the freeze is real: bench replays a frozen copy, never the live checker.
Red at d9e2cb5 both ways — `legacy.ts` imported the live classes, and those modules resolved.
Separately verified: 14/14 code blocks in `bench/legacy-detectors.ts` are identical to d9e2cb5 after
normalising only formatting, and the live classes still exist at the freeze commit ac019ed and are
gone at e822472, so the ordering is checkable from history rather than asserted.

## What Checkpoint 2 does NOT establish

- **No held-out set has been run.** The dev numbers are regression evidence and are never headline
  numbers (`prompts/2-at-agent.md:98`). `bench/REPORT.md` does not exist.
- Detection on seeded defects is not real-world detection — the operators are Michael's own.
- The 20-item spot-check in `bench/SPOTCHECK.md` is 0 of 20, so no label has been human-verified.
- `bench/COVERAGE.md` lists what the verdicts do not cover, what the fix design saw of the held-out
  set, and what the harness does not measure (F7 is not wired in, so the 2.4.7 row understates the
  current checker).
