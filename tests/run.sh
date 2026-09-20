#!/usr/bin/env bash
# Runs the whole TurnZero test suite against throw-away Postgres + PostgREST containers.
#
#   bash run.sh             SQL suites + upgrade-from-v1 + app (jsdom) + Edge Function
#   bash run.sh --browser   ...plus real-Chrome tests (needs Chrome: set CHROME_PATH or CHROME_URL)
#
# Needs: node 22+, and podman or docker. Nothing is installed on your machine and the containers
# are removed when the run ends. It never contacts your real Supabase project.
set -uo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

ENGINE="${CONTAINER_ENGINE:-$(command -v podman || command -v docker || true)}"
[ -n "$ENGINE" ] || { echo "Need podman or docker installed."; exit 2; }
PG_PORT="${PG_PORT:-55432}"; REST_PORT="${REST_PORT:-33000}"
PG=tz-test-pg; REST=tz-test-rest
WITH_BROWSER=0; [ "${1:-}" = "--browser" ] && WITH_BROWSER=1
FAILED=()

cleanup() { $ENGINE rm -f "$PG" "$REST" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
psql_db() { local db="$1"; shift; $ENGINE exec -i "$PG" psql -p "$PG_PORT" -U postgres -d "$db" -q -v ON_ERROR_STOP=1 "$@"; }
no_ext() { grep -v -E '^create extension if not exists (pg_net|pg_cron)' "$1"; }   # pg_net / pg_cron only exist on Supabase
# run_sql <db> <file...>: helpers + files in one stream. NOTICE lines (PASS/FAIL) are shown, table output is not.
suite() { local db="$1" name="$2"; step "$name"; if cat sql/00_helpers.sql "sql/$name.sql" | psql_db "$db" >/dev/null; then :; else FAILED+=("$name"); fi; }
must() { "$@" >/dev/null 2>&1 || { echo "SETUP FAILED: $*"; exit 2; }; }

[ -d node_modules ] || { step "npm install"; npm install --no-audit --no-fund >/dev/null || exit 2; }

step "Starting Postgres ($ENGINE, port $PG_PORT)"
must $ENGINE run -d --name "$PG" --network host -e POSTGRES_PASSWORD=x docker.io/library/postgres:16-alpine -c port="$PG_PORT"
for i in $(seq 1 60); do $ENGINE exec "$PG" pg_isready -p "$PG_PORT" -U postgres >/dev/null 2>&1 && break; sleep 1; done
$ENGINE exec "$PG" pg_isready -p "$PG_PORT" -U postgres >/dev/null 2>&1 || { echo "Postgres did not start"; exit 2; }
psql_db postgres < sql/stubs_cluster.sql >/dev/null || exit 2
psql_db postgres -c "create database legacy" >/dev/null || exit 2

# ---------------------------------------------------------------- fresh install
step "Fresh install: 01, 02, then each again (both must be re-runnable)"
psql_db postgres < sql/stubs_db.sql >/dev/null || exit 2
for f in 01_setup_or_upgrade 02_lock_down 01_setup_or_upgrade 02_lock_down; do
  if no_ext "../sql/$f.sql" | psql_db postgres >/dev/null 2>&1; then echo "  ok   $f.sql"; else echo "  FAIL $f.sql"; FAILED+=("apply $f"); fi
done
suite postgres 10_security
suite postgres 20_timer_logic
suite postgres 30_alerts
suite postgres 40_penalties_push_cleanup

# ---------------------------------------------------------------- upgrade from the original v1 site
step "Upgrade from v1 (existing database with data): schema + seed -> 01 -> checks -> 02 -> checks"
psql_db legacy < sql/stubs_db.sql >/dev/null || exit 2
no_ext fixtures/legacy_v1_schema.sql | psql_db legacy >/dev/null 2>&1 || { echo "legacy schema failed"; exit 2; }
psql_db legacy < fixtures/legacy_v1_seed.sql >/dev/null || exit 2
no_ext ../sql/01_setup_or_upgrade.sql | psql_db legacy >/dev/null 2>&1 || FAILED+=("upgrade: apply 01")
suite legacy 50a_upgrade_after_01
no_ext ../sql/02_lock_down.sql | psql_db legacy >/dev/null 2>&1 || FAILED+=("upgrade: apply 02")
suite legacy 50b_upgrade_after_02

# ---------------------------------------------------------------- PostgREST + JS suites (fresh database)
step "Starting PostgREST (the same API layer Supabase uses) on port $REST_PORT"
export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
psql_db postgres -c "insert into private_config values ('functions_url','http://127.0.0.1:9/functions/v1') on conflict do nothing" >/dev/null
must $ENGINE run -d --name "$REST" --network host \
  -e PGRST_DB_URI="postgres://authenticator:x@127.0.0.1:$PG_PORT/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" -e PGRST_SERVER_PORT="$REST_PORT" \
  docker.io/postgrest/postgrest:latest
export API="http://127.0.0.1:$REST_PORT"
export ANON_KEY="$(node -e "console.log(require('jsonwebtoken').sign({role:'anon'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")"
for i in $(seq 1 30); do curl -s -o /dev/null "$API/" && break; sleep 1; done
curl -s -o /dev/null "$API/" || { echo "PostgREST did not start"; $ENGINE logs "$REST" | tail -5; exit 2; }

step "App end-to-end (jsdom + real supabase-js + real PostgREST + real Postgres)"
node e2e/app.test.js || FAILED+=("app e2e")

step "Edge Function (real source, mocked imports)"
node --no-warnings e2e/edge.test.mjs || FAILED+=("edge function")

if [ "$WITH_BROWSER" = 1 ]; then
  step "Real Chrome: CSP, service worker, offline, QR"
  node browser/chrome.test.js || FAILED+=("browser")
fi

# ---------------------------------------------------------------- verdict
echo
if [ ${#FAILED[@]} -eq 0 ]; then printf '\033[32mALL SUITES PASSED\033[0m\n'; exit 0; fi
printf '\033[31mFAILED: %s\033[0m\n' "${FAILED[*]}"; exit 1
