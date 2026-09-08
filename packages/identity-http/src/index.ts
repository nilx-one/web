// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaProfileAccessPort,
  IdentityAccessPort,
} from "@nilx-one/application";

import {
  withAvaiaProfileHttp,
  type AvaiaProfileHttpOptions,
} from "./avaia-profile";
import {
  createIdentityHttpAdapter as createBaseIdentityHttpAdapter,
} from "./identity-http-base";

export type { AvaiaProfileHttpOptions } from "./avaia-profile";

/** Contract-8 composition over the existing identity transport. */
export function createIdentityHttpAdapter(
  options: AvaiaProfileHttpOptions,
): IdentityAccessPort & AvaiaProfileAccessPort {
  return withAvaiaProfileHttp(createBaseIdentityHttpAdapter(options), options);
}
