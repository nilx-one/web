// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AvaiaProfileProvider } from "./features/avaia/avaia-profile-context";
import {
  ProductApp as ProductAppBase,
  type ProductAppProps,
} from "./product-app-base";

export {
  usePublishFailure,
  type PublishFailure,
  type PublishFailureOptions,
  type ProductAppDependencies,
  type ProductAppProps,
} from "./product-app-base";

/** Shared product composition with optional identity contract-8 capabilities. */
export function ProductApp(props: ProductAppProps) {
  return (
    <AvaiaProfileProvider identity={props.identity}>
      <ProductAppBase {...props} />
    </AvaiaProfileProvider>
  );
}
