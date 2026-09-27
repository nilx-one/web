#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -Eeuo pipefail

test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

mock_bin="$test_dir/bin"
fixtures="$test_dir/fixtures"
mkdir -p "$mock_bin" "$fixtures/logs"

# Runs as the infra API reports them: id, created_at, status, conclusion.
# 101 identity (older), 102 web for another image, 103 telegram, 104 web for our image.
cat >"$fixtures/runs.json" <<'JSON'
{"workflow_runs": [
  {"id": 104, "created_at": "2026-09-27T15:00:30Z", "status": "completed", "conclusion": "success", "html_url": "https://infra/runs/104"},
  {"id": 103, "created_at": "2026-09-27T15:00:20Z", "status": "completed", "conclusion": "failure", "html_url": "https://infra/runs/103"},
  {"id": 102, "created_at": "2026-09-27T15:00:10Z", "status": "completed", "conclusion": "success", "html_url": "https://infra/runs/102"},
  {"id": 101, "created_at": "2026-09-27T14:00:00Z", "status": "completed", "conclusion": "success", "html_url": "https://infra/runs/101"}
]}
JSON

write_log() {
  printf '2026-09-27T15:00:00.0000000Z   WORKLOAD: %s\r\n2026-09-27T15:00:00.0000001Z   IMAGE_REF: %s\r\n' "$2" "$3" \
    >"$fixtures/logs/$1"
}
write_log 1101 nilxone-identity ghcr.io/nilx-one/0x1-identity:sha-1111111111111111111111111111111111111111
write_log 1102 nilxone-web ghcr.io/nilx-one/0x1-web:sha-2222222222222222222222222222222222222222
write_log 1103 nilxone-telegram ghcr.io/nilx-one/0x1-web:sha-3333333333333333333333333333333333333333
write_log 1104 nilxone-web ghcr.io/nilx-one/0x1-web:sha-3333333333333333333333333333333333333333

cat >"$mock_bin/gh" <<MOCK
#!/usr/bin/env bash
set -euo pipefail
path="" filter="" status_filter=""
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    api) shift ;;
    --method) shift 2 ;;
    --jq) filter="\$2"; shift 2 ;;
    -f)
      case "\$2" in status=*) status_filter="\${2#status=}" ;; esac
      shift 2
      ;;
    *) path="\$1"; shift ;;
  esac
done
case "\$path" in
  */actions/workflows/*/runs)
    if [ -n "\$status_filter" ]; then
      jq --arg c "\$status_filter" '.workflow_runs |= map(select(.conclusion == \$c))' "$fixtures/runs.json" | jq -r "\$filter"
    else
      jq -r "\$filter" "$fixtures/runs.json"
    fi
    ;;
  */actions/runs/*/jobs)
    run_id="\${path%/jobs}"; run_id="\${run_id##*/}"
    jq -rn --argjson id "\$run_id" '{jobs: [{id: (\$id + 1000), name: "Resolve placement from contracts", status: "completed"}]}' | jq -r "\$filter"
    ;;
  */actions/runs/*)
    run_id="\${path##*/}"
    jq --argjson id "\$run_id" '.workflow_runs[] | select(.id == \$id)' "$fixtures/runs.json" | jq -r "\$filter"
    ;;
  *) echo "unexpected gh path \$path" >&2; exit 1 ;;
esac
MOCK

cat >"$mock_bin/curl" <<MOCK
#!/usr/bin/env bash
set -euo pipefail
for arg in "\$@"; do url="\$arg"; done
job_id="\${url%/logs}"; job_id="\${job_id##*/}"
cat "$fixtures/logs/\$job_id"
MOCK
chmod +x "$mock_bin/gh" "$mock_bin/curl"

script="$(dirname "$0")/infra-workload.sh"
run() {
  PATH="$mock_bin:$PATH" GH_TOKEN=test INFRA_REPOSITORY=aiaiaiai-org/infra \
    INFRA_POLL_INTERVAL=0 INFRA_AWAIT_TIMEOUT=0 bash "$script" "$@"
}

output="$(run await nilxone-web ghcr.io/nilx-one/0x1-web:sha-3333333333333333333333333333333333333333 2026-09-27T15:00:05Z)"
grep -Fq "Infra run 104 activates nilxone-web." <<<"$output" || { echo "await picked the wrong run: $output" >&2; exit 1; }
grep -Fq "succeeded: https://infra/runs/104" <<<"$output" || { echo "await did not report success: $output" >&2; exit 1; }

if run await nilxone-telegram ghcr.io/nilx-one/0x1-web:sha-3333333333333333333333333333333333333333 2026-09-27T15:00:05Z >/dev/null 2>&1; then
  echo "await must fail when the infra run fails" >&2
  exit 1
fi

if run await nilxone-discord ghcr.io/nilx-one/0x1-web:sha-3333333333333333333333333333333333333333 2026-09-27T15:00:05Z >/dev/null 2>&1; then
  echo "await must time out when no infra run activates the workload" >&2
  exit 1
fi

[ "$(run active-image nilxone-web)" = ghcr.io/nilx-one/0x1-web:sha-3333333333333333333333333333333333333333 ] ||
  { echo "active-image must return the newest successful web image" >&2; exit 1; }
[ "$(run active-image nilxone-identity)" = ghcr.io/nilx-one/0x1-identity:sha-1111111111111111111111111111111111111111 ] ||
  { echo "active-image must find identity behind other workloads" >&2; exit 1; }
[ -z "$(run active-image nilxone-telegram)" ] ||
  { echo "active-image must ignore failed deployments" >&2; exit 1; }

echo "infra-workload tests passed"
