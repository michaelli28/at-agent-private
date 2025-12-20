#!/bin/bash

REPO_ROOT="$(git rev-parse --show-toplevel)"
PREFIX="literature/business-plan"
REMOTE="https://git@git.overleaf.com/694623400618c09c191f5e2b"
BRANCH="master"

cd "$REPO_ROOT"

case "$1" in
  pull)
    echo "Pulling from Overleaf..."
    git subtree pull --prefix="$PREFIX" "$REMOTE" "$BRANCH"
    ;;
  push)
    echo "Pushing to Overleaf..."
    git subtree push --prefix="$PREFIX" "$REMOTE" "$BRANCH"
    ;;
  *)
    echo "Usage: ./sync.sh [pull|push]"
    echo "  pull - Pull updates from Overleaf"
    echo "  push - Push changes to Overleaf"
    exit 1
    ;;
esac
