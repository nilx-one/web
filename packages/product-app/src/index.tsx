// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  ReadRuntimeReadiness,
  type CoreRuntimePort,
} from "@nilx-one/application";
import type { HostPort, HostSnapshot } from "@nilx-one/host-contract";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { IdentityFoundationView } from "./features/identity/identity-foundation-view";
import { createIdentityFoundationViewModel } from "./features/identity/identity-foundation-view-model";
import "./product.css";

export interface ProductAppDependencies {
  core: CoreRuntimePort;
  host: HostPort;
}

interface ProductRouterContext {
  dependencies: ProductAppDependencies;
}

function useHostSnapshot(host: HostPort): HostSnapshot {
  const [snapshot, setSnapshot] = useState(() => host.getSnapshot());

  useEffect(() => host.subscribe(setSnapshot), [host]);

  return snapshot;
}

function RootRoute() {
  return <Outlet />;
}

const rootRoute = createRootRouteWithContext<ProductRouterContext>()({
  component: RootRoute,
});

const foundationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FoundationRoute,
});

function FoundationRoute() {
  const { dependencies } = foundationRoute.useRouteContext();
  const host = useHostSnapshot(dependencies.host);
  const readinessQuery = useQuery({
    queryKey: ["core-runtime-readiness"],
    queryFn: () => new ReadRuntimeReadiness(dependencies.core).execute(),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const viewModel = createIdentityFoundationViewModel(
    host,
    readinessQuery.data,
  );

  useEffect(() => {
    document.documentElement.dataset.hostTheme = host.theme;
  }, [host.theme]);

  return <IdentityFoundationView viewModel={viewModel} />;
}

const routeTree = rootRoute.addChildren([foundationRoute]);

export function ProductApp({ core, host }: ProductAppDependencies) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [router] = useState(() =>
    createRouter({
      routeTree,
      context: {
        dependencies: { core, host },
      },
    }),
  );

  useEffect(() => {
    host.ready();
  }, [host]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
