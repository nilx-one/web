// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export {
  createAvaiaMovementController,
  type AvaiaMovementController,
  type AvaiaMovementControllerOptions,
  type MovementState,
  type WorldPosition,
} from "./avaia-movement-controller";
export {
  createFailureNotice,
  type FailureKind,
  type FailureNotice,
  type FailureNoticeAction,
  type FailureNoticeTone,
  type FailureReport,
} from "./failure-notice";
export {
  ReadRuntimeReadiness,
  type CorePubDressLabelErrorCode,
  type CorePubDressLabelResult,
  type CoreRuntimePort,
  type CoreRuntimeStatus,
  type CoreUnavailableReason,
  type RuntimeReadiness,
} from "./core-runtime";
export {
  AcknowledgeRecoveryKey,
  AuthenticateNativeIdentity,
  ForgetRememberedBond,
  LogoutNativeIdentity,
  ReadNativeIdentityContext,
  ReadProviderIdentity,
  RegisterNativeIdentity,
  RegisterProviderIdentity,
  ResolvePubDress,
  ResolvePubDressLabel,
  formatPubDress,
  parsePubDress,
  type IdentityAccessPort,
  type IdentityProjection,
  type NativeAuthenticationResult,
  type NativeIdentityContextResult,
  type NativeMutationResult,
  type NativeRecoveryResult,
  type NativeRegistrationResult,
  type ProviderIdentityLookupResult,
  type ProviderRegistrationResult,
  type PubDressLabelResolutionResult,
  type PubDressSelection,
  type PubDressResolutionResult,
} from "./identity-registration";
export {
  PUB_DRESS_LABEL_MAX_LENGTH,
  PUB_DRESS_URL_SUFFIX_MAX_LENGTH,
  PUB_DRESS_URL_ZONE,
  formatPubDressUrl,
  normalizePubDressUrlSuffix,
  projectCorePubDressLabel,
  projectCorePubDressLabelComposition,
  suggestPubDressUrlSuffix,
  type PubDressLabelComposition,
  type PubDressLabelDerivation,
  type PubDressLabelRejection,
  type PubDressLabelStem,
} from "./pub-dress-url";
