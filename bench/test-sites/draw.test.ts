import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SEED,
  candidates,
  classifyNavError,
  domainPrecheck,
  judge,
  markDuplicates,
  observe,
  parseTranco,
  rankForIndex,
  urlsFor,
  type Judgement,
  type Observation,
  type PageFacts,
} from "./draw.js";

// Oracle values from `printf '<seed>:<i>' | shasum -a 256` + python int(hex[:8], 16) — no node involved.
const PINNED_FIRST_FIVE = [80782, 22399, 90298, 22996, 69549];

// Independent path: hex-string parse instead of the generator's Buffer.readUInt32BE.
function oracleRank(i: number): number {
  const hex = createHash("sha256")
    .update(`at-agent-bench-2026-09-18:${i}`)
    .digest("hex");
  return 10001 + (parseInt(hex.slice(0, 8), 16) % 90000);
}

describe("candidate generator", () => {
  it("uses the pre-registered seed", () => {
    expect(SEED).toBe("at-agent-bench-2026-09-18");
  });

  it("matches an independent node:crypto computation for the first five ranks", () => {
    const fromGenerator = [0, 1, 2, 3, 4].map((i) => rankForIndex(SEED, i));
    expect(fromGenerator).toEqual([0, 1, 2, 3, 4].map(oracleRank));
    expect(fromGenerator).toEqual(PINNED_FIRST_FIVE);
  });

  it("walks i = 0,1,2,… and yields the pinned ranks first", () => {
    const it5 = candidates(SEED);
    const first = Array.from({ length: 5 }, () => it5.next().value);
    expect(first).toEqual(
      PINNED_FIRST_FIVE.map((rank, i) => ({ i, rank, duplicate: false })),
    );
  });

  it("keeps every rank inside 10,001..100,000", () => {
    for (let i = 0; i < 5000; i++) {
      const r = rankForIndex(SEED, i);
      expect(r).toBeGreaterThanOrEqual(10001);
      expect(r).toBeLessThanOrEqual(100000);
    }
  });

  it("marks a rank already drawn as a duplicate and keeps i counting", () => {
    expect([...markDuplicates([5, 7, 5, 9, 7])]).toEqual([
      { i: 0, rank: 5, duplicate: false },
      { i: 1, rank: 7, duplicate: false },
      { i: 2, rank: 5, duplicate: true },
      { i: 3, rank: 9, duplicate: false },
      { i: 4, rank: 7, duplicate: true },
    ]);
  });
});

describe("parseTranco", () => {
  it("maps rank r to row r and strips CRLF", () => {
    expect(
      parseTranco("1,google.com\r\n2,cloudflare.com\r\n3,facebook.com\r\n"),
    ).toEqual(["google.com", "cloudflare.com", "facebook.com"]);
  });

  it("rejects a file whose ranks are out of order", () => {
    expect(() => parseTranco("1,a.com\n3,b.com\n")).toThrow(/row 2/);
  });
});

describe("urls and domain prechecks", () => {
  it("builds https://<domain>/ and the one www fallback", () => {
    expect(urlsFor("example.org")).toEqual({
      primary: "https://example.org/",
      fallback: "https://www.example.org/",
    });
  });

  it("has no defined fallback for a domain that already starts with www.", () => {
    expect(urlsFor("www.example.org").fallback).toBeNull();
  });

  it("rejects adult-keyword domains (rule 5) and dev-set/w3.org domains (rule 6) without a load", () => {
    expect(domainPrecheck("essex.ac.uk")).toBe(5);
    expect(domainPrecheck("cmu.edu")).toBe(6);
    expect(domainPrecheck("www.cmu.edu")).toBe(6);
    expect(domainPrecheck("w3.org")).toBe(6);
    expect(domainPrecheck("amazon.com")).toBe(6);
    expect(domainPrecheck("troy.k12.mi.us")).toBe(6);
    expect(domainPrecheck("example.org")).toBeNull();
    expect(domainPrecheck("amazon.de")).toBeNull();
  });

  it('treats only clear connection failures as "fails to connect"', () => {
    expect(classifyNavError("ERR_NAME_NOT_RESOLVED")).toBe("connect-failure");
    expect(classifyNavError("ERR_CONNECTION_REFUSED")).toBe("connect-failure");
    expect(classifyNavError("ERR_CERT_COMMON_NAME_INVALID")).toBe("undecided");
    expect(classifyNavError("ERR_CONNECTION_RESET")).toBe("undecided");
  });
});

// Rule numbers left undecided; [] unless the verdict is a stop.
function stoppedOn(v: Judgement): number[] {
  return v.result === "stop"
    ? v.reasons.map((r) => Number(/^rule (\d)/.exec(r)?.[1]))
    : [];
}

const cleanPage: PageFacts = {
  botWall: {
    csRaw: false,
    ciRaw: false,
    csWs: false,
    ciWs: false,
    ciAlternatives: [],
  },
  focusableMain: 12,
  focusableElsewhere: 0,
  rtaStrict: false,
  rtaLoose: false,
};
const okObs: Observation = {
  finalUrl: "https://example.org/",
  status: 200,
  contentType: "text/html; charset=utf-8",
  cfMitigated: "none",
  loadIssue: null,
  page: cleanPage,
};

describe("judge", () => {
  it("accepts when every rule clearly holds", () => {
    expect(judge("example.org", okObs)).toEqual({ result: "accept" });
  });

  it("labels a reject with the lowest clearly failing rule", () => {
    const obs: Observation = {
      ...okObs,
      status: 403,
      page: { ...cleanPage, focusableMain: 0 },
    };
    expect(judge("example.org", obs)).toEqual({ result: "reject", rule: 1 });
  });

  it("rejects on rule 1 when neither attempt got a response", () => {
    const obs: Observation = {
      ...okObs,
      finalUrl: null,
      status: null,
      contentType: null,
      page: null,
    };
    expect(judge("example.org", obs)).toEqual({ result: "reject", rule: 1 });
  });

  it("stops when the regex readings disagree and nothing else fails", () => {
    const page = {
      ...cleanPage,
      botWall: {
        csRaw: false,
        ciRaw: true,
        csWs: false,
        ciWs: true,
        ciAlternatives: ["captcha"],
      },
    };
    const verdict = judge("example.org", { ...okObs, page });
    expect(stoppedOn(verdict)).toEqual([3]);
  });

  it("still rejects on a clear failure when another rule is undecided", () => {
    const page = {
      ...cleanPage,
      focusableMain: 0,
      botWall: {
        csRaw: false,
        ciRaw: true,
        csWs: false,
        ciWs: true,
        ciAlternatives: ["captcha"],
      },
    };
    expect(judge("example.org", { ...okObs, page })).toEqual({
      result: "reject",
      rule: 4,
    });
  });

  it("stops on a load issue unless a domain rule clearly fails", () => {
    const obs: Observation = {
      ...okObs,
      loadIssue: "x",
      status: null,
      page: null,
    };
    expect(stoppedOn(judge("example.org", obs))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(judge("sexy.example", obs)).toEqual({ result: "reject", rule: 5 });
  });

  it("stops when a same-name non-dev domain passes everything else", () => {
    expect(stoppedOn(judge("amazon.de", okObs))).toEqual([6]);
    expect(stoppedOn(judge("cmu.ac.th", okObs))).toEqual([6]);
  });

  it("stops when the final URL lands on a dev-set site or an adult-keyword host", () => {
    expect(
      stoppedOn(judge("example.org", { ...okObs, finalUrl: "https://www.amazon.com/" })),
    ).toEqual([6]);
    expect(
      stoppedOn(judge("example.org", { ...okObs, finalUrl: "https://xxx.example.net/" })),
    ).toEqual([5]);
  });
});

const HTML = { "content-type": "text/html; charset=utf-8" };
const LINK = '<a href="/">home</a>';
const NAV_TO_OK =
  '<script>addEventListener("load", () => setTimeout(() => { location.href = "/ok" }, 100))</script>';

type Route =
  | { status: number; headers: Record<string, string>; body: string }
  | "hang";
const ROUTES: Record<string, Route> = {
  "/ok": { status: 200, headers: HTML, body: `<title>ok</title>${LINK}` },
  "/redirect": { status: 302, headers: { location: "/ok" }, body: "" },
  "/404": { status: 404, headers: HTML, body: LINK },
  "/404-empty": { status: 404, headers: HTML, body: "" },
  "/json": {
    status: 200,
    headers: { "content-type": "application/json" },
    body: '{"a":1}',
  },
  "/no-ctype": { status: 200, headers: {}, body: LINK },
  "/cf": {
    status: 200,
    headers: { ...HTML, "cf-mitigated": "challenge" },
    body: LINK,
  },
  "/cf-then-nav": {
    status: 200,
    headers: { ...HTML, "cf-mitigated": "challenge" },
    body: NAV_TO_OK,
  },
  "/wall": {
    status: 200,
    headers: HTML,
    body: `<p>please verify you are human</p>${LINK}`,
  },
  "/wall-case": {
    status: 200,
    headers: HTML,
    body: `<p>Protected by reCAPTCHA</p>${LINK}`,
  },
  "/no-focus": { status: 200, headers: HTML, body: "<p>plain text only</p>" },
  "/iframe-only": {
    status: 200,
    headers: HTML,
    body: '<iframe src="/ok"></iframe>',
  },
  "/shadow-only": {
    status: 200,
    headers: HTML,
    body: '<div id="h"></div><script>document.getElementById("h").attachShadow({ mode: "open" }).innerHTML = \'<a href="/">x</a>\'</script>',
  },
  "/rta": {
    status: 200,
    headers: HTML,
    body: `<meta name="RATING" content="RTA-5042-1996-1400-1577-RTA">${LINK}`,
  },
  "/rta-case": {
    status: 200,
    headers: HTML,
    body: `<meta name="rating" content="rta-5042-1996-1400-1577-rta">${LINK}`,
  },
  "/js-nav": { status: 200, headers: HTML, body: NAV_TO_OK },
  "/push": {
    status: 200,
    headers: HTML,
    body: `${LINK}<script>history.pushState({}, "", "/pushed")</script>`,
  },
  "/hang": { status: 200, headers: HTML, body: `${LINK}<img src="/never">` },
  "/never": "hang",
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );
}

describe(
  "observe + judge on local fixtures (Chromium)",
  { timeout: 30_000 },
  () => {
    let browser: Browser;
    let base = "";
    let closedBase = "";
    const server = createServer((req, res) => {
      const route = ROUTES[req.url ?? ""];
      if (route === "hang") return; // never answer: holds the load event open
      if (!route) {
        res.writeHead(500).end();
        return;
      }
      res.writeHead(route.status, route.headers).end(route.body);
    });
    const fast = { settleMs: 300, loadTimeoutMs: 5_000 };

    beforeAll(async () => {
      base = `http://127.0.0.1:${await listen(server)}`;
      const closed = createServer();
      closedBase = `http://127.0.0.1:${await listen(closed)}`;
      await new Promise<void>((resolve) => closed.close(() => resolve()));
      browser = await chromium.launch();
    }, 30_000);

    afterAll(async () => {
      await browser?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    async function screenPath(path: string, timing = fast) {
      const obs = await observe(browser, `${base}${path}`, null, timing);
      return { obs, verdict: judge("fixture.test", obs) };
    }

    it("accepts a plain 200 HTML page with a link", async () => {
      const { obs, verdict } = await screenPath("/ok");
      expect(obs).toMatchObject({
        finalUrl: `${base}/ok`,
        status: 200,
        contentType: "text/html; charset=utf-8",
      });
      expect(verdict).toEqual({ result: "accept" });
    });

    it("follows an HTTP redirect to the final document", async () => {
      const { obs, verdict } = await screenPath("/redirect");
      expect(obs).toMatchObject({ finalUrl: `${base}/ok`, status: 200 });
      expect(verdict).toEqual({ result: "accept" });
    });

    it("rejects a 404 on rule 1, with or without a body", async () => {
      expect((await screenPath("/404")).verdict).toEqual({
        result: "reject",
        rule: 1,
      });
      const empty = await screenPath("/404-empty");
      expect(empty.obs.status).toBe(404);
      expect(empty.verdict).toEqual({ result: "reject", rule: 1 });
    });

    it("rejects non-HTML on rule 2 and stops when the content-type header is missing", async () => {
      expect((await screenPath("/json")).verdict).toEqual({
        result: "reject",
        rule: 2,
      });
      expect(stoppedOn((await screenPath("/no-ctype")).verdict)).toEqual([2]);
    });

    it("rejects a cf-mitigated final response on rule 3", async () => {
      const { obs, verdict } = await screenPath("/cf");
      expect(obs.cfMitigated).toBe("final");
      expect(verdict).toEqual({ result: "reject", rule: 3 });
    });

    it("stops when only an earlier document carried cf-mitigated", async () => {
      const { obs, verdict } = await screenPath("/cf-then-nav", {
        settleMs: 1_500,
        loadTimeoutMs: 5_000,
      });
      expect(obs).toMatchObject({
        finalUrl: `${base}/ok`,
        status: 200,
        cfMitigated: "earlier-only",
      });
      expect(stoppedOn(verdict)).toEqual([3]);
    });

    it("rejects lower-case bot-wall text on rule 3 and stops on a case-only match", async () => {
      expect((await screenPath("/wall")).verdict).toEqual({
        result: "reject",
        rule: 3,
      });
      const caseOnly = await screenPath("/wall-case");
      expect(caseOnly.obs.page?.botWall).toMatchObject({
        csRaw: false,
        ciRaw: true,
        ciAlternatives: ["captcha"],
      });
      expect(stoppedOn(caseOnly.verdict)).toEqual([3]);
    });

    it("rejects a page with no focusable element on rule 4", async () => {
      expect((await screenPath("/no-focus")).verdict).toEqual({
        result: "reject",
        rule: 4,
      });
    });

    it("stops when focusables exist only inside an iframe or a shadow root", async () => {
      const framed = await screenPath("/iframe-only");
      expect(framed.obs.page).toMatchObject({
        focusableMain: 0,
        focusableElsewhere: 1,
      });
      expect(stoppedOn(framed.verdict)).toEqual([4]);
      expect(stoppedOn((await screenPath("/shadow-only")).verdict)).toEqual([4]);
    });

    it("rejects an RTA label on rule 5 and stops on a case-folded-only RTA match", async () => {
      expect((await screenPath("/rta")).verdict).toEqual({
        result: "reject",
        rule: 5,
      });
      expect(stoppedOn((await screenPath("/rta-case")).verdict)).toEqual([5]);
    });

    it("judges the document present at load + settle after a JS navigation", async () => {
      const { obs, verdict } = await screenPath("/js-nav", {
        settleMs: 1_500,
        loadTimeoutMs: 5_000,
      });
      expect(obs).toMatchObject({
        finalUrl: `${base}/ok`,
        status: 200,
        cfMitigated: "none",
      });
      expect(verdict).toEqual({ result: "accept" });
    });

    it("records the pushState URL while judging the original document", async () => {
      const { obs, verdict } = await screenPath("/push");
      expect(obs).toMatchObject({ finalUrl: `${base}/pushed`, status: 200 });
      expect(verdict).toEqual({ result: "accept" });
    });

    it("stops when load never fires within the timeout", async () => {
      const { obs, verdict } = await screenPath("/hang", {
        settleMs: 300,
        loadTimeoutMs: 1_500,
      });
      expect(obs.loadIssue).toMatch(/load did not fire/);
      expect(stoppedOn(verdict)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("falls back once after a connection failure", async () => {
      const obs = await observe(browser, `${closedBase}/`, `${base}/ok`, fast);
      expect(obs).toMatchObject({ finalUrl: `${base}/ok`, status: 200 });
      expect(judge("fixture.test", obs)).toEqual({ result: "accept" });
    });

    it("rejects on rule 1 when both attempts fail to connect", async () => {
      const obs = await observe(
        browser,
        `${closedBase}/`,
        `${closedBase}/www`,
        fast,
      );
      expect(obs).toMatchObject({
        finalUrl: null,
        status: null,
        loadIssue: null,
      });
      expect(judge("fixture.test", obs)).toEqual({ result: "reject", rule: 1 });
    });

    it("stops when a fallback is needed but undefined", async () => {
      const obs = await observe(browser, `${closedBase}/`, null, fast);
      expect(obs.loadIssue).toMatch(/fallback is undefined/);
      expect(stoppedOn(judge("www.fixture.test", obs))).toEqual([1, 2, 3, 4, 5, 6]);
    });
  },
);
