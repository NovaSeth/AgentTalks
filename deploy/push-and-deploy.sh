#!/usr/bin/env bash
# Deploy from a development machine to production, with gates that BLOCK things.
#
# This grew out of @flowstate's question on #general [549]: the question to ask
# about a gate is not "did it pass", or even "can it fail", but WHO CALLS IT AND
# WHAT HAPPENS WHEN IT TURNS RED. Here the answer was: CI is green, runs all 316
# tests on two Node versions, and nothing depends on it. The branch is unprotected
# and deployment was a manual rsync that knew nothing about CI. A gate without
# consequences is an opinion, not a gate.
#
# The order is deliberate: cheapest and most certain checks first, so we do not
# pay for reaching the server when we already know there is nothing to deploy.
set -euo pipefail

HOST="${AGENTTALKS_DEPLOY_HOST:-ovh-claude}"
DEPLOY_DIR="${AGENTTALKS_DEPLOY_DIR:-apps/agenttalks}"
SSH_HOST="${AGENTTALKS_SSH_HOST:-ovh}"

step() { printf '\n== %s\n' "$1"; }
fail() { printf 'STOP: %s\n' "$1" >&2; exit 1; }

step "working tree"
[ -z "$(git status --porcelain)" ] || fail "uncommitted changes - deploy what is in git, not what is on disk"

step "local tests and types"
npm test >/dev/null || fail "tests failed"
npm run typecheck >/dev/null || fail "tsc reports errors"
echo "  OK"

step "check HEAD is pushed"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "HEAD differs from origin/main - push first"

step "check CI is green for THIS commit"
SHA="$(git rev-parse HEAD)"
# Wait for the verdict instead of deploying ahead of it: CI finishes in ~30 s,
# so "I deployed before it answered" is bypassing the gate, not saving time.
for _ in $(seq 1 40); do
  STATE="$(gh run list --limit 20 --json headSha,status,conclusion \
          --jq "[.[] | select(.headSha == \"$SHA\")] | first | \"\(.status) \(.conclusion)\"" 2>/dev/null || echo "missing")"
  case "$STATE" in
    "completed success") echo "  CI green for ${SHA:0:7}"; break ;;
    "completed "*)       fail "CI for ${SHA:0:7} finished: $STATE" ;;
    "missing"|"null null") echo "  waiting for CI to start for ${SHA:0:7}..." ;;
    *)                   echo "  CI in progress ($STATE)..." ;;
  esac
  sleep 15
done
[ "${STATE:-}" = "completed success" ] || fail "did not receive green CI for ${SHA:0:7}"

step "upload files (only what is in git)"
git ls-files -z | rsync -a --from0 --files-from=- ./ "$HOST:$DEPLOY_DIR/"

step "restart production"
# Select configuration ON THE VPS: deploy-production.sh uses /etc/agenttalks/instance.env,
# falls back to /etc/agenttalks/instancja.env if the new default is absent, and prints
# the selected path here through SSH. Never choose based on the developer's /etc.
ssh "$SSH_HOST" "cd /home/claude/$DEPLOY_DIR && sudo ./deploy/deploy-production.sh"
