// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Wires the "SAS Server" view into the window: the tree, the
 * `pythonOnViyaServer:` filesystem provider, the refresh and Copy Path
 * commands, and the events the tree refreshes on.
 *
 * A registrar with no branch in it, mirroring `src/data/dataExplorer.ts`. Like
 * the Library view, this one is session-bound: it borrows the active
 * profile's compute session (ADR-0047, ADR-0027) and refreshes on
 * `onDidChangeConnection`. A `ServerAdapter` holds nothing but a profile id,
 * its settings and the shared {@link ContextAttributeCache}, so one is built
 * per call.
 */

import * as vscode from "vscode";

import {
  ContextAttributeCache,
  ServerAdapter,
  type ServerSessionSource,
} from "./adapter";
import { ServerEditorFiles } from "./editorFiles";
import { SERVER_SCHEME } from "./path";
import { SasServerFileSystemProvider } from "./serverFileSystem";
import {
  isServerTreeItem,
  REFRESH_SERVER_COMMAND,
  SasServerTreeProvider,
  type ServerTreeNode,
} from "./serverTree";
import type { ProfileStore } from "../profile/store";

/** The id of the tree view, matching `package.json`'s `contributes.views`. */
export const SERVER_VIEW_ID = "pythonOnViya.serverExplorer";

/** The Copy Path command, on the tree's context menu only. */
export const COPY_SERVER_PATH_COMMAND = "pythonOnViya.copyServerPath";

/** The setting that shows dot-files, under `pythonOnViya`. */
const SHOW_HIDDEN_SETTING = "sasServer.showHiddenFiles";

/** What this module needs from the profile store. */
export type ServerProfileSource = Pick<ProfileStore, "active" | "onDidChange">;

/** The events the view refreshes on besides its own refresh command. */
export interface ServerExplorerEvents {
  readonly onDidChangeSessions: vscode.Event<unknown>;
  readonly onDidSignOut: vscode.Event<unknown>;
  /** Fires after connect, disconnect or `forgetProfile`
   * (`src/compute/commands.ts`). */
  readonly onDidChangeConnection: vscode.Event<void>;
}

/** Registers the SAS Server view. Every disposable goes on
 * `context.subscriptions`. */
export function registerServerExplorer(
  context: vscode.ExtensionContext,
  profiles: ServerProfileSource,
  sessions: ServerSessionSource,
  log: vscode.LogOutputChannel,
  events: ServerExplorerEvents,
  forgetProfile: (profileId: string) => void,
): void {
  const attributes = new ContextAttributeCache();
  const showHidden = (): boolean =>
    vscode.workspace
      .getConfiguration("pythonOnViya")
      .get<boolean>(SHOW_HIDDEN_SETTING, false);

  const currentAdapter = (): ServerAdapter | undefined => {
    const active = profiles.active();
    if (active === undefined) return undefined;
    const { profile } = active;
    return new ServerAdapter(sessions, profile.id, {
      navigation: {
        root: profile.fileNavigationRoot,
        customPath: profile.fileNavigationCustomRootPath,
      },
      showHidden: showHidden(),
      attributes,
    });
  };

  // An editor's file is found by path, so the root setting does not matter
  // here; any profile id works, and a profile with no session is reported
  // `not-connected` by the adapter.
  const adapterFor = (profileId: string): ServerAdapter =>
    new ServerAdapter(sessions, profileId, {
      navigation: {},
      showHidden: false,
      attributes,
    });

  const provider = new SasServerTreeProvider(
    currentAdapter,
    log,
    forgetProfile,
  );
  const fileSystem = new SasServerFileSystemProvider(
    adapterFor,
    new ServerEditorFiles(adapterFor),
    log,
    forgetProfile,
  );
  const view = vscode.window.createTreeView(SERVER_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    provider,
    fileSystem,
    view,
    vscode.workspace.registerFileSystemProvider(SERVER_SCHEME, fileSystem, {
      isCaseSensitive: true,
    }),
    vscode.commands.registerCommand(REFRESH_SERVER_COMMAND, () => {
      provider.refresh();
    }),
    vscode.commands.registerCommand(
      COPY_SERVER_PATH_COMMAND,
      async (node?: ServerTreeNode) => {
        if (node === undefined || !isServerTreeItem(node)) return;
        await vscode.env.clipboard.writeText(node.item.path);
      },
    ),
    view.onDidChangeVisibility((event) => {
      if (event.visible) provider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`pythonOnViya.${SHOW_HIDDEN_SETTING}`)) {
        provider.refresh();
      }
    }),
    profiles.onDidChange(() => {
      provider.refresh();
    }),
    events.onDidChangeSessions(() => {
      provider.refresh();
    }),
    events.onDidSignOut(() => {
      attributes.clear();
      provider.refresh();
    }),
    events.onDidChangeConnection(() => {
      provider.refresh();
    }),
  );
}
