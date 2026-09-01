// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  CheckPubDressAvailability,
  ReadIdentity,
  ReadRuntimeReadiness,
  RegisterIdentity,
  type CoreRuntimePort,
  type IdentityRegistrationPort,
  type PubDressSelection,
} from "@nilx-one/application";
import {
  hasAuthenticatedProvider,
  type HostPort,
  type HostSnapshot,
} from "@nilx-one/host-contract";
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
import {
  createIdentityFoundationViewModel,
  createPubDressAvailabilityViewState,
} from "./features/identity/identity-foundation-view-model";
import "./product.css";

export interface ProductAppDependencies {
  core: CoreRuntimePort;
  host: HostPort;
  identity: IdentityRegistrationPort;
}

export interface ProductAppProps extends ProductAppDependencies {
  routerBasepath?: string;
}

interface ProductRouterContext {
  dependencies: ProductAppDependencies;
}

function useHostSnapshot(host: HostPort): HostSnapshot {
  const [snapshot, setSnapshot] = useState(() => host.getSnapshot());

  useEffect(() => host.subscribe(setSnapshot), [host]);

  return snapshot;
}

function useDebouncedSelection(selection: PubDressSelection) {
  const [debounced, setDebounced] = useState(selection);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(selection), 320);
    return () => window.clearTimeout(timeout);
  }, [selection]);

  return debounced;
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
  const [selection, setSelection] = useState<PubDressSelection>({
    discriminator: "0",
    slug: "",
  });
  const debouncedSelection = useDebouncedSelection(selection);
  const readinessQuery = useQuery({
    queryKey: ["core-runtime-readiness"],
    queryFn: () => new ReadRuntimeReadiness(dependencies.core).execute(),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const identityQuery = useQuery({
    queryKey: ["identity", host.kind],
    queryFn: () => new ReadIdentity(dependencies.identity).execute(),
    enabled: hasAuthenticatedProvider(host),
    retry: false,
  });
  const availabilityEnabled =
    hasAuthenticatedProvider(host) &&
    identityQuery.data?.kind === "not-registered" &&
    debouncedSelection.slug.length >= 2 &&
    debouncedSelection.slug.length <= 32;
  const availabilityQuery = useQuery({
    queryKey: [
      "pub-dress-availability",
      host.kind,
      debouncedSelection.discriminator,
      debouncedSelection.slug,
    ],
    queryFn: () =>
      new CheckPubDressAvailability(dependencies.identity).execute(
        debouncedSelection,
      ),
    enabled: availabilityEnabled,
    retry: false,
    staleTime: 0,
  });
  const registrationMutation = useMutation({
    mutationFn: (selection: PubDressSelection) =>
      new RegisterIdentity(dependencies.identity).execute(selection),
    onSuccess: (result) => {
      if (result.kind === "rejected" && result.reason === "unavailable") {
        void availabilityQuery.refetch();
      }
    },
  });
  const viewModel = createIdentityFoundationViewModel(
    host,
    readinessQuery.data,
    identityQuery.data,
    registrationMutation.data,
    registrationMutation.isPending,
  );
  const selectionIsDebounced =
    selection.discriminator === debouncedSelection.discriminator &&
    selection.slug === debouncedSelection.slug;
  const availability = createPubDressAvailabilityViewState(
    selection,
    selection.slug.length >= 2 &&
      (!selectionIsDebounced || availabilityQuery.isFetching),
    selectionIsDebounced ? availabilityQuery.data : undefined,
  );

  useEffect(() => {
    document.documentElement.dataset.hostTheme = host.theme;
    document.documentElement.dataset.host = host.kind;
  }, [host.kind, host.theme]);

  return (
    <IdentityFoundationView
      availability={availability}
      selection={selection}
      viewModel={viewModel}
      onSelectionChange={setSelection}
      onRegister={(selection) => registrationMutation.mutate(selection)}
    />
  );
}

const routeTree = rootRoute.addChildren([foundationRoute]);

export function ProductApp({
  core,
  host,
  identity,
  routerBasepath = "/",
}: ProductAppProps) {
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
      basepath: routerBasepath,
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
