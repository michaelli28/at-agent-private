"""Shared TypeScript project macro for the monorepo."""

load("@aspect_rules_ts//ts:defs.bzl", _ts_project = "ts_project")

def ts_project(name, srcs = None, deps = [], **kwargs):
    """Wrapper around ts_project with monorepo defaults.

    Args:
        name: Target name
        srcs: Source files (defaults to glob of src/**/*.ts)
        deps: Dependencies
        **kwargs: Additional arguments passed to ts_project
    """
    if srcs == None:
        srcs = native.glob(
            ["src/**/*.ts", "src/**/*.tsx"],
            exclude = ["**/*.test.ts", "**/*.spec.ts"],
        )

    _ts_project(
        name = name,
        srcs = srcs,
        declaration = True,
        declaration_map = True,
        source_map = True,
        tsconfig = "//:tsconfig",
        deps = deps + [
            "@npm//:node_modules",
        ],
        **kwargs
    )

def ts_test(name, srcs = None, deps = [], **kwargs):
    """TypeScript test target with monorepo defaults.

    Args:
        name: Target name
        srcs: Test source files (defaults to glob of **/*.test.ts)
        deps: Dependencies
        **kwargs: Additional arguments
    """
    if srcs == None:
        srcs = native.glob(["src/**/*.test.ts", "src/**/*.spec.ts"])

    _ts_project(
        name = name,
        srcs = srcs,
        declaration = False,
        tsconfig = "//:tsconfig",
        deps = deps + [
            "@npm//:node_modules",
        ],
        testonly = True,
        **kwargs
    )
