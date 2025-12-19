"""Shared TypeScript project macro for the monorepo."""

load("@aspect_rules_ts//ts:defs.bzl", _ts_project = "ts_project")

def ts_project(name, srcs = None, deps = [], **kwargs):
    """Wrapper around ts_project with monorepo defaults."""
    if srcs == None:
        srcs = native.glob(
            ["src/**/*.ts", "src/**/*.tsx"],
            exclude = ["**/*.test.ts", "**/*.spec.ts"],
            allow_empty = True,
        )

    _ts_project(
        name = name,
        srcs = srcs,
        tsconfig = "//:tsconfig",
        deps = deps,
        **kwargs
    )
