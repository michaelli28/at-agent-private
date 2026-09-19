// report.ts on synthetic summaries: criterion mapping, Wilson / rule-of-three cells, cluster counts, variant grid,
// subset runs kept out of the tables, and the walk's undetermined trap state.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  VariantLabelsFileSchema,
  type ElementLabel,
} from "./corpus/labels-schema.js";
import {
  BadTruthSchema,
  axeCriteria,
  criterionFromAxeTag,
  legacyTrapFlagged,
  ourCriteria,
  renderReport,
  type ReportInput,
} from "./report.js";
import {
  SUBSET_DIR_RE,
  SummarySchema,
  WalkStatsSchema,
  runDirName,
  walkTrap,
  type AxeFinding,
  type GapFinding,
  type PageResult,
  type PageSet,
  type Summary,
  type WalkStats,
} from "./results-schema.js";

const BENCH = dirname(fileURLToPath(import.meta.url));
const badTruth = BadTruthSchema.parse(
  JSON.parse(
    readFileSync(join(BENCH, "corpus", "test", "bad-labels.json"), "utf8"),
  ),
);

type Fake = {
  gaps?: GapFinding[];
  trapped?: boolean;
  dynamic?: string[];
  axe?: AxeFinding[];
  cluster?: string;
  walk?: Partial<WalkStats>;
};

const cleanWalk: WalkStats = {
  F: 3,
  fIncomplete: false,
  fIncompleteCauses: { crossOriginFrames: 0, closedShadowRoots: 0 },
  plannedPresses: 25,
  presses: 25,
  wraps: 6,
  focusLost: 0,
  deep: { inside: 0, crossOrigin: 0, closedShadowRoot: 0 },
  launch: {
    browserVersion: "143.0.7499.4",
    executableBasename: "chrome-headless-shell",
  },
  suspectedTrap: false,
  trap: "no",
  escapeReachedAt: null,
  error: null,
};

const gap = (over: Partial<GapFinding>): GapFinding => ({
  nodeName: "DIV",
  id: null,
  class: null,
  dataBenchId: null,
  gapType: "missing_from_a11y_tree",
  severity: "critical",
  wcag: ["4.1.2"],
  ...over,
});

const axe = (id: string, tags: string[], components = ["DIV"]): AxeFinding => ({
  id,
  impact: "serious",
  wcagTags: tags,
  targets: components.map((_, i) => `#n${i}`),
  components,
});

function fakePage(pageId: string, f: Fake): PageResult {
  const base = {
    error: null,
    budgetExceeded: false,
    durationMs: 1,
    load: null,
  };
  return {
    pageId,
    url: `http://127.0.0.1/${pageId}`,
    cluster: f.cluster ?? "w3c-bad",
    budgetMs: 1_200_000,
    budgetExceeded: false,
    durationMs: 3,
    rawFile: null,
    tools: {
      gaps: { ...base, status: "ok", findings: f.gaps ?? [] },
      walk: { ...base, status: "ok", findings: { ...cleanWalk, ...f.walk } },
      legacy: {
        ...base,
        status: "ok",
        findings: {
          presses: 25,
          trap: {
            trapped: f.trapped ?? false,
            firstTrappedPress: f.trapped ? 20 : null,
            cycleLength: f.trapped ? 4 : 0,
            element: f.trapped ? 'a "One"' : null,
          },
          dynamicViolations: (f.dynamic ?? []).map((criterion) => ({
            criterion,
            severity: "moderate" as const,
            description: "d",
            evidence: ['a "One"'],
          })),
        },
      },
      axe: { ...base, status: "ok", findings: f.axe ?? [] },
    },
  };
}

function fakeSummary(
  set: PageSet,
  pages: PageResult[],
  dirty = false,
  pageFilter: string[] | null = null,
): Summary {
  return SummarySchema.parse({
    schemaVersion: 1,
    set,
    complete: true,
    createdAt: "2026-09-18T00:00:00.000Z",
    git: {
      sha: "0467eb6".padEnd(40, "0"),
      shortSha: "0467eb6",
      dirty,
      dirtyPaths: dirty ? ["bench/run.ts"] : [],
    },
    launch: {
      mode: "headless-shell",
      browserVersion: "143.0.7499.4",
      executablePath: "/x/chrome",
      executablePathNote: "n",
      browserProcessPath: "/x/chrome-headless-shell",
      userAgent: "HeadlessChrome/143",
      playwrightVersion: "1.57.0",
    },
    axeCoreVersion: "4.11.0",
    nodeVersion: "v22.0.0",
    config: {
      budgetMs: 1_200_000,
      waitUntil: "domcontentloaded",
      settleMs: 3000,
      loadTimeoutMs: 60_000,
      walkOptions: "runTabWalk defaults",
      localOnly: true,
      pageFilter,
    },
    inputs: [],
    notes: ["3.2.1 note"],
    pages,
  });
}

const tag412 = ["wcag2a", "wcag412"];
const badSummary = fakeSummary(
  "test-bad",
  [
    fakePage("before/home", {
      gaps: [
        gap({}),
        gap({ gapType: "not_focusable", wcag: ["2.1.1", "2.4.7"] }),
      ],
      trapped: true,
      axe: [axe("button-name", tag412)],
    }),
    // Passes 2.4.3, so the legacy 2.4.3 flag here is a false alarm even though it is a before-page.
    fakePage("before/news", {
      gaps: [gap({})],
      trapped: true,
      dynamic: ["2.4.3"],
      axe: [axe("button-name", tag412)],
    }),
    fakePage("before/survey", { trapped: true, dynamic: ["2.4.3"] }),
    fakePage("before/tickets", {
      trapped: true,
      axe: [axe("aria-command-name", tag412)],
    }),
    ...["home", "news", "survey", "tickets"].map((n) =>
      fakePage(`after/${n}`, {
        trapped: true,
        axe: n === "home" ? [axe("button-name", tag412)] : [],
      }),
    ),
  ],
  true,
);

function input(
  summaries: ReportInput["summaries"],
  over: Partial<ReportInput> = {},
): ReportInput {
  return {
    sha: "0467eb6-dirty",
    summaries,
    subsets: [],
    badTruth,
    variantLabels: null,
    baseLabels: null,
    currentInputs: {},
    ...over,
  };
}

function row(md: string, heading: string, sc: string): string {
  const section = md.slice(md.indexOf(heading));
  const line = section.split("\n").find((l) => l.startsWith(`| ${sc} |`));
  if (line === undefined) throw new Error(`no row ${sc} under ${heading}`);
  return line;
}

describe("criterion mapping", () => {
  it("parses axe's success-criterion tags and ignores level and version tags", () => {
    expect(criterionFromAxeTag("wcag412")).toBe("4.1.2");
    expect(criterionFromAxeTag("wcag1411")).toBe("1.4.11");
    expect(criterionFromAxeTag("wcag2a")).toBeNull();
    expect(criterionFromAxeTag("wcag21aa")).toBeNull();
    expect(criterionFromAxeTag("best-practice")).toBeNull();
  });

  it("maps gaps by their wcag list, the legacy trap to 2.1.2 and dynamic violations by criterion", () => {
    const ours = ourCriteria(badSummary.pages[0]);
    expect([...ours.keys()].sort()).toEqual([
      "2.1.1",
      "2.1.2",
      "2.4.7",
      "4.1.2",
    ]);
    expect([...(ours.get("2.1.2") ?? [])]).toEqual(["legacy-trap"]);
    expect([...(ours.get("4.1.2") ?? [])]).toEqual([
      "gap:missing_from_a11y_tree",
    ]);
    expect([...axeCriteria(badSummary.pages[0]).keys()]).toEqual(["4.1.2"]);
  });

  it("counts a legacy trap that fired mid-walk and cleared by the end, as the agent's latch would", () => {
    expect(legacyTrapFlagged({ firstTrappedPress: 19 })).toBe(true);
    expect(legacyTrapFlagged({ firstTrappedPress: null })).toBe(false);
    const page = structuredClone(badSummary.pages[0]);
    const legacy = page.tools.legacy.findings;
    if (legacy === null) throw new Error("fixture page has no legacy findings");
    legacy.trap = { ...legacy.trap, trapped: false, firstTrappedPress: 19 };
    expect([...(ourCriteria(page).get("2.1.2") ?? [])]).toEqual([
      "legacy-trap",
    ]);
  });
});

describe("renderReport: test-bad", () => {
  const md = renderReport(input({ "test-bad": badSummary }));
  const DET = "### Detection";
  const FA = "### False alarms";

  it("scores detection on pages the W3C report fails, with Wilson intervals and the cluster count", () => {
    const r412 = row(md, DET, "4.1.2");
    expect(r412).toContain("4 pages (4 before, 0 after) / 1 cluster");
    expect(r412).toContain("2/4 · 0.50 [0.15, 0.85]");
    expect(r412).toContain("3/4 · 0.75 [0.30, 0.95]");
    expect(row(md, DET, "2.1.1")).toContain("1/4 · 0.25 [0.05, 0.70]");
    // Only before/survey fails 2.4.3 in the truth file.
    expect(row(md, DET, "2.4.3")).toContain("1/1 · 1.00 [0.21, 1.00]");
    // No before-page fails 2.1.2, so there is nothing to detect.
    expect(row(md, DET, "2.1.2")).toContain("n/a");
  });

  it("scores false alarms on every page the report passes, before or after, adding the rule of three at zero", () => {
    // Every page passes 2.1.2; the legacy trap fires on all eight.
    const r212 = row(md, FA, "2.1.2");
    expect(r212).toContain("8 pages (4 before, 4 after) / 1 cluster");
    expect(r212).toContain("8/8 · 1.00 [0.68, 1.00]");
    expect(r212).toContain("0/8 · 0.00 [0.00, 0.32] · rule of 3 ≤ 0.38");
    // before/survey fails 2.4.3, so its flag is a detection; before/news passes it, so its flag is a false alarm.
    const r243 = row(md, FA, "2.4.3");
    expect(r243).toContain("7 pages (3 before, 4 after) / 1 cluster");
    expect(r243).toContain("1/7 · 0.14 [0.03, 0.51]");
    expect(r243).toContain("legacy-dynamic:2.4.3 ×1");
    const r412 = row(md, FA, "4.1.2");
    expect(r412).toContain("4 pages (0 before, 4 after) / 1 cluster");
    expect(r412).toContain("0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75");
    expect(r412).toContain("1/4 · 0.25 [0.05, 0.70]");
  });

  it("keeps the rule of three off detection cells", () => {
    expect(row(md, DET, "2.1.1")).toContain("0/4 · 0.00 [0.00, 0.49] |");
    expect(md.slice(md.indexOf(DET), md.indexOf(FA))).not.toContain(
      "rule of 3",
    );
  });

  it("names the evidence behind our flags, the 3.2.1 limitation and the dirty stamp; never McNemar", () => {
    expect(row(md, DET, "4.1.2")).toContain("gap:missing_from_a11y_tree");
    expect(md).toContain("3.2.1 note");
    expect(md).toMatch(/DIRTY/);
    expect(md).not.toMatch(/mcnemar/i);
  });
});

describe("renderReport: dev-variants and dev-fixtures", () => {
  const el = (over: Partial<ElementLabel> = {}): ElementLabel => ({
    interactive: true,
    keyboardAccessible: true,
    expectedGapType: null,
    note: "n",
    ...over,
  });
  const flags = {
    keyboardTrap: false,
    trapEscapable: null,
    contextChangeOnFocus: false,
    focusLostOnArrival: false,
  };
  const variant = (
    base: string,
    op: "M1" | "M3" | "M5" | "M6",
    target: string,
    label: ElementLabel,
  ) => [
    `${base}__${op}__${target}`,
    {
      file: `${base}__${op}__${target}.html`,
      page:
        op === "M5"
          ? { ...flags, keyboardTrap: true, trapEscapable: false }
          : op === "M6"
            ? { ...flags, contextChangeOnFocus: true }
            : flags,
      elements: { [target]: label },
      base,
      operator: op,
      target,
    },
  ];
  const variantLabels = VariantLabelsFileSchema.parse({
    schemaVersion: 1,
    variants: Object.fromEntries([
      variant(
        "b1",
        "M1",
        "t1",
        el({
          keyboardAccessible: false,
          expectedGapType: "wrong_role",
          acceptableGapTypes: ["wrong_role", "not_focusable"],
        }),
      ),
      variant(
        "b1",
        "M3",
        "t2",
        el({ expectedGapType: "hidden_but_interactive" }),
      ),
      variant("b2", "M5", "t3", el()),
      variant("b2", "M6", "t4", el()),
    ]),
  });
  const variants = fakeSummary("dev-variants", [
    fakePage("b1__M1__t1", {
      cluster: "b1",
      gaps: [
        gap({
          dataBenchId: "t1",
          gapType: "not_focusable",
          wcag: ["2.1.1", "2.4.7"],
        }),
      ],
    }),
    fakePage("b1__M3__t2", {
      cluster: "b1",
      gaps: [gap({ dataBenchId: "other" })],
    }),
    fakePage("b2__M5__t3", { cluster: "b2", trapped: true }),
    fakePage("b2__M6__t4", { cluster: "b2", dynamic: ["2.4.3"] }),
  ]);
  const fixtures = fakeSummary("dev-fixtures", [
    fakePage("cards", {
      cluster: "cards",
      gaps: [
        gap({ nodeName: "A", class: "btn primary" }),
        gap({ nodeName: "A", class: "primary  btn" }),
        gap({ nodeName: "A", class: "primary btn" }),
        gap({ nodeName: "DIV", class: "card" }),
      ],
      axe: [axe("link-name", ["wcag2a", "wcag244"], ["A.x", "A.x"])],
    }),
  ]);
  const md = renderReport(
    input(
      { "dev-variants": variants, "dev-fixtures": fixtures },
      { variantLabels },
    ),
  );

  it("labels the variant grid regression-only and marks each seeded target flagged or missed", () => {
    expect(md).toContain("regression only — not a headline number");
    const grid = md.slice(md.indexOf("| operator |"));
    const line = (op: string) =>
      grid.split("\n").find((l) => l.startsWith(`| ${op} |`)) ?? "";
    expect(line("M1")).toMatch(/\| Y \| · \|$/);
    expect(line("M3")).toMatch(/\| N \| · \|$/);
    expect(line("M5")).toMatch(/\| · \| Y \|$/);
    expect(line("M6")).toMatch(/\| · \| N \|$/);
  });

  it("keeps the gap-type confusion matrix separate and counts acceptable types", () => {
    const confusion = md.slice(
      md.indexOf("#### Gap type on the seeded target"),
    );
    const wrongRole =
      confusion.split("\n").find((l) => l.startsWith("| wrong_role |")) ?? "";
    expect(wrongRole).toContain("| 1/1 |");
    expect(wrongRole.split("|").map((c) => c.trim())).toContain("1");
  });

  it("groups fixture flags by component (nodeName + sorted class set): copies vs distinct", () => {
    expect(md).toContain("A.btn.primary ×3");
    expect(md).toMatch(/\| cards \|[^\n]*\| 4 \/ 2 \|/);
  });

  it("marks a Y with † when the unmodified base page already had the same flag", () => {
    const withBase = fakeSummary("dev-fixtures", [
      fakePage("b2", { cluster: "b2", trapped: true }),
    ]);
    const grid = renderReport(
      input(
        { "dev-variants": variants, "dev-fixtures": withBase },
        { variantLabels },
      ),
    );
    const m5 =
      grid.split("\n").find((l) => l.startsWith("| M5 |")) ?? "no M5 row";
    expect(m5).toMatch(/\| · \| Y† \|$/);
    const m1 =
      grid.split("\n").find((l) => l.startsWith("| M1 |")) ?? "no M1 row";
    expect(m1).toMatch(/\| Y \| · \|$/);
  });
});

describe("subset runs", () => {
  it("names a --pages run's directory by its sorted page ids, apart from the set's own", () => {
    expect(runDirName("test-bad", null)).toBe("test-bad");
    const dir = runDirName("test-bad", ["before/news", "after/home"]);
    expect(dir).toMatch(SUBSET_DIR_RE);
    expect(SUBSET_DIR_RE.exec(dir)?.[1]).toBe("test-bad");
    expect(runDirName("test-bad", ["after/home", "before/news"])).toBe(dir);
    expect(runDirName("test-bad", ["after/home"])).not.toBe(dir);
  });

  const subset = fakeSummary("test-bad", badSummary.pages.slice(0, 2), true, [
    "before/home",
    "before/news",
  ]);

  it("leaves a subset run out of every table and warns about it", () => {
    const md = renderReport(
      input(
        { "test-bad": badSummary },
        { subsets: [{ dir: "test-bad--subset-0123456789", summary: subset }] },
      ),
    );
    expect(md).toContain(
      "> **SUBSET**: test-bad--subset-0123456789 ran only 2 pages of test-bad (--pages before/home,before/news, dirty); it is left out of every table below.",
    );
    // The headline still scores the full run's eight pages.
    expect(row(md, "### False alarms", "2.1.2")).toContain("8/8");
  });

  it("treats a filtered summary found in the set's own directory as a subset, never as the headline", () => {
    const md = renderReport(input({ "test-bad": subset }));
    expect(md).toContain("> **SUBSET**: test-bad ran only 2 pages of test-bad");
    expect(md).not.toContain("### Detection");
    expect(md).toContain(
      "No full-set run at this commit: dev-fixtures, dev-variants, dev-live, test-bad, test-live.",
    );
  });
});

describe("walk trap on pages whose F is a lower bound", () => {
  it("derives the walk trap: a missing wrap is a suspected trap only when F is complete", () => {
    expect(walkTrap({ suspectedTrap: false, fIncomplete: true })).toBe("no");
    expect(walkTrap({ suspectedTrap: true, fIncomplete: false })).toBe(
      "suspected",
    );
    expect(walkTrap({ suspectedTrap: true, fIncomplete: true })).toBe(
      "undetermined",
    );
    expect(walkTrap({ suspectedTrap: null, fIncomplete: false })).toBe(
      "undetermined",
    );
  });

  it("rejects a summary that calls an fIncomplete no-wrap walk a suspected trap", () => {
    const bad = {
      ...cleanWalk,
      fIncomplete: true,
      suspectedTrap: true,
      trap: "suspected",
    };
    expect(WalkStatsSchema.safeParse(bad).success).toBe(false);
    expect(
      WalkStatsSchema.safeParse({ ...bad, trap: "undetermined" }).success,
    ).toBe(true);
  });

  it("prints undetermined with its cause and no escape outcome; the legacy verdict stays as-is", () => {
    const live = fakeSummary("dev-live", [
      fakePage("frames.example", {
        cluster: "frames.example",
        trapped: true,
        walk: {
          F: 14,
          fIncomplete: true,
          fIncompleteCauses: { crossOriginFrames: 1, closedShadowRoots: 0 },
          wraps: 0,
          deep: { inside: 0, crossOrigin: 40, closedShadowRoot: 0 },
          suspectedTrap: true,
          trap: "undetermined",
          escapeReachedAt: null,
        },
      }),
      fakePage("dialog.example", {
        cluster: "dialog.example",
        walk: { wraps: 0, suspectedTrap: true, trap: "suspected" },
      }),
    ]);
    const md = renderReport(input({ "dev-live": live }));
    const line = (id: string) =>
      md.split("\n").find((l) => l.startsWith(`| ${id} |`)) ?? "";
    const frames = line("frames.example");
    expect(frames).toContain(
      "| ≥14 / 0 | 0 / 0 | Y @20 (cycle 4) | undetermined (F lower bound: 1 cross-origin frame) |",
    );
    expect(frames).not.toContain("suspected");
    expect(frames).not.toContain("escape");
    expect(md).toContain("≥F: a cross-origin frame or closed shadow root");
    expect(line("dialog.example")).toContain("| suspected, no escape |");
  });
});
