"""Shared esbuild macros for bundling."""

load("@aspect_rules_esbuild//esbuild:defs.bzl", _esbuild = "esbuild")

def esbuild_bundle(name, entry_point, deps = [], external = [], platform = "node", **kwargs):
    """Bundle TypeScript/JavaScript with esbuild.

    Args:
        name: Target name
        entry_point: Entry point file
        deps: Dependencies
        external: External packages to exclude from bundle
        platform: Target platform (node, browser, neutral)
        **kwargs: Additional arguments passed to esbuild
    """
    _esbuild(
        name = name,
        entry_point = entry_point,
        deps = deps,
        platform = platform,
        target = "es2020",
        external = external + [
            # Common externals for Node.js
            "playwright",
            "@langchain/*",
            "langchain",
            "openai",
            "dotenv",
            "tiktoken",
        ],
        minify = select({
            "//:release": True,
            "//conditions:default": False,
        }),
        sourcemap = select({
            "//:release": "external",
            "//conditions:default": "inline",
        }),
        **kwargs
    )

def browser_bundle(name, entry_point, deps = [], **kwargs):
    """Bundle for browser injection.

    Args:
        name: Target name
        entry_point: Entry point file
        deps: Dependencies
        **kwargs: Additional arguments
    """
    _esbuild(
        name = name,
        entry_point = entry_point,
        deps = deps,
        platform = "browser",
        target = "es2020",
        format = "iife",
        minify = True,
        **kwargs
    )
