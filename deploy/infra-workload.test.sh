#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

set -Eeuo pipefail

test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

mock_bin="$test_dir/bin"
fixtures="$test_dir/fixtures"
mkdir -p "$mock_bin" "$fixtures/logs" "$fixtures/jobs"

web_image=ghcr.io/nilx-one/0x1-web:sha-3333333333333333333333333333333333333333
other_web_image=ghcr.io/nilx-one/0x1-web:sha-2222222222222222222222222222222222222222
identity_image=ghcr.io/nilx-one/0x1-identity:sha-1111111111111111111111111111111111111111

# Infra history, newest first as the API returns it. Tests dispatch after run 100.
cat >"$fixtures/runs.json" <<'JSON'
{"workflow_runs": [
  {"id": 105, "status": "in_progress", "conclusion": null, "html_url": "https://infra/runs/105"},
  {"id": 104, "status": "completed", "conclusion": "cancelled", "html_url": "https://infra/runs/104"},
  {"id": 103, "status": "completed", "conclusion": "success", "html_url": "https://infra/runs/103"},
  {"id": 102, "status": "completed", "conclusion": "failure", "html_url": "https://infra/runs/102"},
  {"id": 101, "status": "completed", "conclusion": "success", "html_url": "https://infra/runs/101"},
  {"id": 95, "status": "completed", "conclusion": "success", "html_url": "https://infra/runs/95"},
  {"id": 90, "status": "completed", "conclusion": "success", "html_url": "https://infra/runs/90"}
]}
JSON

placement() {
  printf '{"jobs": [{"id": %s, "name": "Resolve placement from contracts", "status": "%s"}]}\n' "$2" "$3" \
    >"$fixtures/jobs/$1.json"
}
write_log() {
  printf '2026-09-27T15:00:00.0000000Z   WORKLOAD: %s\r\n2026-09-27T15:00:00.0000001Z   IMAGE_REF: %s\r\n' "$2" "$3" \
    >"$fixtures/logs/$1"
}

placement 90 1090 completed && write_log 1090 nilxone-web "$web_image"
placement 95 1095 completed && write_log 1095 nilxone-identity "$identity_image"
placement 101 1101 completed && write_log 1101 nilxone-web "$other_web_image"
placement 102 1102 completed && write_log 1102 nilxone-telegram "$web_image"
placement 103 1103 completed && write_log 1103 nilxone-web "$web_image"
echo '{"jobs": []}' >"$fixtures/jobs/104.json"
placement 105 1105 in_progress

cat >"$mock_bin/gh" <<MOCK
#!/usr/bin/env bash
set -euo pipefail
path="" filter="." per_page=30 page=1 status=""
while [ "\$#" -gt 0 ]; do
  case "\$1" in
    api) shift ;;
    --method) shift 2 ;;
    --jq) filter="\$2"; shift 2 ;;
    -f)
      case "\$2" in
        per_page=*) per_page="\${2#per_page=}" ;;
        page=*) page="\${2#page=}" ;;
        status=*) status="\${2#status=}" ;;
        event=repository_dispatch) ;;
        *) echo "unexpected gh field \$2" >&2; exit 1 ;;
      esac
      shift 2
      ;;
    *) path="\$1"; shift ;;
  esac
done
case "\$path" in
  */actions/workflows/*/runs)
    # The runs API accepts either a run status or a conclusion in "status".
    case "\$status" in
      '') select='.' ;;
      completed|action_required|in_progress|queued|requested|waiting|pending) select='select(.status == \$s)' ;;
      *) select='select(.conclusion == \$s)' ;;
    esac
    jq --arg s "\$status" --argjson size "\$per_page" --argjson page "\$page" \
      '{workflow_runs: ([.workflow_runs[] | '"\$select"'] | .[((\$page - 1) * \$size):(\$page * \$size)])}' \
      "$fixtures/runs.json" | jq -r "\$filter"
    ;;
  */actions/runs/*/jobs)
    run_id="\${path%/jobs}"; run_id="\${run_id##*/}"
    jq -r "\$filter" "$fixtures/jobs/\$run_id.json"
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
[ "\$job_id" != "\${MOCK_UNREADABLE_JOB:-}" ] || { echo "curl: (22) 404" >&2; exit 22; }
cat "$fixtures/logs/\$job_id"
MOCK
chmod +x "$mock_bin/gh" "$mock_bin/curl"

script="$(dirname "$0")/infra-workload.sh"
run() {
  PATH="$mock_bin:$PATH" GH_TOKEN=test INFRA_REPOSITORY=aiaiaiai-org/infra \
    INFRA_POLL_INTERVAL=0 INFRA_AWAIT_TIMEOUT=0 INFRA_PAGE_SIZE=2 bash "$script" "$@"
}
fail() { echo "FAIL: $*" >&2; exit 1; }

[ "$(run latest-run-id)" = 105 ] || fail "latest-run-id must return the newest run"

output="$(run await nilxone-web "$web_image" 100)" || fail "await web: $output"
grep -Fq "Infra run 103 activates nilxone-web" <<<"$output" ||
  fail "await must skip the same image before the baseline and another image after it: $output"
grep -Fq "succeeded: https://infra/runs/103" <<<"$output" || fail "await did not report success: $output"

output="$(run await nilxone-telegram "$web_image" 100 2>&1)" && fail "await must fail when the infra run fails"
grep -Fq "finished as failure: https://infra/runs/102" <<<"$output" || fail "await must report the failed run: $output"

output="$(run await nilxone-discord "$web_image" 103 2>&1)" && fail "await must fail on an unattributable failed run"
grep -Fq "before recording its workload" <<<"$output" && grep -Fq "https://infra/runs/104" <<<"$output" ||
  fail "await must report the unattributable run instead of timing out: $output"

output="$(run await nilxone-discord "$web_image" 104 2>&1)" && fail "await must time out without a matching run"
grep -Fq "Timed out" <<<"$output" || fail "await must time out while placement is still running: $output"

output="$(MOCK_UNREADABLE_JOB=1103 run await nilxone-web "$web_image" 102 2>&1)" && fail "await must not accept an unreadable run"
grep -Fq "Placement logs could not be read for: https://infra/runs/103" <<<"$output" ||
  fail "await must name runs whose placement log was unreadable: $output"

[ "$(run active-image nilxone-web)" = "$web_image" ] || fail "active-image must return the newest successful web image"
[ "$(run active-image nilxone-identity)" = "$identity_image" ] ||
  fail "active-image must page past other workloads to find identity"
output="$(run active-image nilxone-telegram)" || fail "active-image telegram: $output"
[ -z "$output" ] || fail "active-image must ignore failed and cancelled deployments"
MOCK_UNREADABLE_JOB=1101 run active-image nilxone-identity >/dev/null 2>&1 &&
  fail "active-image must fail instead of skipping an unreadable successful run"

echo "infra-workload tests passed"
