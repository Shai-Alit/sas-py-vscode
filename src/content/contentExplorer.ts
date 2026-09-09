// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Wires the "SAS Content" view into the window: the tree data provider, the
 * activity-bar view, the refresh command, and the auth events the tree
 * refreshes on.
 *
 * This file is a registrar with no branch in it — the adapter lifecycle (build,
 * endpoint-cache, sign-out clear) and the silent token flow live in
 * `src/content/contentSession.ts`, which the unit tier tests. Everything here
 * is a `vscode` call or an event subscription.
 *
 * ## Independent of the compute session
 *
 * Browsing content needs an endpoint and a token, nothing more — it does not go
 * through `ComputeSessionManager`. A user can expand the tree without ever
 * starting a SAS process.
 *
 * ## Silent tokens only
 *
 * {@link defaultGetSession} passes `{ silent: true }` — a tree refresh must
 * never pop a browser sign-in. With no session the client fails `unauthorized`,
 * the tree logs it and renders nothing, and the view's `viewsWelcome` shows
 * instead.
 */

import * as vscode from "vscode";

import { AUTH_PROVIDER_ID } from "../auth/authProvider";
import type { HttpTransport } from "../auth/transport";
import type { ProfileStore } from "../profile/store";
import {
  ContentSession,
  type ContentSessionDeps,
  type SessionLike,
} from "./contentSession";
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

type Account = vscode.AuthenticationSessionAccountInformation;

/** Injectable seams — the integration host cannot sign in to a real
 * deployment, so the token path and the client factory are replaceable. */
export interface ContentExplorerDeps {
  /** Passed straight to {@link ContentSession}. */
  session?: Pick<ContentSessionDeps<Account>, "createClient"> | undefined;
  /** The transport every client this explorer builds should use — carries the
   * `pythonOnViya.userProvidedCertificates` CA agent (slice 5d-i). */
  transport?: HttpTransport | undefined;
  /** Defaults to a silent `vscode.authentication.getSession` for this
   * provider. */
  getSession?: ContentSessionDeps<Account>["getSession"] | undefined;
  /** Defaults to `vscode.authentication.getAccounts` for this provider. */
  listAccounts?: ContentSessionDeps<Account>["listAccounts"] | undefined;
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
  const session = new ContentSession<Account>({
    ...(deps.session?.createClient === undefined
      ? {}
      : { createClient: deps.session.createClient }),
    ...(deps.transport === undefined ? {} : { transport: deps.transport }),
    listAccounts:
      deps.listAccounts ??
      (() => vscode.authentication.getAccounts(AUTH_PROVIDER_ID)),
    getSession: deps.getSession ?? defaultGetSession,
  });

  const provider = new SasContentTreeProvider(
    () => session.adapterFor(profiles.active()?.profile.endpoint),
    log,
  );

  const view = vscode.window.createTreeView(CONTENT_VIEW_ID, {
    treeDataProvider: provider,
  });

  context.subscriptions.push(
    provider,
    view,
    vscode.commands.registerCommand(
      "pythonOnViya.refreshContentExplorer",
      () => {
        provider.refresh();
      },
    ),
    // A signed-in window may not have resolved its session yet when the view
    // first opens; reloading on the first reveal populates the tree without
    // waiting for the user to press refresh.
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
