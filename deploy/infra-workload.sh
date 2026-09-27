#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
#
# Observes aiaiaiai-org/infra "Deploy workload" runs requested through repository_dispatch.
#
#   infra-workload.sh await <workload> <image> <dispatched-at>
#     Waits for the infra run that activates <image> as <workload> and fails unless it succeeds.
#   infra-workload.sh active-image <workload>
#     Prints the image of the newest successful infra deployment of <workload>, or nothing.
#
# repository_dispatch runs carry no caller-visible identity and every workload has its own
# infra concurrency group, so runs of different workloads and callers interleave. A run is
# attributed by the WORKLOAD and IMAGE_REF its placement job echoes into its log.

set -Eeuo pipefail

repository="${INFRA_REPOSITORY:?INFRA_REPOSITORY is required}"
workflow="${INFRA_WORKFLOW:-deploy-workload.yml}"
placement_job="${INFRA_PLACEMENT_JOB:-Resolve placement from contracts}"
api_url="${GITHUB_API_URL:-https://api.github.com}"
poll_interval="${INFRA_POLL_INTERVAL:-10}"
await_timeout="${INFRA_AWAIT_TIMEOUT:-1200}"
active_scan="${INFRA_ACTIVE_SCAN:-50}"
: "${GH_TOKEN:?GH_TOKEN is required}"

for name in poll_interval await_timeout active_scan; do
  [[ "${!name}" =~ ^[0-9]+$ ]] || { echo "${name} must be an unsigned integer" >&2; exit 2; }
done

declare -A attributed=()
run_workload=""
run_image=""

# Sets run_workload/run_image for a run; returns 1 while its placement job has not finished.
attribute_run() {
  local run_id="$1" job job_id job_status log

  if [[ -n "${attributed[$run_id]+set}" ]]; then
    IFS=$'\t' read -r run_workload run_image <<<"${attributed[$run_id]}"
    return 0
  fi

  job="$(gh api "repos/${repository}/actions/runs/${run_id}/jobs" \
    --jq "first(.jobs[] | select(.name == \"${placement_job}\") | [.id, .status] | @tsv) // empty")"
  [ -n "$job" ] || return 1
  IFS=$'\t' read -r job_id job_status <<<"$job"
  [ "$job_status" = completed ] || return 1

  # gh refuses to print job logs because they contain terminal escape sequences.
  log="$(curl --fail --silent --show-error --location \
    --header "Authorization: Bearer ${GH_TOKEN}" \
    --header "Accept: application/vnd.github+json" \
    "${api_url}/repos/${repository}/actions/jobs/${job_id}/logs")" || return 1

  run_workload="$(sed -nE 's/^[^ ]+ +WORKLOAD: ([a-z0-9-]+)\r?$/\1/p' <<<"$log" | sed -n 1p)"
  run_image="$(sed -nE 's/^[^ ]+ +IMAGE_REF: ([^ \r]+)\r?$/\1/p' <<<"$log" | sed -n 1p)"
  [ -n "$run_workload" ] || return 1

  attributed[$run_id]="${run_workload}"$'\t'"${run_image}"
  return 0
}

await_workload() {
  local workload="$1" image="$2" dispatched_at="$3"
  local since deadline run_id="" runs id state status conclusion url

  since="$(date -u -d "@$(( $(date -u -d "$dispatched_at" +%s) - 5 ))" +%Y-%m-%dT%H:%M:%SZ)"
  deadline=$(( $(date +%s) + await_timeout ))

  while :; do
    if [ -z "$run_id" ]; then
      runs="$(gh api --method GET "repos/${repository}/actions/workflows/${workflow}/runs" \
        -f event=repository_dispatch -f "created=>=${since}" -f per_page=50 \
        --jq '.workflow_runs | sort_by(.created_at, .id) | .[].id')"
      for id in $runs; do
        if attribute_run "$id" && [ "$run_workload" = "$workload" ] && [ "$run_image" = "$image" ]; then
          run_id="$id"
          echo "Infra run ${run_id} activates ${workload}."
          break
        fi
      done
    fi

    if [ -n "$run_id" ]; then
      state="$(gh api "repos/${repository}/actions/runs/${run_id}" \
        --jq '[.status, (.conclusion // "none"), .html_url] | @tsv')"
      IFS=$'\t' read -r status conclusion url <<<"$state"

      if [ "$status" = completed ]; then
        if [ "$conclusion" != success ]; then
          echo "::error::Infra deployment of ${workload} finished as ${conclusion}: ${url}" >&2
          return 1
        fi
        echo "Infra deployment of ${workload} succeeded: ${url}"
        return 0
      fi
      echo "Infra deployment of ${workload} is ${status}."
    else
      echo "Waiting for the infra run that activates ${workload} (${image})."
    fi

    if (( $(date +%s) >= deadline )); then
      echo "::error::Timed out after ${await_timeout}s waiting for infra deployment of ${workload}." >&2
      return 1
    fi
    sleep "$poll_interval"
  done
}

active_image() {
  local workload="$1" runs id

  runs="$(gh api --method GET "repos/${repository}/actions/workflows/${workflow}/runs" \
    -f event=repository_dispatch -f status=success -f "per_page=${active_scan}" \
    --jq '.workflow_runs | sort_by(.created_at, .id) | reverse | .[].id')"
  for id in $runs; do
    if attribute_run "$id" && [ "$run_workload" = "$workload" ]; then
      printf '%s\n' "$run_image"
      return 0
    fi
  done
}

command="${1:-}"
case "$command" in
  await)
    [ "$#" -eq 4 ] || { echo "usage: $0 await <workload> <image> <dispatched-at>" >&2; exit 2; }
    await_workload "$2" "$3" "$4"
    ;;
  active-image)
    [ "$#" -eq 2 ] || { echo "usage: $0 active-image <workload>" >&2; exit 2; }
    active_image "$2"
    ;;
  *)
    echo "usage: $0 {await|active-image} ..." >&2
    exit 2
    ;;
esac
