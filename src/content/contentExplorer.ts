// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Wires the "SAS Content" surface into the window: the tree data provider, the
 * activity-bar view, the `sasContent:` filesystem provider (6b), the refresh
 * command, and the auth events the tree refreshes on.
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
import { registerContentCommands } from "./contentCommands";
import { SasContentDragAndDropController } from "./contentDragAndDrop";
import {
  ContentSession,
  type ContentSessionDeps,
  type SessionLike,
} from "./contentSession";
import { SasContentFileSystemProvider } from "./contentFileSystem";
import { SasContentTreeProvider } from "./contentTree";
import { type ContentItem } from "./types";
import { CONTENT_SCHEME } from "./uri";

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

  // The tree reads the adapter for whatever deployment is active right now; the
  // filesystem provider reads the one for the deployment named in each URI it
  // is handed, which may not be the active profile any more (the user switched
  // with a document still open). `ContentSession` keeps an adapter per
  // endpoint so both are served.
  const activeEndpoint = () => profiles.active()?.profile.endpoint;

  const provider = new SasContentTreeProvider(
    () => session.adapterFor(activeEndpoint()),
    activeEndpoint,
    log,
  );
  const fileSystem = new SasContentFileSystemProvider(
    (endpoint) => session.adapterFor(endpoint),
    log,
  );

  // 6c-iii: show and select the item a create or move just landed.
  // `provider.getParent` drives the walk; `reveal` rejects when it cannot place
  // the node (the identity gap the tree-provider doc comment describes), which
  // is swallowed — a best-effort expand is still the point. The view is filled
  // in below (the drag-and-drop controller it needs is built first); `reveal`
  // only runs on later user action, so `current` is set by then.
  const viewRef: { current: vscode.TreeView<ContentItem> | undefined } = {
    current: undefined,
  };
  const reveal = (item: ContentItem): Thenable<void> =>
    viewRef.current === undefined
      ? Promise.resolve()
      : Promise.resolve(
          viewRef.current.reveal(item, {
            select: true,
            focus: false,
            expand: true,
          }),
        ).then(
          () => undefined,
          () => undefined,
        );

  // 6c-ii: drag a folder or file member onto another folder to move it. The
  // controller is a thin shell — `contentMove.ts` decides which drops are
  // moves, `adapter.moveItem` does the wire work. `canSelectMany` lets a user
  // drag several at once; the 6c-i context-menu commands (create / rename /
  // delete) only ever act on the clicked item, so their `view/item/context`
  // `when` clauses in `package.json` carry `&& !listMultiSelection` — they
  // simply don't offer themselves while more than one item is selected, rather
  // than silently acting on one of several.
  const dragAndDrop = new SasContentDragAndDropController({
    adapter: () => session.adapterFor(activeEndpoint()),
    refresh: () => {
      provider.refresh();
    },
    reveal,
    log,
    viewId: CONTENT_VIEW_ID,
  });

  const view = vscode.window.createTreeView(CONTENT_VIEW_ID, {
    treeDataProvider: provider,
    dragAndDropController: dragAndDrop,
    canSelectMany: true,
  });
  viewRef.current = view;

  // The tree context-menu mutations (6c-i). They read the same
  // per-active-deployment adapter the tree does, and reload through the tree.
  registerContentCommands(context, {
    adapter: () => session.adapterFor(activeEndpoint()),
    refresh: (item) => {
      provider.refresh(item);
    },
    reveal,
    log,
    viewId: CONTENT_VIEW_ID,
  });

  context.subscriptions.push(
    provider,
    fileSystem,
    // `sasContent:` files are editable (`isReadonly: false`); the read-only
    // recycle-bin scheme is a separate registration in 6d. Case-sensitive
    // because the id in the query, not the path, identifies the file.
    vscode.workspace.registerFileSystemProvider(CONTENT_SCHEME, fileSystem, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
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
