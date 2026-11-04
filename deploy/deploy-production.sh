#!/usr/bin/env bash
# Production deployment of AgentTalks through docker compose.
#
# Compose is the ONLY supported way to run it (see docker-compose.yml). This
# script adds three things compose alone cannot do:
#   1. a backup BEFORE replacement,
#   2. checking that the container received the intended data volume,
#   3. verifying BOTH sides of the gate after startup.
#
# Check 2 exists because this failure passes every ordinary test: compose builds
# its default volume name from the project name, so a mistake mounts an EMPTY
# volume. The server starts, is `healthy`, the gate works and the API answers,
# but the conversations are gone. We check the volume name and message count,
# not just whether the server is alive.
set -euo pipefail

select_env_file() {
  ENV_FILE=${AGENTTALKS_ENV_FILE:-/etc/agenttalks/instance.env}
  if [[ -z ${AGENTTALKS_ENV_FILE:-} && ! -e $ENV_FILE && -e /etc/agenttalks/instancja.env ]]; then
    ENV_FILE=/etc/agenttalks/instancja.env
  fi
  echo "Using environment file: $ENV_FILE"
}
select_env_file
# Directory containing docker-compose.yml (the repo); defaults to this script's parent.
REPO_DIR=${AGENTTALKS_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
# Read names from the SAME file passed to compose. Otherwise the script would
# check something different from what compose starts, making the check decorative.
# Keep `|| true`: grep returns 1 when it finds nothing, and `set -e` would then
# kill the script without a line of output. That actually happened and looked
# like "the script does nothing". A missing setting means "use the default",
# not "abort without a word".
from_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true; }

# The gate request body {"password": "..."} built by a JSON encoder, not by printf:
# a password containing a double quote or a backslash used to produce invalid JSON,
# and the post-deploy check then failed with a misleading STOP. The password is read
# from the file by python itself, so it never appears on a command line (ps).
password_json() {
  # Fail loudly: under `set -euo pipefail` a failing helper inside $( ... | curl ) stops the
  # script with THIS message, instead of curl sending an empty body and the check below
  # reporting a misleading "the gate rejects the right password".
  command -v python3 >/dev/null 2>&1 || { echo "STOP: python3 is required to build the gate request body (password_json)." >&2; return 1; }
  python3 -c 'import json, sys; print(json.dumps({"password": open(sys.argv[1], encoding="utf-8").read().rstrip("\n")}))' "$1"
}

EXPECTED_VOLUME=$(from_env AGENTTALKS_DATA_VOLUME); EXPECTED_VOLUME=${EXPECTED_VOLUME:-agenttalks_data}
CONTAINER=$(from_env AGENTTALKS_CONTAINER); CONTAINER=${CONTAINER:-agenttalks}

if [[ ! -r $ENV_FILE ]]; then
  echo "Cannot read $ENV_FILE - refusing to guess production settings." >&2
  echo "Create it using deploy/instance.env.example as a template." >&2
  exit 1
fi

compose() { docker compose --env-file "$ENV_FILE" -f "$REPO_DIR/docker-compose.yml" "$@"; }

# State BEFORE the change, for comparison afterward. Without this number,
# "the server works" cannot distinguish a working server from an empty instance.
before=$(docker exec "$CONTAINER" node bin/agenttalks.js healthcheck --json 2>/dev/null || true)
PORT=$(from_env AGENTTALKS_HOST_PORT); PORT=${PORT:-8787}

# Read the last message id DIRECTLY FROM THE DATABASE in the container, not HTTP.
# Two reasons, both learned in practice: (1) /api/health deliberately hides counts
# from the world, and host requests reach the container from Docker's gateway,
# not loopback, so the "local" exception would not apply; (2) a data-loss check
# must ask the SOURCE, not whichever layer happens to display it.
message_counter() {
  docker exec "$CONTAINER" node -e '
    const {DatabaseSync}=require("node:sqlite");
    const db=new DatabaseSync("/data/agenttalks.sqlite",{readOnly:true});
    process.stdout.write(String(db.prepare("SELECT COALESCE(MAX(id),0) x FROM messages").get().x));
  ' 2>/dev/null || true
}
messages_before=$(message_counter)
echo "before deployment: last message = ${messages_before:-none (container is not running)}"

echo "== backup =="
docker exec "$CONTAINER" node bin/agenttalks.js backup /data/backups >/dev/null 2>&1 \
  || echo "(container is not running - skipping backup)"

# A container created manually (`docker run`) does not belong to compose, which
# cannot adopt it and fails with a name conflict. This is a one-time migration
# to compose, but the script must handle it instead of leaving a human with
# "name already in use" at 2 a.m.
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  owner=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}')
  if [[ -z $owner ]]; then
    echo "== old container outside compose - removing before replacement =="
    docker rm -f "$CONTAINER" >/dev/null
  fi
fi

echo "== compose up =="
compose up -d --build

echo "== data volume check =="
# This check is why the script exists: ask Docker what is ACTUALLY mounted at
# /data instead of trusting that the YAML file worked.
volume=$(docker inspect "$CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
echo "mounted volume: ${volume:-NONE}"
if [[ $volume != "$EXPECTED_VOLUME" ]]; then
  echo "STOP: /data has '${volume:-nothing}', expected '$EXPECTED_VOLUME'." >&2
  echo "Refusing to continue - this is where an empty instance pretends to be healthy." >&2
  exit 1
fi

echo "== verification =="
# Wait for a SETTLED verdict, not elapsed time. `starting` means "not known yet",
# not failure; `unhealthy` is failure, so waiting longer would be pointless.
# The 90 s window follows the Dockerfile probe settings (start-period 20 s +
# interval 15 s x retries 3). It must outlast the time Docker can still change
# its verdict, or the script reports STOP for a server already answering.
# That happened once.
for _ in $(seq 1 90); do
  state=$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)
  [[ $state == healthy || $state == unhealthy ]] && break
  sleep 1
done
echo "health: ${state:-missing}"

health=$(curl -s "http://127.0.0.1:${PORT}/api/health")
echo "health API: $health"
messages_after=$(message_counter)
echo "last message: before ${messages_before:-?} -> after ${messages_after:-?}"

if [[ -n ${messages_before:-} && ${messages_after:-0} -lt ${messages_before} ]]; then
  echo "STOP: last message id was $messages_before before deployment, now $messages_after." >&2
  echo "The server is seeing DIFFERENT data from a moment ago." >&2
  exit 1
fi

# Gate: 401 proves only that something is rejected. A 200 for the correct password
# proves it admits the owners, and that is the half that silently breaks whenever
# the way the password is supplied changes.
status_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/")
echo "gate closed (expected 401, or 200 with the gate disabled): $status_code"
password_host=$(from_env AGENTTALKS_SECRETS_DIR)/site-password
if [[ -r $password_host ]]; then
  # Pass the password to curl through STDIN (--data @-), NOT a command-line
  # argument. Process arguments (including `curl ... --data "plaintext-password"`)
  # are visible in `ps aux` / `/proc/<pid>/cmdline` to everyone on the machine
  # for the whole request. STDIN leaves no such trace.
  accepted=$(password_json "$password_host" | curl -s -o /dev/null \
    -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/api/site-gate" \
    -H 'content-type: application/json' --data @-)
  echo "gate accepts the correct password (expected 200): $accepted"
  [[ $accepted == 200 ]] || { echo "STOP: the gate rejects the correct password." >&2; exit 1; }
  [[ $status_code == 401 ]] || { echo "STOP: the gate is enabled but the page returns $status_code." >&2; exit 1; }
fi

# Will the INTERFACE load? This script used to check the server, database and
# gate, all of which worked while the page was BLANK: i18n.js was missing from
# the served module list, so a 404 broke the browser's entire module graph.
# Tests, tsc, CI and this script all missed it because none fetched UI modules.
#
# Fetch the files used by the application shell and check that each returns.
# Check individual files, not just "/": that returns the HTML skeleton even
# when no module can load, answering 200 to a question nobody asked.
gate_header=()
if [[ -r $password_host ]]; then
  cookie=$(password_json "$password_host" | curl -s -i -X POST \
    "http://127.0.0.1:${PORT}/api/site-gate" -H 'content-type: application/json' --data @- \
    | tr -d '\r' | grep -i '^set-cookie:' | sed 's/set-cookie: *//; s/;.*//')
  [[ -n $cookie ]] && gate_header=(-H "cookie: ${cookie}")
fi
# The DIRECTORY is the source of the list, not HTML. The first version read
# src="" attributes from the shell, which names ONLY app.js; the rest arrive
# through module imports. It checked one file out of nineteen and stayed green
# when I deliberately removed i18n.js from the whitelist. Only a negative probe
# caught that: the "OK" result looked identical in both cases.
bad_modules=0; checked=0
for file in src/http/ui/js/*.js; do
  name=$(basename "$file"); checked=$((checked+1))
  module_code=$(curl -s -o /dev/null -w '%{http_code}' "${gate_header[@]}" \
    "http://127.0.0.1:${PORT}/js/${name}")
  [[ $module_code == 200 ]] || { echo "  MISSING: /js/${name} -> ${module_code}"; bad_modules=$((bad_modules+1)); }
done
echo "UI modules (${checked} files): $([[ $bad_modules == 0 ]] && echo OK || echo "${bad_modules} unavailable")"
[[ $checked -ge 15 ]] || { echo "STOP: checked only ${checked} modules - has the directory moved?" >&2; exit 1; }
[[ $bad_modules == 0 ]] || { echo "STOP: the interface will not load - blank page." >&2; exit 1; }

[[ $state == healthy ]] || { echo "STOP: the container is not healthy." >&2; exit 1; }
echo "OK (volume $volume, last message ${messages_after:-?})"
