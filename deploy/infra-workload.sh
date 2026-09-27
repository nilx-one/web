#!/usr/bin/env bash
# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0
#
# Observes aiaiaiai-org/infra "Deploy workload" runs requested through repository_dispatch.
#
#   infra-workload.sh latest-run-id
#     Prints the id of the newest infra run (0 when there is none). Record it before dispatching.
#   infra-workload.sh await <workload> <image> <baseline-run-id>
#     Waits for the first infra run after <baseline-run-id> that activates <image> as <workload>
#     and fails unless it succeeds.
#   infra-workload.sh active-image <workload>
#     Prints the image of the newest successful infra deployment of <workload>, or nothing when
#     the whole history has none. Fails when a newer successful run cannot be attributed.
#
# repository_dispatch runs carry no caller-visible identity and every workload has its own
# infra concurrency group, so runs of different workloads and callers interleave. A run is
# attributed by the WORKLOAD and IMAGE_REF its placement job echoes into its log. Run ids are
# monotonic, so a baseline id taken before dispatch excludes every earlier run without relying
# on clocks.

set -Eeuo pipefail

repository="${INFRA_REPOSITORY:?INFRA_REPOSITORY is required}"
workflow="${INFRA_WORKFLOW:-deploy-workload.yml}"
placement_job="${INFRA_PLACEMENT_JOB:-Resolve placement from contracts}"
api_url="${GITHUB_API_URL:-https://api.github.com}"
poll_interval="${INFRA_POLL_INTERVAL:-10}"
await_timeout="${INFRA_AWAIT_TIMEOUT:-1200}"
page_size="${INFRA_PAGE_SIZE:-100}"
: "${GH_TOKEN:?GH_TOKEN is required}"

for name in poll_interval await_timeout page_size; do
  [[ "${!name}" =~ ^[0-9]+$ ]] || { echo "${name} must be an unsigned integer" >&2; exit 2; }
done

runs_path="repos/${repository}/actions/workflows/${workflow}/runs"

declare -A attributed=()
run_workload=""
run_image=""

# Attributes a run through its placement log and sets run_workload/run_image.
#   0  attributed
#   1  not yet: the placement job has not finished and the run is still going
#   2  never: the run completed without a finished placement job, or its log names no workload
#   3  the placement job or its log could not be read
attribute_run() {
  local run_id="$1" run_status="$2" job job_id job_status log

  if [[ -n "${attributed[$run_id]+set}" ]]; then
    IFS=$'\t' read -r run_workload run_image <<<"${attributed[$run_id]}"
    [ -n "$run_workload" ] && return 0
    return 2
  fi

  run_workload=""
  run_image=""
  job="$(gh api "repos/${repository}/actions/runs/${run_id}/jobs" \
    --jq "first(.jobs[] | select(.name == \"${placement_job}\") | [.id, .status] | @tsv) // empty")" || return 3
  if [ -n "$job" ]; then
    IFS=$'\t' read -r job_id job_status <<<"$job"
  else
    job_status=missing
  fi

  if [ "$job_status" != completed ]; then
    [ "$run_status" = completed ] || return 1
    attributed[$run_id]=$'\t'
    return 2
  fi

  # gh refuses to print job logs because they contain terminal escape sequences.
  log="$(curl --fail --silent --show-error --location \
    --header "Authorization: Bearer ${GH_TOKEN}" \
    --header "Accept: application/vnd.github+json" \
    "${api_url}/repos/${repository}/actions/jobs/${job_id}/logs")" || return 3

  run_workload="$(sed -nE 's/^[^ ]+ +WORKLOAD: ([a-z0-9-]+)\r?$/\1/p' <<<"$log" | sed -n 1p)"
  run_image="$(sed -nE 's/^[^ ]+ +IMAGE_REF: ([^ \r]+)\r?$/\1/p' <<<"$log" | sed -n 1p)"
  attributed[$run_id]="${run_workload}"$'\t'"${run_image}"
  [ -n "$run_workload" ] && return 0
  return 2
}

# Prints "id<TAB>status<TAB>conclusion<TAB>url" newest first, one page of the given query.
list_page() {
  local page="$1"
  shift
  gh api --method GET "$runs_path" -f "per_page=${page_size}" -f "page=${page}" "$@" \
    --jq '.workflow_runs[] | [.id, .status, (.conclusion // "none"), .html_url] | @tsv'
}

latest_run_id() {
  gh api --method GET "$runs_path" -f per_page=1 --jq '.workflow_runs[0].id // 0'
}

# Prints the runs created after the baseline, oldest first.
runs_after() {
  local baseline="$1" page=1 rows row id collected="" count

  while :; do
    rows="$(list_page "$page" -f event=repository_dispatch)"
    count=0
    while IFS= read -r row; do
      [ -n "$row" ] || continue
      count=$((count + 1))
      id="${row%%$'\t'*}"
      (( id > baseline )) || { printf '%s' "$collected" | tac; return 0; }
      collected+="${row}"$'\n'
    done <<<"$rows"
    (( count == page_size )) || { printf '%s' "$collected" | tac; return 0; }
    page=$((page + 1))
  done
}

await_workload() {
  local workload="$1" image="$2" baseline="$3"
  local deadline run_id="" run_url="" unreadable="" unattributed_failure="" rc id status conclusion url state

  [[ "$baseline" =~ ^[0-9]+$ ]] || { echo "baseline run id must be an unsigned integer" >&2; return 2; }
  deadline=$(( $(date +%s) + await_timeout ))

  while :; do
    if [ -z "$run_id" ]; then
      unreadable=""
      unattributed_failure=""
      while IFS=$'\t' read -r id status conclusion url; do
        [ -n "$id" ] || continue
        rc=0
        attribute_run "$id" "$status" || rc=$?
        case "$rc" in
          0)
            if [ "$run_workload" = "$workload" ] && [ "$run_image" = "$image" ]; then
              run_id="$id"
              run_url="$url"
              echo "Infra run ${run_id} activates ${workload}: ${run_url}"
              break
            fi
            ;;
          2)
            if [ "$status" = completed ] && [ "$conclusion" != success ] && [ -z "$unattributed_failure" ]; then
              unattributed_failure="${id} finished as ${conclusion} (${url})"
            fi
            ;;
          3) unreadable+=" ${url}" ;;
        esac
      done < <(runs_after "$baseline")

      if [ -z "$run_id" ] && [ -n "$unattributed_failure" ]; then
        echo "::error::Infra run ${unattributed_failure} after this dispatch before recording its workload, so it may be this deployment of ${workload}." >&2
        [ -z "$unreadable" ] || echo "::error::Placement logs could not be read for:${unreadable}" >&2
        return 1
      fi
    fi

    if [ -n "$run_id" ]; then
      state="$(gh api "repos/${repository}/actions/runs/${run_id}" --jq '[.status, (.conclusion // "none")] | @tsv')"
      IFS=$'\t' read -r status conclusion <<<"$state"

      if [ "$status" = completed ]; then
        if [ "$conclusion" != success ]; then
          echo "::error::Infra deployment of ${workload} finished as ${conclusion}: ${run_url}" >&2
          return 1
        fi
        echo "Infra deployment of ${workload} succeeded: ${run_url}"
        return 0
      fi
      echo "Infra deployment of ${workload} is ${status}."
    else
      echo "Waiting for the infra run that activates ${workload} (${image})."
    fi

    if (( $(date +%s) >= deadline )); then
      echo "::error::Timed out after ${await_timeout}s waiting for infra deployment of ${workload}." >&2
      [ -z "$unreadable" ] || echo "::error::Placement logs could not be read for:${unreadable}" >&2
      return 1
    fi
    sleep "$poll_interval"
  done
}

active_image() {
  local workload="$1" page=1 rows id status conclusion url count rc

  while :; do
    rows="$(list_page "$page" -f event=repository_dispatch -f status=success)"
    count=0
    while IFS=$'\t' read -r id status conclusion url; do
      [ -n "$id" ] || continue
      count=$((count + 1))
      rc=0
      attribute_run "$id" "$status" || rc=$?
      if [ "$rc" -ne 0 ]; then
        echo "::error::Cannot attribute successful infra run ${id}, so the active ${workload} image is unknown: ${url}" >&2
        return 1
      fi
      if [ "$run_workload" = "$workload" ]; then
        printf '%s\n' "$run_image"
        return 0
      fi
    done <<<"$rows"
    (( count == page_size )) || return 0
    page=$((page + 1))
  done
}

command="${1:-}"
case "$command" in
  latest-run-id)
    [ "$#" -eq 1 ] || { echo "usage: $0 latest-run-id" >&2; exit 2; }
    latest_run_id
    ;;
  await)
    [ "$#" -eq 4 ] || { echo "usage: $0 await <workload> <image> <baseline-run-id>" >&2; exit 2; }
    await_workload "$2" "$3" "$4"
    ;;
  active-image)
    [ "$#" -eq 2 ] || { echo "usage: $0 active-image <workload>" >&2; exit 2; }
    active_image "$2"
    ;;
  *)
    echo "usage: $0 {latest-run-id|await|active-image} ..." >&2
    exit 2
    ;;
esac
