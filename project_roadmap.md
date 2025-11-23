# Project Structure & Backlog: Accessibility Driver Framework

## 1. Monorepo Structure

We will use a **pnpm workspace** (or Yarn/Lerna) monorepo structure to enforce strict boundaries between layers while allowing shared types.

```text
accessibility-driver-framework/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── core/                 # Shared Interfaces (IAccessibilityDriver, Types)
│   │   ├── src/
│   │   └── package.json
│   ├── browser-layer/        # Playwright + CDP Wrapper
│   │   ├── src/
│   │   │   ├── axtree/       # AXTree fetching & normalization
│   │   │   └── input/        # Raw input simulation
│   │   └── package.json
│   ├── drivers/              # The Driver Implementations
│   │   ├── src/
│   │   │   ├── screen-reader/
│   │   │   ├── magnifier/
│   │   │   └── high-contrast/
│   │   └── package.json
│   ├── agent/                # LLM Logic & Planning
│   │   ├── src/
│   │   │   ├── planner/
│   │   │   └── context/
│   │   └── package.json
│   ├── evaluation/           # WCAG Rules & Reporting
│   │   ├── src/
│   │   │   ├── rules/
│   │   │   └── report/
│   │   └── package.json
│   └── visualization/        # React/Web UI for Debugging
│       ├── src/
│       └── package.json
└── apps/
    ├── cli/                  # Command Line Interface runner
    └── playground/           # Testbed (Next.js/Vite app with broken a11y)
```

---

## 2. Prioritized Backlog (Epics)

### Epic 1: Foundation & Browser Layer
**Goal**: Establish the repo, CI, and the ability to fetch a reliable Accessibility Tree from Chrome via CDP.
**Dependencies**: None.

*   **Task 1.1**: Initialize Monorepo (pnpm, TypeScript, ESLint, Prettier).
*   **Task 1.2**: Implement `packages/core` with `IAccessibilityDriver` and `AXNode` interfaces.
*   **Task 1.3**: Set up `packages/browser-layer` with Playwright.
*   **Task 1.4**: Implement `AXTreeFetcher` in `browser-layer` using `CDP.Accessibility.getFullAXTree`.
    *   *Success Criteria*: Can dump a JSON representation of the AXTree for any URL.
*   **Task 1.5**: Implement `InputSimulator` in `browser-layer` (Keyboard press, Focus management).

### Epic 2: Core Driver Implementation (Screen Reader)
**Goal**: Create a working "Virtual Cursor" that can navigate a page linearly and spatially.
**Dependencies**: Epic 1.

*   **Task 2.1**: Scaffold `packages/drivers`.
*   **Task 2.2**: Implement `VirtualBuffer` logic for Screen Reader.
    *   *Logic*: Flatten AXTree, handle "Next/Prev" index movement.
*   **Task 2.3**: Implement `OutputGenerator` (Text-to-Speech simulation).
    *   *Logic*: Convert AXNode -> "Role: Name, State".
*   **Task 2.4**: Implement "Focus Mode" vs "Browse Mode" toggle.
*   **Task 2.5**: Unit tests for navigation heuristics (e.g., "Next Heading" correctly skips non-headings).

### Epic 3: Visualization & Debugging UI
**Goal**: See what the driver sees in real-time. Crucial for debugging the Agent later.
**Dependencies**: Epic 2.

*   **Task 3.1**: Setup `packages/visualization` (React + Vite).
*   **Task 3.2**: Create `LiveMirror` component (iframe or screenshot stream).
*   **Task 3.3**: Implement `OverlayLayer` to draw the "Virtual Cursor" box.
    *   *Tech*: Receive coordinates from Driver, draw SVG rect on top.
*   **Task 3.4**: Build `TranscriptPanel` to show the log of spoken text.
*   **Task 3.5**: Integrate with `apps/playground` to run a live demo.

### Epic 4: Agent Logic & Evaluation
**Goal**: Connect the LLM to the Driver and start finding violations.
**Dependencies**: Epic 2.

*   **Task 4.1**: Setup `packages/agent` with OpenAI/LangChain.
*   **Task 4.2**: Define `AgentAction` schema (e.g., `PRESS_KEY`, `NAVIGATE_TO`).
*   **Task 4.3**: Implement the `Observe-Think-Act` loop.
    *   *Input*: Driver Output (Text) + Visual Snapshot (Image).
    *   *Output*: Action.
*   **Task 4.4**: Implement `packages/evaluation` with basic WCAG checks.
    *   *Check*: "Mismatch between Visual Heading and Semantic Heading".
*   **Task 4.5**: Create `Reporter` to output JSON/Markdown results.

### Epic 5: Advanced Drivers & Polish
**Goal**: Add Magnifier, High Contrast, and robust reporting.
**Dependencies**: Epic 2.

*   **Task 5.1**: Implement `MagnifierDriver` in `packages/drivers`.
    *   *Logic*: CSS Transform / Viewport resizing.
*   **Task 5.2**: Implement `HighContrastDriver`.
    *   *Logic*: Inject CSS `forced-colors`.
*   **Task 5.3**: Create `apps/cli` for headless execution in CI.
*   **Task 5.4**: Add "Replay" functionality to the Visualization UI (load a log and replay the session).

---

## 3. Layer Boundaries & Responsibilities

| Layer | Package | Responsibilities | Inputs | Outputs |
| :--- | :--- | :--- | :--- | :--- |
| **Browser** | `@adf/browser-layer` | Raw CDP access, DOM events, Input injection. | Playwright Page | AXTree, Raw Events |
| **Driver** | `@adf/drivers` | State management (Virtual Cursor), Simulation logic (Zoom, Contrast). | AXTree, User Actions | Perceptual Output (Text/Image) |
| **Agent** | `@adf/agent` | Planning, Decision making, Goal tracking. | Perceptual Output | Driver Commands |
| **Eval** | `@adf/evaluation` | Compliance checking, Rule definitions. | Interaction Log, AXTree | Violation Report |
| **Vis** | `@adf/visualization` | Human-readable debugging, Replay. | Driver State, Logs | UI Render |
