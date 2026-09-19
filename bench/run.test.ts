// End-to-end: bench/run.ts in a subprocess on two dev fixtures, then its outputs checked against the results schema.
// Launches Chromium, so run outside the sandbox: npx vitest run bench/run.test.ts
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";
import { beforeAll, describe, expect, it } from "vitest";
import {
  TabWalkResultSchema,
  runTabWalk,
} from "../packages/accessibility/src/tab-walk.js";
import {
  RawPageSchema,
  SummarySchema,
  runDirName,
  type PageResult,
  type Summary,
} from "./results-schema.js";
import { Refusal, checkHeldOutTree, dirtyPathsFrom } from "./run-inputs.js";
import { runTool } from "./run.js";

const BENCH = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(BENCH, "..");
const execFileAsync = promisify(execFile);

// `node --import tsx`, not the tsx CLI: its IPC pipe is refused inside the Claude Bash sandbox.
function runBench(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    process.execPath,
    ["--import", "tsx", join(BENCH, "run.ts"), ...args],
    {
      cwd: ROOT,
      timeout: 280_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

describe("run.ts end-to-end on two dev fixtures", () => {
  let summary: Summary;
  let setDir: string;
  let shaDir: string;
  let runDirs: string[];
  let stdout: string;
  const page = (id: string): PageResult => {
    const p = summary.pages.find((x) => x.pageId === id);
    if (p === undefined) throw new Error(`no page ${id}`);
    return p;
  };

  beforeAll(async () => {
    const out = mkdtempSync(join(tmpdir(), "bench-run-"));
    ({ stdout } = await runBench([
      "dev-fixtures",
      "--pages",
      "three-links,identical-links",
      "--allow-dirty",
      "--out",
      out,
    ]));
    [shaDir] = readdirSync(out);
    runDirs = readdirSync(join(out, shaDir));
    setDir = join(out, shaDir, runDirs[0]);
    summary = SummarySchema.parse(
      JSON.parse(readFileSync(join(setDir, "summary.json"), "utf8")),
    );
  }, 300_000);

  it("writes a --pages run to its own subset directory, never the set's", () => {
    expect(runDirs).toEqual([
      runDirName("dev-fixtures", ["identical-links", "three-links"]),
    ]);
    expect(runDirs[0]).toMatch(/^dev-fixtures--subset-[0-9a-f]{10}$/);
  });

  it("writes a complete, schema-valid summary stamped with the commit, launch facts and page filter", () => {
    expect(summary.set).toBe("dev-fixtures");
    expect(summary.complete).toBe(true);
    expect(shaDir).toBe(
      summary.git.dirty
        ? `${summary.git.shortSha}-dirty`
        : summary.git.shortSha,
    );
    expect(summary.config.pageFilter).toEqual([
      "three-links",
      "identical-links",
    ]);
    expect(summary.pages.map((p) => p.pageId)).toEqual([
      "identical-links",
      "three-links",
    ]);
    expect(summary.launch.mode).toBe("headless-shell");
    expect(summary.launch.userAgent).toContain("HeadlessChrome");
    expect(summary.notes.some((n) => n.includes("3.2.1"))).toBe(true);
    for (const p of summary.pages) {
      for (const tool of Object.values(p.tools)) expect(tool.status).toBe("ok");
      expect(p.tools.walk.load?.blockedRequests).toBe(0);
    }
    expect(stdout).toContain("three-links");
  });

  it("three-links: the legacy trap detector reports the known wrap-around false trap (cycle of 4 at press 20)", () => {
    const p = page("three-links");
    expect(p.tools.walk.findings).toEqual({
      F: 3,
      fIncomplete: false,
      fIncompleteCauses: { crossOriginFrames: 0, closedShadowRoots: 0 },
      plannedPresses: 25,
      presses: 25,
      wraps: 6,
      focusLost: 0,
      deep: { inside: 0, crossOrigin: 0, closedShadowRoot: 0 },
      launch: {
        browserVersion: summary.launch.browserVersion,
        executableBasename: "chrome-headless-shell",
      },
      suspectedTrap: false,
      trap: "no",
      escapeReachedAt: null,
      error: null,
    });
    expect(p.tools.legacy.findings?.trap).toMatchObject({
      trapped: true,
      firstTrappedPress: 20,
      cycleLength: 4,
    });
    expect(
      p.tools.legacy.findings?.dynamicViolations.map((v) => v.criterion),
    ).toEqual(["2.4.3"]);
  });

  it("identical-links: twelve id-less 'Read more' links collide into a 1-cycle trap at press 5", () => {
    const p = page("identical-links");
    expect(p.tools.walk.findings).toMatchObject({
      F: 12,
      presses: 70,
      wraps: 5,
      suspectedTrap: false,
    });
    expect(p.tools.legacy.findings?.trap).toMatchObject({
      trapped: true,
      firstTrappedPress: 5,
      cycleLength: 1,
      element: 'a "Read more"',
    });
  });

  it("writes a gzipped raw record per page holding the verbatim walk and the per-press legacy replay", () => {
    const p = page("three-links");
    expect(p.rawFile).not.toBeNull();
    const raw = RawPageSchema.parse(
      JSON.parse(
        gunzipSync(readFileSync(join(setDir, p.rawFile ?? ""))).toString(
          "utf8",
        ),
      ),
    );
    const walk = TabWalkResultSchema.parse(raw.walk);
    expect(walk.steps).toHaveLength(25);
    expect(raw.legacy?.identities.slice(0, 4)).toEqual([
      'a "One"',
      'a "Two"',
      'a "Three"',
      "body",
    ]);
    expect(raw.legacy?.trapByPress).toHaveLength(25);
    expect(raw.axe).not.toBeNull();
  });
});

describe("run.ts refusals", () => {
  it("refuses test-live with --allow-dirty outright, whatever the tree or draw state", async () => {
    const run = runBench([
      "test-live",
      "--allow-dirty",
      "--out",
      mkdtempSync(join(tmpdir(), "bench-run-")),
    ]);
    await expect(run).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining(
        "REFUSED test-live: --allow-dirty is never allowed for test-live",
      ),
    });
  }, 60_000);

  it("refuses test-live with --pages: the held-out set runs whole", async () => {
    const run = runBench([
      "test-live",
      "--pages",
      "topjobs.lk",
      "--out",
      mkdtempSync(join(tmpdir(), "bench-run-")),
    ]);
    await expect(run).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining(
        "REFUSED test-live: --pages is never allowed for test-live",
      ),
    });
  }, 60_000);

  it("rejects an empty --pages list", async () => {
    await expect(
      runBench(["dev-fixtures", "--pages", ",", "--allow-dirty"]),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("--pages needs at least one page id"),
    });
  }, 60_000);

  it("rejects an unknown page set", async () => {
    await expect(runBench(["dev-everything"])).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("dev-everything"),
    });
  }, 60_000);
});

describe("runTool budget", () => {
  it("keeps a walk cut short by the page budget as a partial result with the budget error", async () => {
    const browser = await chromium.launch();
    try {
      const links = Array.from(
        { length: 40 },
        (_, i) => `<a href="#${i}">L${i}</a>`,
      ).join("");
      // 40 links plan 210 presses (~35 s); a 1.5 s budget stops the walk after a few.
      const out = await runTool(
        browser,
        { localOnly: true, deadline: Date.now() + 1_500, budgetMs: 1_500 },
        async (page) => {
          await page.setContent(`<!doctype html><title>t</title>${links}`);
          return runTabWalk(page);
        },
      );
      expect(out.budgetExceeded).toBe(true);
      expect(out.error).toContain("page budget of 1500 ms exceeded");
      expect(out.value).not.toBeNull();
      const walk = TabWalkResultSchema.parse(out.value);
      expect(walk.presses).toBe(210);
      expect(walk.steps.length).toBeGreaterThan(0);
      expect(walk.steps.length).toBeLessThan(210);
      expect(walk.error?.phase).toBe("walk");
      expect(walk.suspectedTrap).toBeNull();
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("skips a tool whose page budget is already spent, without opening a context", async () => {
    const out = await runTool(
      // Never touched: the budget check comes first.
      null as unknown as Parameters<typeof runTool>[0],
      { localOnly: true, deadline: Date.now() - 1, budgetMs: 10 },
      async () => "unreachable",
    );
    expect(out).toMatchObject({
      value: null,
      budgetExceeded: true,
      error: "page budget of 10 ms exhausted before this tool started",
    });
  });
});

describe("checkHeldOutTree (test-live preflight)", () => {
  const clean = { dirty: false, dirtyPaths: [] };
  const committed = (path: string) => ({
    path,
    tracked: true,
    unmodified: true,
  });
  const draw = [
    committed("bench/test-sites/candidates.json"),
    committed("bench/test-sites/accepted.json"),
  ];

  it("passes a clean tree whose draw files are committed and unmodified", () => {
    expect(() => checkHeldOutTree(clean, draw)).not.toThrow();
  });

  it("refuses any uncommitted path, naming it", () => {
    const dirty = { dirty: true, dirtyPaths: ["bench/report.ts"] };
    expect(() => checkHeldOutTree(dirty, draw)).toThrow(Refusal);
    expect(() => checkHeldOutTree(dirty, draw)).toThrow(
      "test-live runs only on a clean, committed tree; 1 uncommitted path(s) outside bench/results/ (bench/report.ts)",
    );
  });

  it("refuses an untracked or modified draw file even on an otherwise clean tree", () => {
    const untracked = [
      draw[0],
      { ...draw[1], tracked: false, unmodified: true },
    ];
    expect(() => checkHeldOutTree(clean, untracked)).toThrow(
      "bench/test-sites/accepted.json must be committed and unmodified",
    );
    const modified = [{ ...draw[0], unmodified: false }, draw[1]];
    expect(() => checkHeldOutTree(clean, modified)).toThrow(
      "bench/test-sites/candidates.json must be committed and unmodified",
    );
  });
});

describe("dirtyPathsFrom", () => {
  it("counts tracked and untracked changes but never the results tree itself", () => {
    const porcelain = [
      " M bench/run.ts",
      "?? bench/new.ts",
      "?? bench/results/abc1234/dev-fixtures/summary.json",
      "R  a.ts -> b.ts",
      "",
    ].join("\n");
    expect(dirtyPathsFrom(porcelain)).toEqual([
      "bench/run.ts",
      "bench/new.ts",
      "b.ts",
    ]);
  });
});
