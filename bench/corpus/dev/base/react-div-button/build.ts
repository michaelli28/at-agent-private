// Bundles the React fixture against a pinned React in the gitignored bench/corpus/dev/.deps (never the repo's
// package.json), the same approach as bench/probes/react/build.mjs. app.js is gitignored; esbuild output is deterministic.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const HERE = dirname(fileURLToPath(import.meta.url));
const REACT_VERSION = "18.3.1";
const PREFIX = resolve(HERE, "..", "..", ".deps", `react-${REACT_VERSION}`);
const NODE_MODULES = join(PREFIX, "node_modules");
export const REACT_BUNDLE = join(HERE, "app.js");

const PackageJsonSchema = z.object({ version: z.string() });

function installedVersion(pkg: string): string | null {
  const file = join(NODE_MODULES, pkg, "package.json");
  if (!existsSync(file)) return null;
  return PackageJsonSchema.parse(JSON.parse(readFileSync(file, "utf8")))
    .version;
}

const pinned = (): boolean =>
  installedVersion("react") === REACT_VERSION &&
  installedVersion("react-dom") === REACT_VERSION;

function ensurePinnedReact(): void {
  if (pinned()) return;
  mkdirSync(PREFIX, { recursive: true });
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      PREFIX,
      "--no-audit",
      "--no-fund",
      "--prefer-offline",
      `react@${REACT_VERSION}`,
      `react-dom@${REACT_VERSION}`,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  if (!pinned())
    throw new Error(
      `react/react-dom ${REACT_VERSION} missing from ${NODE_MODULES} after npm install`,
    );
}

export async function buildReactBase(): Promise<void> {
  ensurePinnedReact();
  const result = await build({
    entryPoints: [join(HERE, "src", "main.jsx")],
    bundle: true,
    format: "iife",
    minify: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    nodePaths: [NODE_MODULES],
    outfile: REACT_BUNDLE,
    metafile: true,
    logLevel: "warning",
  });
  // Bare imports resolve up the directory tree before nodePaths, so prove every package came from the pinned install.
  const foreign = Object.keys(result.metafile.inputs)
    .filter((p) => p.includes("node_modules/"))
    .map((p) => resolve(p))
    .filter((p) => !p.startsWith(NODE_MODULES + sep));
  if (foreign.length > 0)
    throw new Error(
      `React bundle pulled packages from outside ${NODE_MODULES}: ${foreign[0]}`,
    );
}
