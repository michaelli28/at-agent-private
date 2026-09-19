# What the checker covers, and what was cut

## Retired: Section2Evaluator (decided 2026-09-19)

`evaluation/src/operable/Section2Evaluator.ts` sits untracked in the root checkout and was never committed on any branch. It is not ported, and the root file is left untouched.

- **Its 2.1.2 check** flags five Tab presses whose observation text doesn't change. That is the identical-text collision that the Tab walk (backendNodeId identity) and F4 remove. It is also limited to one-element cycles, and it reads the old agent's trace format.
- **Its other checks** (2.4.1 bypass, 2.4.2 page title, 2.4.4 link purpose, 2.4.5 multiple ways, 2.4.6 headings/labels) are static checks outside the keyboard claim.
  - axe-core already runs `bypass`, `document-title`, `link-name`, `label` and `empty-heading` alongside the checker.
  - 2.4.5 has no axe equivalent and is not covered.
