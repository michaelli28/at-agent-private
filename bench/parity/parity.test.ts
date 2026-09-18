// Parity: the UNMODIFIED taskgen dual crawl vs the packages/accessibility port, same local URL, same Chromium.
// Run from the worktree root: npx vitest run bench/parity
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { ElementCrawler } from '../../taskgen/src/element-crawler'
import { crawlPageWithGapDetection } from '../../packages/accessibility/src/gaps/detect.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const BENCH = resolve(HERE, '..')
const REACT_DIR = join(BENCH, 'probes', 'react')
const REACT_BUILDS = ['react18-prod', 'react18-dev', 'react19-prod', 'react19-dev', 'control']

// URL prefix -> directory served under it.
const ROOTS: Record<string, string> = {
  parity: join(HERE, 'fixtures'),
  wrap: join(BENCH, 'probes', 'wrap', 'fixtures'),
  react: join(REACT_DIR, 'dist'),
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
}

type GapTypeCounts = Partial<Record<string, number>>

// Gap types each fixture produces on the baseline, recorded from the unmodified taskgen detector.
const FIXTURES: Array<{ name: string; path: string; expected: GapTypeCounts }> = [
  { name: 'good-operable', path: '/parity/good-operable.html', expected: {} },
  {
    name: 'branches-inline',
    path: '/parity/branches-inline.html',
    expected: {
      missing_from_a11y_tree: 7,
      no_accessible_name: 3,
      not_focusable: 2,
      wrong_role: 2,
    },
  },
  {
    name: 'branches-scripted',
    path: '/parity/branches-scripted.html',
    expected: {
      missing_from_a11y_tree: 4,
      not_focusable: 3,
      no_accessible_name: 1,
      wrong_role: 1,
      hidden_but_interactive: 1,
    },
  },
  ...['a', 'b', 'c', 'd', 'e'].map((f) => ({
    name: `wrap-${f}`,
    path: `/wrap/${f}.html`,
    expected: {},
  })),
  ...REACT_BUILDS.map((b) => ({
    name: b,
    path: `/react/${b}/index.html`,
    expected: { missing_from_a11y_tree: 1 },
  })),
]

// Structural views that both taskgen's and the port's result types satisfy.
interface DomLike {
  nodeName: string
  localName: string
  attributes: Record<string, string>
  boundingBox?: { x: number; y: number; width: number; height: number } | null
}
interface GapLike {
  domElement: DomLike
  signals: object
  gapType: string
  severity: string
  evidence: string
}
interface AxLike {
  role: string
  name: string
  description?: string
  value?: string
  typeFlags: object
}
interface ResultLike {
  domElements: DomLike[]
  gaps: GapLike[]
  accessibilityTree: { elements: Map<string, AxLike>; title: string }
}

function gapKey(g: GapLike): string {
  const a = g.domElement.attributes
  return JSON.stringify([
    g.domElement.nodeName,
    a['id'] ?? null,
    a['class'] ?? null,
    a['data-bench-id'] ?? null,
    g.gapType,
    g.severity,
    g.evidence,
  ])
}

const gapMultiset = (r: ResultLike): string[] => r.gaps.map(gapKey).sort()

const gapSignals = (r: ResultLike): string[] => r.gaps.map((g) => JSON.stringify([gapKey(g), g.signals])).sort()

// Ordered enumeration without backendNodeId, which is process-specific.
const enumeration = (r: ResultLike): string[] =>
  r.domElements.map((e) => JSON.stringify([e.nodeName, e.localName, e.attributes, e.boundingBox ?? null]))

const axProjection = (r: ResultLike): string[] =>
  [...r.accessibilityTree.elements.values()].map((n) =>
    JSON.stringify([n.role, n.name, n.description ?? null, n.value ?? null, n.typeFlags]),
  )

function countByType(r: ResultLike): GapTypeCounts {
  const counts: Record<string, number> = {}
  for (const g of r.gaps) counts[g.gapType] = (counts[g.gapType] ?? 0) + 1
  return counts
}

function startServer(): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer((req, res) => {
    const [, prefix, ...rest] = (req.url ?? '/').split('?')[0].split('/')
    const root = ROOTS[prefix]
    const file = root ? resolve(root, ...rest.map(decodeURIComponent)) : ''
    if (!root || !file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    })
    res.end(readFileSync(file))
  })
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      ok({ server, base: `http://127.0.0.1:${port}` })
    })
  })
}

async function runPort(browser: Browser, url: string): Promise<ResultLike> {
  // Fresh context per page, as taskgen does.
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    return await crawlPageWithGapDetection(page, url)
  } finally {
    await context.close()
  }
}

describe('gap detector parity: taskgen original vs accessibility port', () => {
  let server: http.Server
  let base: string
  let browser: Browser
  const taskgen = new ElementCrawler({ headless: true })
  const recorded: Array<{
    fixture: string
    gapTypes: GapTypeCounts
    total: number
  }> = []

  beforeAll(async () => {
    if (!REACT_BUILDS.every((b) => existsSync(join(REACT_DIR, 'dist', b, 'index.html')))) {
      execFileSync(process.execPath, [join(REACT_DIR, 'build.mjs')], {
        stdio: 'inherit',
      })
    }
    ;({ server, base } = await startServer())
    browser = await chromium.launch({ headless: true })
    await taskgen.init()
  }, 180000)

  afterAll(async () => {
    console.log(
      ['Gap types per fixture (identical in both implementations):']
        .concat(recorded.map((r) => `  ${r.fixture}: ${r.total} ${JSON.stringify(r.gapTypes)}`))
        .join('\n'),
    )
    await taskgen.close()
    await browser?.close()
    server?.close()
  })

  for (const fixture of FIXTURES) {
    it(`${fixture.name}: same gaps, enumeration, signals and AX projection`, async () => {
      const url = `${base}${fixture.path}`
      const [original, port] = await Promise.all([taskgen.crawlPageWithGapDetection(url), runPort(browser, url)])

      expect(gapMultiset(port)).toEqual(gapMultiset(original))
      expect(enumeration(port)).toEqual(enumeration(original))
      expect(axProjection(port)).toEqual(axProjection(original))
      expect(port.accessibilityTree.title).toBe(original.accessibilityTree.title)

      // The result exposes signals only on gaps, so they are compared per gap.
      expect(gapSignals(port)).toEqual(gapSignals(original))

      expect(countByType(port)).toEqual(fixture.expected)
      recorded.push({
        fixture: fixture.name,
        gapTypes: countByType(port),
        total: port.gaps.length,
      })
    }, 60000)
  }
})
