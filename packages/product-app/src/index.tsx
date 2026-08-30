// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  ReadIdentity,
  ReadRuntimeReadiness,
  RegisterIdentity,
  type CoreRuntimePort,
  type IdentityRegistrationPort,
  type PubDressSelection,
} from "@nilx-one/application";
import type { HostPort, HostSnapshot } from "@nilx-one/host-contract";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
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
  identity: IdentityRegistrationPort;
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
  const hasTelegramAuthentication =
    host.kind === "telegram" &&
    host.available &&
    host.authentication.kind === "telegram-init-data" &&
    host.authentication.initData.length > 0;
  const identityQuery = useQuery({
    queryKey: ["identity"],
    queryFn: () => new ReadIdentity(dependencies.identity).execute(),
    enabled: hasTelegramAuthentication,
    retry: false,
  });
  const registrationMutation = useMutation({
    mutationFn: (selection: PubDressSelection) =>
      new RegisterIdentity(dependencies.identity).execute(selection),
  });
  const viewModel = createIdentityFoundationViewModel(
    host,
    readinessQuery.data,
    identityQuery.data,
    registrationMutation.data,
    registrationMutation.isPending,
  );

  useEffect(() => {
    document.documentElement.dataset.hostTheme = host.theme;
  }, [host.theme]);

  return (
    <IdentityFoundationView
      viewModel={viewModel}
      onRegister={(selection) => registrationMutation.mutate(selection)}
    />
  );
}

const routeTree = rootRoute.addChildren([foundationRoute]);

export function ProductApp({ core, host, identity }: ProductAppDependencies) {
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
        dependencies: { core, host, identity },
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
