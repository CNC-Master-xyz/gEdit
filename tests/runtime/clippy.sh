#!/bin/sh
# Clippy over the patched app that sync.sh built, so harness.rs is linted (run sync.sh first).
# Usage: tests/runtime/clippy.sh   (see tests/runtime/README.md)
exec node "$(dirname "$0")/harness/clippy.mjs" "$@"
