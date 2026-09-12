// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Wires the "CAS" surface into the window: the tree data provider, the
 * activity-bar view (a third view inside the container 6a-ii created,
 * alongside SAS Content and SAS Libraries), the refresh command, and the
 * auth events the tree refreshes on.
 *
 * This file is a registrar with no branch in it, mirroring
 * `src/content/contentExplorer.ts` — the adapter lifecycle (build,
 * endpoint-cache, sign-out clear) and the silent token flow live in
 * `src/cas/casSession.ts`, which the unit tier tests.
 *
 * ## Independent of both the compute session and any CAS session
 *
 * Browsing CAS needs only an endpoint and a token (Finding 8.2) — it does not
 * go through `ComputeSessionManager`, and it opens no CAS session of its own
 * ([ADR-0033](../../docs/adr/0033-cas-adapter-shape.md)). A user can expand
 * this tree without ever starting a SAS process.
 *
 * ## Silent tokens only
 *
 * {@link defaultGetSession} passes `{ silent: true }` — a tree refresh must
 * never pop a browser sign-in. With no session the client fails
 * `unauthorized`, the tree logs it and renders nothing, and the view's
 * `viewsWelcome` shows instead.
 */

import * as vscode from "vscode";

import { AUTH_PROVIDER_ID } from "../auth/authProvider";
import type { HttpTransport } from "../auth/transport";
import type { ProfileStore } from "../profile/store";
import {
  CasSession,
  type CasSessionDeps,
  type SessionLike,
} from "./casSession";
import { SasCasTreeProvider } from "./casTree";

/** The id of the tree view, matching `package.json`'s `contributes.views`. */
export const CAS_VIEW_ID = "pythonOnViya.casExplorer";

/** What this module needs from the profile store — narrowed so a test need
 * not stand up a whole `ProfileStore`. */
export type CasProfileSource = Pick<ProfileStore, "active" | "onDidChange">;

/** The auth events the explorer reacts to, as the provider exposes them. */
export interface CasAuthEvents {
  readonly onDidChangeSessions: vscode.Event<unknown>;
  readonly onDidSignOut: vscode.Event<unknown>;
}

type Account = vscode.AuthenticationSessionAccountInformation;

/** Injectable seams — the integration host cannot sign in to a real
 * deployment, so the token path and the client factory are replaceable. */
export interface CasExplorerDeps {
  /** Passed straight to {@link CasSession}. */
  session?: Pick<CasSessionDeps<Account>, "createClient"> | undefined;
  /** The transport every client this explorer builds should use — carries
   * the `pythonOnViya.userProvidedCertificates` CA agent (slice 5d-i). */
  transport?: HttpTransport | undefined;
  /** Defaults to a silent `vscode.authentication.getSession` for this
   * provider. */
  getSession?: CasSessionDeps<Account>["getSession"] | undefined;
  /** Defaults to `vscode.authentication.getAccounts` for this provider. */
  listAccounts?: CasSessionDeps<Account>["listAccounts"] | undefined;
}

/**
 * Registers the CAS explorer. Returns nothing; every disposable is pushed on
 * `context.subscriptions`.
 */
export function registerCasExplorer(
  context: vscode.ExtensionContext,
  profiles: CasProfileSource,
  log: vscode.LogOutputChannel,
  authEvents: CasAuthEvents,
  deps: CasExplorerDeps = {},
): void {
  const session = new CasSession<Account>({
    ...(deps.session?.createClient === undefined
      ? {}
      : { createClient: deps.session.createClient }),
    ...(deps.transport === undefined ? {} : { transport: deps.transport }),
    listAccounts:
      deps.listAccounts ??
      (() => vscode.authentication.getAccounts(AUTH_PROVIDER_ID)),
    getSession: deps.getSession ?? defaultGetSession,
  });

  const activeEndpoint = () => profiles.active()?.profile.endpoint;

  const provider = new SasCasTreeProvider(
    () => session.adapterFor(activeEndpoint()),
    log,
  );

  const view = vscode.window.createTreeView(CAS_VIEW_ID, {
    treeDataProvider: provider,
  });

  context.subscriptions.push(
    provider,
    view,
    vscode.commands.registerCommand("pythonOnViya.refreshCasExplorer", () => {
      provider.refresh();
    }),
    // A signed-in window may not have resolved its token yet when the view
    // first opens; reloading on the first reveal populates the tree without
    // waiting for the user to press refresh — the same reasoning
    // `contentExplorer.ts`/`dataExplorer.ts` each give for their own
    // identical listener.
    view.onDidChangeVisibility((event) => {
      if (event.visible) provider.refresh();
    }),
    profiles.onDidChange(() => {
      provider.refresh();
    }),
    authEvents.onDidChangeSessions(() => {
      provider.refresh();
    }),
    authEvents.onDidSignOut(() => {
      session.clear();
      provider.refresh();
    }),
  );
}

/** The silent, account-hinted `getSession` the explorer uses in production. */
async function defaultGetSession(
  account: Account | undefined,
): Promise<SessionLike | undefined> {
  return await vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
    silent: true,
    ...(account === undefined ? {} : { account }),
  });
}
