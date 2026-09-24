# WCAG 2.2 Section 2 ("Operable") Evaluator

This module implements automated checks for WCAG 2.2 Section 2 ("Operable"), focusing on Guideline 2.4 ("Navigable").

## Overview

The `Section2Evaluator` analyzes:
1.  **Static Accessibility Tree**: Checks for missing landmarks, generic link text, empty headings, etc.
2.  **Interaction Trace**: Checks for keyboard traps, focus visible, and navigation flows.
3.  **Page Metadata**: Checks for page title.

## Supported Success Criteria

| ID | Name | Level | Status | Strategy |
|----|------|-------|--------|----------|2
| 2.1.1 | Keyboard | A | Heuristic | Checks if interactive elements are reachable (limited). |
| 2.1.2 | No Keyboard Trap | A | **Implemented** | Detects focus loops (5+ Tabs without change). |
| 2.4.1 | Bypass Blocks | A | **Implemented** | Checks for landmarks or skip links. |
| 2.4.2 | Page Titled | A | **Implemented** | Checks for non-empty page title. |
| 2.4.3 | Focus Order | A | Manual | Requires manual verification. |
| 2.4.4 | Link Purpose | A | **Implemented** | Flags generic link text ("click here"). |
| 2.4.5 | Multiple Ways | AA | **Implemented** | Checks for >1 navigation mechanism (Search, Nav, Sitemap). |
| 2.4.6 | Headings/Labels | AA | **Implemented** | Checks for form labels and non-empty headings. |
| 2.4.7 | Focus Visible | AA | Manual | Requires visual verification. |

## Usage

The evaluator is integrated into `scripts/runAgent.ts` and `scripts/runAgentExperiment.ts`.

To run a check:
```bash
npx ts-node scripts/runAgent.ts <url> "<goal>"
```

The output will include a section:
```
=== WCAG 2.2 Section 2 (Operable) Evaluation ===
✅ [2.4.2 Page Titled] PASS: Page title is present: "Example Domain"
❌ [2.4.5 Multiple Ways] FAIL: Only found 1 way to locate content (Navigation landmark). WCAG requires > 1.
```

## Extending

To add new checks:
1.  Add the SC to `evaluation/wcag2_operable_test_plan.json`.
2.  Implement the check method in `evaluation/src/operable/Section2Evaluator.ts`.
3.  Call the method in `evaluate()`.
