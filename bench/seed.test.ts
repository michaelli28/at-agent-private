// Dev-corpus seeding: determinism, the --check contract, and that the labels match real behaviour in Chromium.
// Run from the worktree root outside the sandbox (launches Chromium): npx vitest run bench/seed.test.ts
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BaseLabelsFileSchema,
  LiveSitesFileSchema,
  OPERATOR_IDS,
  VariantLabelsFileSchema,
  type BaseLabelsFile,
  type ElementLabel,
  type OperatorId,
  type VariantLabels,
  type VariantLabelsFile,
} from "./corpus/labels-schema.js";
import { startStaticServer, type StaticServer } from "./seed.js";

const BENCH = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(BENCH, "..");
const CORPUS = join(BENCH, "corpus", "dev");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
const SEED = join(BENCH, "seed.ts");
const LONG = 240_000;

function runSeed(args: string[]): { status: number | null; output: string } {
  const r = spawnSync(TSX, [SEED, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: LONG,
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

function readTree(dir: string): Map<string, Buffer> {
  return new Map(
    readdirSync(dir)
      .sort()
      .map((f): [string, Buffer] => [f, readFileSync(join(dir, f))]),
  );
}

let tmp = "";
let outA = "";
let outB = "";
let baseLabels: BaseLabelsFile;
let variantLabels: VariantLabelsFile;
let server: StaticServer;
let browser: Browser;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "bench-seed-"));
  outA = join(tmp, "a");
  outB = join(tmp, "b");
  const first = runSeed(["--out", outA]);
  expect(first.status, first.output).toBe(0);
  const second = runSeed(["--out", outB]);
  expect(second.status, second.output).toBe(0);
  baseLabels = BaseLabelsFileSchema.parse(
    JSON.parse(readFileSync(join(CORPUS, "labels.json"), "utf8")),
  );
  variantLabels = VariantLabelsFileSchema.parse(
    JSON.parse(readFileSync(join(outA, "labels.json"), "utf8")),
  );
  server = await startStaticServer({ "/corpus/": CORPUS, "/variants/": outA });
  browser = await chromium.launch();
}, LONG);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function variants(): [string, VariantLabels][] {
  return Object.entries(variantLabels.variants).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

function firstVariant(op: OperatorId): [string, VariantLabels] {
  const found = variants().find(([, v]) => v.operator === op);
  if (!found) throw new Error(`no variant for ${op}`);
  return found;
}

const sel = (id: string): string => `[data-bench-id="${id}"]`;

async function open(path: string, ids: string[]): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${server.origin}${path}`, { waitUntil: "load" });
  // React pages render after load; static pages pass immediately.
  await page.waitForFunction(
    `${JSON.stringify(ids)}.every(function (id) { return document.querySelector('[data-bench-id="' + id + '"]') !== null; })`,
  );
  return page;
}

async function activeId(page: Page): Promise<string | null> {
  const v: unknown = await page.evaluate(
    'document.activeElement ? document.activeElement.getAttribute("data-bench-id") : null',
  );
  return typeof v === "string" ? v : null;
}

const AxNodeSchema = z.object({
  ignored: z.boolean(),
  role: z.object({ value: z.string() }).optional(),
  name: z.object({ value: z.string() }).optional(),
});

async function axNode(
  page: Page,
  id: string,
): Promise<z.infer<typeof AxNodeSchema>> {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: sel(id),
  });
  const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
    nodeId,
    fetchRelatives: false,
  });
  await cdp.detach();
  return AxNodeSchema.parse(nodes[0]);
}

describe("generation", () => {
  it("is deterministic: two runs are byte-identical", () => {
    const a = readTree(outA);
    const b = readTree(outB);
    expect([...a.keys()]).toEqual([...b.keys()]);
    expect(a.size).toBeGreaterThan(1);
    for (const [name, bytes] of a)
      expect(bytes.equals(b.get(name) ?? Buffer.alloc(0)), name).toBe(true);
  });

  it("produces at least one variant per operator, and exactly one file per labelled variant", () => {
    for (const op of OPERATOR_IDS) {
      expect(
        variants().filter(([, v]) => v.operator === op).length,
        op,
      ).toBeGreaterThan(0);
    }
    const expected = [
      ...variants().map(([id]) => `${id}.html`),
      "labels.json",
    ].sort();
    expect(readdirSync(outA).sort()).toEqual(expected);
  });

  it("derives variant labels from the base labels: only the target (and what it reveals) changes", () => {
    for (const [id, v] of variants()) {
      const base = baseLabels.pages[v.base];
      expect(base, id).toBeDefined();
      const lostKeyboard = v.operator === "M1" || v.operator === "M2";
      const revealedByTarget = (label: ElementLabel): boolean => {
        const seen = new Set<string>();
        let cur = label.revealedBy;
        while (cur && !seen.has(cur)) {
          if (cur === v.target) return true;
          seen.add(cur);
          cur = base.elements[cur]?.revealedBy;
        }
        return false;
      };
      expect(Object.keys(v.elements).sort(), id).toEqual(
        Object.keys(base.elements).sort(),
      );
      for (const [benchId, label] of Object.entries(v.elements)) {
        const before = base.elements[benchId];
        if (benchId === v.target) continue;
        if (lostKeyboard && revealedByTarget(before)) {
          expect(label.keyboardAccessible, `${id} ${benchId}`).toBe(false);
        } else {
          expect(label, `${id} ${benchId}`).toEqual(before);
        }
      }
      const target = v.elements[v.target];
      const expectedGap: Record<OperatorId, string | null> = {
        M1: "wrong_role",
        M2: "not_focusable",
        M3: "hidden_but_interactive",
        M4: "no_accessible_name",
        M5: null,
        M6: null,
        M7: "not_focusable",
      };
      expect(target.expectedGapType, id).toBe(expectedGap[v.operator]);
      if (v.operator === "M1") {
        expect(target.acceptableGapTypes, id).toEqual([
          "wrong_role",
          "not_focusable",
        ]);
      }
      if (v.operator === "M3") {
        expect(target.acceptableGapTypes, id).toEqual([
          "hidden_but_interactive",
          "missing_from_a11y_tree",
        ]);
      }
      expect(v.page.keyboardTrap, id).toBe(
        v.operator === "M5" ? true : base.page.keyboardTrap,
      );
      expect(v.page.trapEscapable, id).toBe(
        v.operator === "M5" ? false : base.page.trapEscapable,
      );
      expect(v.page.contextChangeOnFocus, id).toBe(
        v.operator === "M6" ? true : base.page.contextChangeOnFocus,
      );
    }
  });

  it("ships valid live-site metadata", () => {
    const live = LiveSitesFileSchema.parse(
      JSON.parse(readFileSync(join(CORPUS, "live-sites.json"), "utf8")),
    );
    expect(live.sites.map((s) => s.id).sort()).toEqual(
      ["amazon", "cmu", "fake-university", "mealkeyway", "troy-k12"].sort(),
    );
    expect(live.excluded.map((s) => s.id)).toEqual(["troyroyalpalace"]);
  });
});

describe("seed --check", () => {
  it(
    "passes on freshly generated variants",
    () => {
      const r = runSeed(["--check", "--out", outA]);
      expect(r.status, r.output).toBe(0);
    },
    LONG,
  );

  it(
    "fails when a variant changes a second tagged element",
    () => {
      const dir = join(tmp, "tamper-second");
      cpSync(outA, dir, { recursive: true });
      const file = join(dir, "three-links__M3__link-1.html");
      const html = readFileSync(file, "utf8");
      expect(html).toContain(">Two<");
      writeFileSync(file, html.replace(">Two<", ">Tampered<"));
      const r = runSeed(["--check", "--out", dir]);
      expect(r.status).not.toBe(0);
      expect(r.output).toMatch(
        /three-links__M3__link-1: tagged elements differ from base: link-1, link-2/,
      );
    },
    LONG,
  );

  it(
    "fails when a variant changes markup outside every tagged element",
    () => {
      const dir = join(tmp, "tamper-outside");
      cpSync(outA, dir, { recursive: true });
      const file = join(dir, "three-links__M3__link-1.html");
      const html = readFileSync(file, "utf8");
      expect(html).toContain("<h1>Three links</h1>");
      writeFileSync(
        file,
        html.replace("<h1>Three links</h1>", "<h1>Changed</h1>"),
      );
      const r = runSeed(["--check", "--out", dir]);
      expect(r.status).not.toBe(0);
      expect(r.output).toMatch(
        /three-links__M3__link-1: markup outside tagged elements differs from base/,
      );
    },
    LONG,
  );
});

const FactsSchema = z.array(
  z.object({
    id: z.string(),
    tabIndex: z.number(),
    disabled: z.boolean(),
    visible: z.boolean(),
  }),
);

describe("labels agree with the DOM", () => {
  it(
    "every tagged element is labelled, and focusability matches keyboardAccessible",
    async () => {
      const pages = [
        ...Object.entries(baseLabels.pages).map(([id, p]) => ({
          id,
          path: `/corpus/${p.file}`,
          labels: p,
        })),
        ...variants().map(([id, v]) => ({
          id,
          path: `/variants/${v.file}`,
          labels: v,
        })),
      ];
      for (const p of pages) {
        const page = await open(p.path, Object.keys(p.labels.elements));
        const facts = FactsSchema.parse(
          await page.evaluate(`Array.prototype.map.call(document.querySelectorAll('[data-bench-id]'), function (el) {
            return { id: el.getAttribute('data-bench-id'), tabIndex: el.tabIndex, disabled: el.disabled === true,
              visible: el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) };
          })`),
        );
        await page.close();
        expect(facts.map((f) => f.id).sort(), p.id).toEqual(
          Object.keys(p.labels.elements).sort(),
        );
        for (const f of facts) {
          const label = p.labels.elements[f.id];
          const where = `${p.id} ${f.id}`;
          if (label.revealedBy) {
            expect(f.visible, `${where} is hidden until revealed`).toBe(false);
          } else if (label.interactive && label.keyboardAccessible) {
            expect(
              f.tabIndex >= 0 && !f.disabled && f.visible,
              `${where} is focusable`,
            ).toBe(true);
          } else if (
            "target" in p.labels &&
            p.labels.page.focusLostOnArrival &&
            f.id === p.labels.target
          ) {
            // M7 takes keyboard access away at run time, not in the markup: a focus handler blurs the
            // element, so it stays focusable in the DOM while a Tab walk can never leave focus on it.
            // Asserting the markup side keeps this case honest instead of exempt.
            expect(
              f.tabIndex >= 0 && !f.disabled && f.visible,
              `${where} is focusable in markup and blurred at run time`,
            ).toBe(true);
          } else if (label.interactive) {
            expect(f.tabIndex, `${where} is not focusable`).toBeLessThan(0);
          }
        }
      }
    },
    LONG,
  );
});

describe("operators behave as labelled", () => {
  it("M1 turns a native button into a mouse-only div", async () => {
    const [id, v] = firstVariant("M1");
    const page = await open(`/variants/${v.file}`, [v.target]);
    expect(
      await page.evaluate(`document.querySelector('${sel(v.target)}').tagName`),
      id,
    ).toBe("DIV");
    expect(
      await page.evaluate(
        `document.querySelector('${sel(v.target)}').tabIndex`,
      ),
      id,
    ).toBe(-1);
    expect((await axNode(page, v.target)).role?.value, id).not.toBe("button");
    await page.click(sel(v.target));
    expect(await page.evaluate("window.__benchClicks"), id).toEqual([v.target]);
    await page.close();
  });

  it("M2 leaves a role=button div out of the tab order", async () => {
    const [id, v] = firstVariant("M2");
    const page = await open(`/variants/${v.file}`, [v.target]);
    expect(
      await page.evaluate(
        `document.querySelector('${sel(v.target)}').tabIndex`,
      ),
      id,
    ).toBe(-1);
    expect((await axNode(page, v.target)).role?.value, id).toBe("button");
    await page.close();
  });

  it("M3 hides a focusable control from assistive technology", async () => {
    const [id, v] = firstVariant("M3");
    const page = await open(`/variants/${v.file}`, [v.target]);
    expect((await axNode(page, v.target)).ignored, id).toBe(true);
    await page.focus(sel(v.target));
    expect(await activeId(page), id).toBe(v.target);
    await page.close();
  });

  it("M4 strips the accessible name from an icon button", async () => {
    const [id, v] = firstVariant("M4");
    const basePage = await open(`/corpus/${baseLabels.pages[v.base].file}`, [
      v.target,
    ]);
    expect((await axNode(basePage, v.target)).name?.value ?? "", id).not.toBe(
      "",
    );
    await basePage.close();
    const page = await open(`/variants/${v.file}`, [v.target]);
    expect((await axNode(page, v.target)).name?.value ?? "", id).toBe("");
    await page.close();
  });

  it("M5 traps Tab and Shift+Tab on one element", async () => {
    const [id, v] = firstVariant("M5");
    const page = await open(`/variants/${v.file}`, [v.target]);
    await page.focus(sel(v.target));
    await page.keyboard.press("Tab");
    expect(await activeId(page), id).toBe(v.target);
    await page.keyboard.press("Shift+Tab");
    expect(await activeId(page), id).toBe(v.target);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    expect(await activeId(page), id).toBe(v.target);
    await page.close();
  });

  it("M6 navigates when one element receives focus", async () => {
    const [id, v] = firstVariant("M6");
    const basePage = await open(`/corpus/${baseLabels.pages[v.base].file}`, [
      v.target,
    ]);
    await basePage.focus(sel(v.target));
    expect(basePage.url(), id).not.toContain("changed=1");
    await basePage.close();
    const page = await open(`/variants/${v.file}`, [v.target]);
    await Promise.all([
      page.waitForURL(/\?changed=1$/),
      page.focus(sel(v.target)),
    ]);
    await page.close();
  });
});

describe("base pages behave as labelled", () => {
  it("modal: focus starts inside, Tab and Shift+Tab stay inside, Escape returns focus to the trigger", async () => {
    const labels = baseLabels.pages["modal"];
    expect(labels.page).toMatchObject({
      keyboardTrap: true,
      trapEscapable: true,
    });
    const page = await open(
      `/corpus/${labels.file}`,
      Object.keys(labels.elements),
    );
    const inside = [
      "name-input",
      "username-input",
      "save-button",
      "close-button",
    ];
    expect(await activeId(page)).toBe("name-input");
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(inside).toContain(await activeId(page));
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(inside).toContain(await activeId(page));
    }
    await page.keyboard.press("Escape");
    expect(await activeId(page)).toBe("trigger");
    await page.keyboard.press("Tab");
    expect(await activeId(page)).toBe("help-link");
    await page.close();
  });

  it("js-handlers: custom controls work with Enter and Space", async () => {
    const labels = baseLabels.pages["js-handlers"];
    const page = await open(
      `/corpus/${labels.file}`,
      Object.keys(labels.elements),
    );
    const status = (): Promise<unknown> =>
      page.evaluate('document.getElementById("status").textContent');
    await page.focus(sel("custom-button"));
    await page.keyboard.press("Enter");
    expect(await status()).toBe("Added to cart (1)");
    await page.keyboard.press(" ");
    expect(await status()).toBe("Added to cart (2)");
    await page.focus(sel("custom-checkbox"));
    await page.keyboard.press(" ");
    expect(
      await page.evaluate(
        `document.querySelector('${sel("custom-checkbox")}').getAttribute('aria-checked')`,
      ),
    ).toBe("true");
    await page.focus(sel("native-button"));
    await page.keyboard.press("Enter");
    expect(await status()).toBe("Checkout started");
    await page.close();
  });

  it("navbar: the dropdown and the off-canvas menu open from the keyboard", async () => {
    const labels = baseLabels.pages["navbar"];
    const page = await open(
      `/corpus/${labels.file}`,
      Object.keys(labels.elements),
    );
    await page.focus(sel("dropdown-toggle"));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    expect(await activeId(page)).toBe("dropdown-item-1");
    await page.keyboard.press("Escape");
    expect(await activeId(page)).toBe("dropdown-toggle");
    await page.focus(sel("offcanvas-open"));
    await page.keyboard.press("Enter");
    expect(await activeId(page)).toBe("offcanvas-close");
    await page.keyboard.press("Tab");
    expect(await activeId(page)).toBe("offcanvas-link-1");
    await page.keyboard.press("Escape");
    expect(await activeId(page)).toBe("offcanvas-open");
    await page.close();
  });

  it("react-div-button: the div handles clicks but is not focusable; the button is", async () => {
    const labels = baseLabels.pages["react-div-button"];
    const page = await open(
      `/corpus/${labels.file}`,
      Object.keys(labels.elements),
    );
    await page.click(sel("add-to-cart-div"));
    expect(
      await page.evaluate('document.getElementById("status").textContent'),
    ).toBe("Added to cart");
    expect(
      await page.evaluate(
        `document.querySelector('${sel("add-to-cart-div")}').tabIndex`,
      ),
    ).toBe(-1);
    await page.focus(sel("wishlist-button"));
    await page.keyboard.press("Enter");
    expect(
      await page.evaluate('document.getElementById("status").textContent'),
    ).toBe("Saved to wishlist");
    await page.close();
  });
});

describe("seed output location", () => {
  it("keeps generated variants out of git", () => {
    const ignore = readFileSync(join(BENCH, ".gitignore"), "utf8").split("\n");
    expect(ignore).toContain("corpus/dev/variants/");
    expect(existsSync(join(CORPUS, "labels.json"))).toBe(true);
  });
});
