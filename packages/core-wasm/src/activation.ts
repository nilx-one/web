// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  ActivationProgress,
  ActivationReading,
  ActivationRefusal,
  ActivationRequestStatus,
  ActivationRequestView,
  ActivationRole,
  ActivationStep,
  ActivationStepState,
  ActivationSyncPart,
  ClientActivationState,
  ClientActivationView,
} from "@nilx-one/application";

const STATES = new Set<ClientActivationState>([
  "authenticated_active",
  "approval_requested",
  "upload_required",
  "handoff_syncing",
  "active_elsewhere",
  "sign_in_required",
  "activation_pending",
  "activation_approved",
  "activation_syncing",
  "activation_rejected",
  "activation_objected",
  "activation_cancelled",
  "activation_superseded",
  "activation_expired",
  "activation_interrupted",
]);
const STATUSES = new Set<ActivationRequestStatus>([
  "pending",
  "approved",
  "syncing",
  "completed",
  "declined",
  "objected",
  "cancelled",
  "superseded",
  "expired",
  "interrupted",
]);
const ROLES = new Set<ActivationRole>(["requester", "approver"]);
const STEPS = new Set<ActivationStep>(["confirm", "sync", "switch"]);
const STEP_STATES = new Set<ActivationStepState>([
  "done",
  "current",
  "waiting",
]);
const REFUSALS = new Set<ActivationRefusal>([
  "already_active",
  "no_active_client",
  "activation_request_limit",
  "activation_request_not_found",
  "activation_step_refused",
  "sync_payload_too_large",
  "sync_out_of_order",
  "invalid_sync_digest",
  "sync_incomplete",
]);

const INVALID = "0x1 Core returned an invalid activation reading";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(INVALID);
  return value as Record<string, unknown>;
}

function member<T extends string>(set: ReadonlySet<T>, value: unknown): T {
  if (typeof value !== "string" || !set.has(value as T))
    throw new Error(INVALID);
  return value as T;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(INVALID);
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error(INVALID);
  return value;
}

function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function decodeProgress(value: unknown): ActivationProgress {
  const progress = record(value);
  if (!Array.isArray(progress.steps)) throw new Error(INVALID);
  return {
    steps: progress.steps.map((entry) => {
      const step = record(entry);
      return {
        step: member(STEPS, step.step),
        state: member(STEP_STATES, step.state),
      };
    }),
    percent: count(progress.percent),
    totalBytes:
      progress.total_bytes === null ? null : count(progress.total_bytes),
    uploadedBytes: count(progress.uploaded_bytes),
    deliveredBytes: count(progress.delivered_bytes),
  };
}

function decodeRequest(value: unknown): ActivationRequestView | null {
  if (value === null || value === undefined) return null;
  const request = record(value);
  return {
    id: text(request.id),
    role: member(ROLES, request.role),
    status: member(STATUSES, request.status),
    fromLabel: text(request.from_label),
    toLabel: text(request.to_label),
    createdAt: count(request.created_at),
    ...(request.deadline === undefined || request.deadline === null
      ? {}
      : { deadline: count(request.deadline) }),
    ...(request.progress === undefined || request.progress === null
      ? {}
      : { progress: decodeProgress(request.progress) }),
  };
}

function decodeView(reading: Record<string, unknown>): ClientActivationView {
  if (
    typeof reading.active !== "boolean" ||
    typeof reading.may_act !== "boolean"
  )
    throw new Error(INVALID);
  return {
    state: member(STATES, reading.state),
    active: reading.active,
    mayAct: reading.may_act,
    clientLabel: optionalText(reading.client_label),
    activeClientLabel: optionalText(reading.active_client_label),
    request: decodeRequest(reading.request),
  };
}

/**
 * Core's reading of an activation answer, renamed. Core decided what it
 * means; nothing here works out a state, a step or a percentage.
 */
export function decodeActivationReading(value: string): ActivationReading {
  const reading = record(JSON.parse(value) as unknown);
  switch (reading.kind) {
    case "state":
      return { kind: "state", view: decodeView(reading) };
    case "refused":
      return { kind: "refused", reason: member(REFUSALS, reading.reason) };
    case "authentication_required":
      return { kind: "authentication-required" };
    case "unavailable":
      return { kind: "unavailable" };
    default:
      throw new Error(INVALID);
  }
}

/** Core's answer to `activation_sync_part`. */
export function decodeActivationSyncPart(value: string): ActivationSyncPart {
  const part = record(JSON.parse(value) as unknown);
  if (part.kind === "none") return { kind: "none" };
  if (part.kind === "part" && typeof part.last === "boolean")
    return {
      kind: "part",
      offset: count(part.offset),
      end: count(part.end),
      last: part.last,
    };
  throw new Error("0x1 Core returned an invalid sync part");
}
