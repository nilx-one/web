// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Client activation (`docs/client-activation.md` in Core): one active
 * product session per Bond, and a handoff that moves it only after the asking
 * client holds all of the active client's data.
 *
 * Core reads every answer (`read_activation_state`), cuts the data into parts
 * (`activation_sync_part`) and digests it (`activation_sync_digest`). Web
 * draws the state it is given and moves bytes; it never works out a step, a
 * percentage, a deadline, a part size or a state.
 */

/** What a client shows. One value per screen. */
export type ClientActivationState =
  | "authenticated_active"
  | "approval_requested"
  | "upload_required"
  | "handoff_syncing"
  | "active_elsewhere"
  | "sign_in_required"
  | "activation_pending"
  | "activation_approved"
  | "activation_syncing"
  | "activation_rejected"
  | "activation_objected"
  | "activation_cancelled"
  | "activation_superseded"
  | "activation_expired"
  | "activation_interrupted";

export type ActivationRequestStatus =
  | "pending"
  | "approved"
  | "syncing"
  | "completed"
  | "declined"
  | "objected"
  | "cancelled"
  | "superseded"
  | "expired"
  | "interrupted";

export type ActivationRole = "requester" | "approver";
export type ActivationStep = "confirm" | "sync" | "switch";
export type ActivationStepState = "done" | "current" | "waiting";

/** Why the service refused; nothing changed. The next state read is the truth. */
export type ActivationRefusal =
  | "already_active"
  | "no_active_client"
  | "activation_request_limit"
  | "activation_request_not_found"
  | "activation_step_refused"
  | "sync_payload_too_large"
  | "sync_out_of_order"
  | "invalid_sync_digest"
  | "sync_incomplete";

export interface ActivationStepView {
  readonly step: ActivationStep;
  readonly state: ActivationStepState;
}

export interface ActivationProgress {
  readonly steps: readonly ActivationStepView[];
  /** Core's percentage. It can go down: a restarted download lowers it. */
  readonly percent: number;
  /** `null` until the active client has started its upload. */
  readonly totalBytes: number | null;
  readonly uploadedBytes: number;
  readonly deliveredBytes: number;
}

export interface ActivationRequestView {
  readonly id: string;
  readonly role: ActivationRole;
  readonly status: ActivationRequestStatus;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly createdAt: number;
  /** Absent on a request that ended without a switch. */
  readonly deadline?: number;
  /** Absent on a request that ended without a switch. */
  readonly progress?: ActivationProgress;
}

export interface ClientActivationView {
  readonly state: ClientActivationState;
  readonly active: boolean;
  /** The only gate for game actions: false means read and show, never write. */
  readonly mayAct: boolean;
  readonly clientLabel: string | null;
  readonly activeClientLabel: string | null;
  readonly request: ActivationRequestView | null;
}

export type ActivationReading =
  | { readonly kind: "state"; readonly view: ClientActivationView }
  | { readonly kind: "refused"; readonly reason: ActivationRefusal }
  | { readonly kind: "authentication-required" }
  /** No usable answer. Never draw from it, never assume a switch happened. */
  | { readonly kind: "unavailable" };

/** Which bytes to send or fetch next, as Core cuts them. */
export type ActivationSyncPart =
  | {
      readonly kind: "part";
      readonly offset: number;
      readonly end: number;
      readonly last: boolean;
    }
  | { readonly kind: "none" };

export type ActivationDownload =
  | { readonly kind: "bytes"; readonly bytes: Uint8Array }
  | { readonly kind: "unavailable" };

/** The activation routes (`/api/v1/session/activation…`), read by Core. */
export interface ClientActivationAccessPort {
  readActivationState(): Promise<ActivationReading>;
  requestActivation(): Promise<ActivationReading>;
  cancelActivation(requestId: string): Promise<ActivationReading>;
  approveActivation(requestId: string): Promise<ActivationReading>;
  declineActivation(requestId: string): Promise<ActivationReading>;
  uploadActivationSyncPart(
    requestId: string,
    offset: number,
    totalBytes: number,
    bytes: Uint8Array,
  ): Promise<ActivationReading>;
  downloadActivationSyncPart(
    requestId: string,
    offset: number,
  ): Promise<ActivationDownload>;
  completeActivation(
    requestId: string,
    digest: string,
  ): Promise<ActivationReading>;
}

export function hasClientActivationAccess(
  value: unknown,
): value is ClientActivationAccessPort {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<ClientActivationAccessPort>)
      .readActivationState === "function"
  );
}

/** Core's half of a sync: where the parts fall and what the digest is. */
export interface ActivationSyncCore {
  activationSyncPart(
    totalBytes: number,
    offset: number,
  ): Promise<ActivationSyncPart>;
  activationSyncDigest(data: Uint8Array): Promise<string>;
}

/** The bytes a handoff carries, built on the active side, applied on the other. */
export interface ActivationPayloadPort {
  build(): Uint8Array;
  /** Throws when the bytes cannot be applied; the client then never completes. */
  apply(bytes: Uint8Array): void;
}

export interface ActivationUpload {
  readonly access: ClientActivationAccessPort;
  readonly core: ActivationSyncCore;
  readonly requestId: string;
  readonly payload: Uint8Array;
  /** `request.progress.uploaded_bytes` from the state that asked for this. */
  readonly uploadedBytes: number;
  readonly signal?: AbortSignal;
}

/**
 * The active client's upload, from the offset Core last counted until Core
 * stops answering `upload_required`. A refusal or an unusable answer ends the
 * pass; the next state read says where to continue.
 */
export async function uploadActivationPayload({
  access,
  core,
  requestId,
  payload,
  uploadedBytes,
  signal,
}: ActivationUpload): Promise<ActivationReading> {
  const total = payload.length;
  let offset = uploadedBytes;
  for (;;) {
    if (signal?.aborted) return { kind: "unavailable" };
    const part = await core.activationSyncPart(total, offset);
    if (part.kind === "none") return access.readActivationState();
    const reading = await access.uploadActivationSyncPart(
      requestId,
      part.offset,
      total,
      payload.subarray(part.offset, part.end),
    );
    if (reading.kind !== "state") return reading;
    const progress = reading.view.request?.progress;
    if (reading.view.state !== "upload_required" || progress === undefined)
      return reading;
    offset = progress.uploadedBytes;
  }
}

export interface ActivationDownloadRun {
  readonly access: ClientActivationAccessPort;
  readonly core: ActivationSyncCore;
  readonly requestId: string;
  /** `request.progress.total_bytes` from the `activation_syncing` state. */
  readonly totalBytes: number;
  readonly payload: ActivationPayloadPort;
  readonly signal?: AbortSignal;
}

/**
 * The asking client's download, always from the first part: fetch every
 * part, apply the payload, then complete with Core's digest. It completes
 * only after the payload applied, so a client never becomes active without
 * the data.
 */
export async function downloadActivationPayload({
  access,
  core,
  requestId,
  totalBytes,
  payload,
  signal,
}: ActivationDownloadRun): Promise<ActivationReading> {
  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (;;) {
    if (signal?.aborted) return { kind: "unavailable" };
    const part = await core.activationSyncPart(totalBytes, offset);
    if (part.kind === "none") return { kind: "unavailable" };
    const download = await access.downloadActivationSyncPart(
      requestId,
      part.offset,
    );
    if (download.kind !== "bytes") return download;
    if (download.bytes.length !== part.end - part.offset)
      return { kind: "unavailable" };
    buffer.set(download.bytes, part.offset);
    offset = part.end;
    if (part.last) break;
  }
  if (signal?.aborted) return { kind: "unavailable" };
  try {
    payload.apply(buffer);
  } catch {
    return { kind: "unavailable" };
  }
  const digest = await core.activationSyncDigest(buffer);
  return access.completeActivation(requestId, digest);
}
