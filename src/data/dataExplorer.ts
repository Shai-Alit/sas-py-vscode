// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Wires the "SAS Libraries" view into the window: the tree data provider, the
 * activity-bar view (a second view inside the container 6a-ii created — the
 * phase file's own coordination note), the refresh command, and the events
 * the tree refreshes on.
 *
 * This file is a registrar with no branch in it, mirroring
 * `src/content/contentExplorer.ts`. Building a `LibraryAdapter` is cheap
 * enough (ADR-0027: it holds nothing but a profile id and a reference to
 * `sessions`) that there is no `DataSession`-equivalent cache the way
 * `ContentSession` caches an HTTP client per endpoint — a fresh adapter is
 * constructed on every `currentAdapter()` call, keyed off whichever profile
 * is active *right now*.
 *
 * ## Genuinely session-bound, unlike SAS Content
 *
 * Browsing SAS Content needs only an endpoint and a token. Browsing libraries
 * needs the active profile's actual compute session — ADR-0027 — so this
 * registrar also takes `sessions` (structurally, `ComputeSessionManager`) and
 * refreshes on `onDidChangeConnection`, an event `src/compute/commands.ts`
 * added for exactly this: connecting, disconnecting or a run discovering its
 * own session gone (`forgetProfile`) all change what the tree should show,
 * and none of those already fired an event the content tree needed.
 *
 * ## 7b: `pythonOnViya.openTable`
 *
 * The command `src/data/dataTree.ts`'s table nodes now carry, and
 * `package.json`'s `view/item/context` entry mirrors for the right-click
 * menu. Builds the same `currentAdapter()` a tree refresh would and hands it,
 * together with the clicked `TableItem`, to `panels.open` — so opening a
 * table always uses the adapter for whichever profile is active *at the
 * moment of the click*, the same "read fresh, never cached" rule
 * `currentAdapter` already applies to the tree. No adapter (no active
 * profile) is a silent no-op: a table node cannot exist without one already
 * having populated the tree, so this is unreachable in practice, not a state
 * this command has to explain to the user.
 *
 * ## 7c-ii: `pythonOnViya.showTableProperties`
 *
 * A context-menu-only sibling of `openTable` — same `currentAdapter()`/
 * `TableItem` handoff, this time to `propertiesPanels.open`
 * (`src/data/tablePropertiesPanel.ts`), which renders a static properties/
 * columns view rather than the paged data grid.
 */

import * as vscode from "vscode";

import { LibraryAdapter, type LibrarySessionSource } from "./adapter";
import { SasLibraryTreeProvider } from "./dataTree";
import type { DataViewerPanelManager } from "./dataViewerPanel";
import type { TablePropertiesPanelManager } from "./tablePropertiesPanel";
import { isTable, type DataItem } from "./types";
import type { ProfileStore } from "../profile/store";

/** The id of the tree view, matching `package.json`'s `contributes.views`. */
export const DATA_VIEW_ID = "pythonOnViya.dataExplorer";

/** What this module needs from the profile store. */
export type DataProfileSource = Pick<ProfileStore, "active" | "onDidChange">;

/** The events the explorer reacts to besides its own refresh command. */
export interface DataExplorerEvents {
  readonly onDidChangeSessions: vscode.Event<unknown>;
  readonly onDidSignOut: vscode.Event<unknown>;
  /** Fires after `connect`, `disconnect` or `forgetProfile` re-syncs
   * `pythonOnViya.connected` (`src/compute/commands.ts`) — the one event
   * source that tells this tree its session-dependent view of the world may
   * have just changed. */
  readonly onDidChangeConnection: vscode.Event<void>;
}

/**
 * Registers the SAS Libraries explorer. Returns nothing; every disposable is
 * pushed on `context.subscriptions`.
 */
export function registerDataExplorer(
  context: vscode.ExtensionContext,
  profiles: DataProfileSource,
  sessions: LibrarySessionSource,
  log: vscode.LogOutputChannel,
  events: DataExplorerEvents,
  panels: DataViewerPanelManager,
  propertiesPanels: TablePropertiesPanelManager,
): void {
  const currentAdapter = (): LibraryAdapter | undefined => {
    const profileId = profiles.active()?.profile.id;
    return profileId === undefined
      ? undefined
      : new LibraryAdapter(sessions, profileId);
  };

  const provider = new SasLibraryTreeProvider(currentAdapter, log);

  const view = vscode.window.createTreeView(DATA_VIEW_ID, {
    treeDataProvider: provider,
  });

  context.subscriptions.push(
    provider,
    view,
    panels,
    propertiesPanels,
    vscode.commands.registerCommand("pythonOnViya.refreshDataExplorer", () => {
      provider.refresh();
    }),
    vscode.commands.registerCommand(
      "pythonOnViya.openTable",
      (item?: DataItem) => {
        if (item === undefined || !isTable(item)) return;
        const adapter = currentAdapter();
        if (adapter === undefined) return;
        // Fire-and-forget from a command handler — `open`'s own promise
        // exists for an integration test to await, not for this call site.
        // Caught, though, not bare `void`: every failure `LibraryAdapter`
        // itself anticipates comes back as a typed `Result` the panel already
        // surfaces in its own UI, but `open` calls through to
        // `ComputeClient.send`, which rethrows whatever `resolveHref` throws
        // that is not a `ForeignLinkError` — the same real, if narrow, gap
        // `sessionManager.ts`'s own `deleteSession` call already has to guard
        // against for exactly this reason. An uncaught rejection here would
        // land in the extension host as an unhandled rejection, visible to
        // no one — logged instead, so an unexpected failure to open a table
        // is at least diagnosable.
        void panels.open(item, adapter).catch((error: unknown) => {
          log.error(
            vscode.l10n.t(
              'SAS Libraries: could not open the data viewer panel for "{0}.{1}" ({2})',
              item.libref,
              item.name,
              String(error),
            ),
          );
        });
      },
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.showTableProperties",
      (item?: DataItem) => {
        if (item === undefined || !isTable(item)) return;
        const adapter = currentAdapter();
        if (adapter === undefined) return;
        // Same fire-and-forget/catch shape as `openTable` above, and for the
        // identical reason.
        void propertiesPanels.open(item, adapter).catch((error: unknown) => {
          log.error(
            vscode.l10n.t(
              'SAS Libraries: could not open the table properties panel for "{0}.{1}" ({2})',
              item.libref,
              item.name,
              String(error),
            ),
          );
        });
      },
    ),
    // A signed-in window may not have connected yet when the view first
    // opens; reloading on the first reveal populates the tree without
    // waiting for the user to press refresh — the same reasoning
    // `contentExplorer.ts` gives for its own identical listener.
    view.onDidChangeVisibility((event) => {
      if (event.visible) provider.refresh();
    }),
    profiles.onDidChange(() => {
      provider.refresh();
    }),
    events.onDidChangeSessions(() => {
      provider.refresh();
    }),
    events.onDidSignOut(() => {
      provider.refresh();
    }),
    events.onDidChangeConnection(() => {
      provider.refresh();
    }),
  );
}
