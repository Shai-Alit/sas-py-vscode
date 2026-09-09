// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Wires the "SAS Content" view into the window: the tree data provider, the
 * activity-bar view itself, the refresh command, and the client the adapter
 * reads through.
 *
 * ## Independent of the compute session
 *
 * Browsing content needs an endpoint and a token — nothing more. It does
 * **not** go through `ComputeSessionManager`: a user can expand the SAS
 * Content tree without ever starting a SAS process, and coupling the two would
 * mean opening a compute session just to look at a folder. The client here is
 * built straight from the active profile's endpoint and a silent
 * `getSession`.
 *
 * ## Silent tokens only
 *
 * The token function passes `{ silent: true }` — a tree refresh must never pop
 * a browser sign-in. When there is no session the client's request fails as
 * `unauthorized`, the tree logs it and renders nothing, and the view's
 * `viewsWelcome` ("Sign in to browse…") shows instead. The account hint
 * (`accountForEndpoint`) is threaded through for the same reason
 * `ComputeSessionManager` threads it: a window signed in to two deployments
 * must renew from the right one.
 *
 * ## The adapter is rebuilt, not mutated
 *
 * `profiles.onDidChange` (a profile switch fires it — see
 * `ProfileStore.setActiveName`) and the auth events each rebuild the adapter
 * against the now-active endpoint and refresh the tree. A rebuild is cheap: a
 * config read and two `new`s, no I/O.
 */

import * as vscode from "vscode";

import { AUTH_PROVIDER_ID } from "../auth/authProvider";
import { accountForEndpoint } from "../auth/identity";
import type { HttpTransport } from "../auth/transport";
import type { ProfileStore } from "../profile/store";
import { ContentAdapter } from "./adapter";
import {
  createContentClient,
  type ContentClient,
  type ContentClientConfig,
} from "./client";
import { SasContentTreeProvider } from "./contentTree";

/** The id of the tree view, matching `package.json`'s `contributes.views`. */
export const CONTENT_VIEW_ID = "pythonOnViya.contentExplorer";

/** What this module needs from the profile store — narrowed so a test need
 * not stand up a whole `ProfileStore`. */
export type ContentProfileSource = Pick<ProfileStore, "active" | "onDidChange">;

/** The auth events the explorer reacts to, as the provider exposes them. */
export interface ContentAuthEvents {
  readonly onDidChangeSessions: vscode.Event<unknown>;
  readonly onDidSignOut: vscode.Event<unknown>;
}

/** Injectable seams — the integration host cannot sign in to a real
 * deployment, so the token path and the client factory are replaceable. */
export interface ContentExplorerDeps {
  /** Defaults to {@link createContentClient}. */
  createClient?: ((config: ContentClientConfig) => ContentClient) | undefined;
  /** The transport every client this explorer builds should use — carries the
   * `pythonOnViya.userProvidedCertificates` CA agent (slice 5d-i). Defaults,
   * via {@link ContentClientConfig.transport}, to `nodeHttpTransport`. */
  transport?: HttpTransport | undefined;
  /** Defaults to `vscode.authentication.getSession` for this provider,
   * `{ silent: true }`. */
  authSession?:
    | ((
        account: vscode.AuthenticationSessionAccountInformation | undefined,
      ) => Thenable<vscode.AuthenticationSession | undefined>)
    | undefined;
  /** Defaults to `vscode.authentication.getAccounts` for this provider. */
  accounts?:
    | (() => Thenable<
        readonly vscode.AuthenticationSessionAccountInformation[]
      >)
    | undefined;
}

/**
 * Registers the SAS Content explorer. Returns nothing; every disposable is
 * pushed on `context.subscriptions`.
 */
export function registerContentExplorer(
  context: vscode.ExtensionContext,
  profiles: ContentProfileSource,
  log: vscode.LogOutputChannel,
  authEvents: ContentAuthEvents,
  deps: ContentExplorerDeps = {},
): void {
  const createClient = deps.createClient ?? createContentClient;

  let adapter: ContentAdapter | undefined;
  let adapterEndpoint: string | undefined;

  const rebuildAdapter = (): void => {
    const endpoint = profiles.active()?.profile.endpoint;
    if (endpoint === undefined) {
      adapter = undefined;
      adapterEndpoint = undefined;
      return;
    }
    if (endpoint === adapterEndpoint && adapter !== undefined) return;

    const client = createClient({
      root: endpoint,
      ...(deps.transport === undefined ? {} : { transport: deps.transport }),
      token: async () => await tokenFor(endpoint, deps),
    });
    adapter = new ContentAdapter(client);
    adapterEndpoint = endpoint;
  };

  const provider = new SasContentTreeProvider(() => {
    // Kept fresh lazily as well as on events: `active()` is an in-memory
    // config read, and this closes the gap if a rebuild-triggering event is
    // ever missed.
    rebuildAdapter();
    return adapter;
  }, log);

  const view = vscode.window.createTreeView(CONTENT_VIEW_ID, {
    treeDataProvider: provider,
  });

  const refreshOnEvent = (): void => {
    rebuildAdapter();
    provider.refresh();
  };

  context.subscriptions.push(
    provider,
    view,
    // A signed-in window may not have resolved its session yet when the view
    // first opens; reloading on the first reveal populates the tree without
    // waiting for the user to press refresh.
    view.onDidChangeVisibility((event) => {
      if (event.visible) refreshOnEvent();
    }),
    vscode.commands.registerCommand(
      "pythonOnViya.refreshContentExplorer",
      () => {
        provider.refresh();
      },
    ),
    profiles.onDidChange(refreshOnEvent),
    authEvents.onDidChangeSessions(refreshOnEvent),
    authEvents.onDidSignOut(() => {
      adapter = undefined;
      adapterEndpoint = undefined;
      provider.refresh();
    }),
  );
}

/**
 * A token for the content client, silently.
 *
 * Throws when there is no session, which the client turns into an
 * `unauthorized` {@link ContentProblem} — the tree then shows its welcome
 * content. Never opens a browser.
 */
async function tokenFor(
  endpoint: string,
  deps: ContentExplorerDeps,
): Promise<string> {
  const listAccounts =
    deps.accounts ??
    (() => vscode.authentication.getAccounts(AUTH_PROVIDER_ID));
  const account = accountForEndpoint(endpoint, await listAccounts());

  const getSession =
    deps.authSession ??
    ((hint: vscode.AuthenticationSessionAccountInformation | undefined) =>
      vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
        silent: true,
        ...(hint === undefined ? {} : { account: hint }),
      }));

  const session = await getSession(account);
  if (session === undefined) {
    throw new Error(
      vscode.l10n.t("Sign in to SAS Viya to browse SAS Content."),
    );
  }
  return session.accessToken;
}
