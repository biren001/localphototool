#!/bin/sh
# Same sequence, same log file and same failure accounting as run-tests.bat, so a
# run from here is comparable with a run from the bat. Exists because the bat
# itself cannot be launched from a tool call.
set -u
# One level up from _dev/, i.e. the workspace root. (It said ../.. when this
# lived in _dev/.tmp/, which landed a directory too high and made every suite
# fail with "cannot find module" — the tests themselves were never at fault.)
cd "$(dirname "$0")/.." || exit 1
export PATH="/usr/bin:/bin:$PATH"
export NODE_PATH="C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules"
export CODEBUDDY_SAFE_DELETE_ENABLED=0
NODE="C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"

LOG="_dev/last-run.log"
mkdir -p _dev/.tmp
: > "$LOG"
echo "Local test suite - $(date)" >> "$LOG"
echo >> "$LOG"

FAILED=0
# check-listing-copy is pure file parsing, no server and no browser, so it sits
# at the front: if the distribution copy has drifted past a platform's limit,
# better to hear it before eight minutes of browser suites.
for T in check-listing-copy test-pages test-counter test-stats test-engine test-format test-headers \
         test-ios-save test-browser test-pwa test-chime test-share test-heic \
         test-warmup test-fidelity test-update audit-nav audit-overflow; do
  echo "==== $T"
  echo "==== $T" >> "$LOG"
  "$NODE" "_dev/$T.cjs" > _dev/.tmp/one.log 2>&1
  RC=$?
  [ "$RC" != "0" ] && FAILED=1
  # A suite that dies on a syntax error exits non-zero without printing a FAIL
  # line, so the exit code has to be recorded too — grepping the log for FAIL
  # is not enough to find it.
  echo "$T rc=$RC"
  echo "---- $T rc=$RC" >> "$LOG"
  tail -n 4 _dev/.tmp/one.log
  cat _dev/.tmp/one.log >> "$LOG"
done

echo "--------"
if [ "$FAILED" != "0" ]; then
  echo "Something FAILED"
  echo FAILED >> "$LOG"
else
  echo "All local checks passed."
  echo "All local checks passed." >> "$LOG"
fi

echo "==== FAIL lines across the run ===="
grep -n "FAIL" "$LOG" || echo "(none)"
