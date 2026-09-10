// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * How a {@link ContentItem} presents in the tree — its label, whether it
 * expands, which theme icon it takes, and the `contextValue` a context-menu
 * `when` clause keys on.
 *
 * **This module must never import `vscode`.**
 *
 * `src/content/contentTree.ts` maps this shape onto a `vscode.TreeItem` and
 * does nothing else with a branch in it, so the mapping decisions are all
 * unit-testable here rather than only reachable through the extension host.
 *
 * ## Five `contextValue`s, because five things the menu treats differently
 *
 * 6c-i adds create / rename / delete to the tree's context menu, and the
 * `when` clauses need to tell apart:
 *
 * - `sasContent:root` — the synthetic "SAS Content" node. No action: it has no
 *   service representation to create under, and cannot be renamed or deleted.
 * - `sasContent:myFolder` — the "My Folder" delegate. Create inside it; do not
 *   rename or delete it.
 * - `sasContent:delegate` — the "My Favorites" / "Recycle Bin" delegates.
 *   None of create / rename / delete (favourites are references; the recycle
 *   bin is 6d).
 * - `sasContent:folder` — an ordinary folder (a root-listing folder or a
 *   folder member). All three actions.
 * - `sasContent:file` — a file or other leaf member. Rename and delete.
 */

import {
  FILE_CONTENT_TYPE,
  isContainer,
  isDelegateFolder,
  isMyFolderDelegate,
  isSasContentRoot,
  typeNameOf,
  type ContentItem,
} from "./types";

/** An ordinary folder the tree can descend into — create, rename, delete. */
export const CONTEXT_FOLDER = "sasContent:folder";
/** A leaf — a file or other non-navigable member. Rename, delete. */
export const CONTEXT_FILE = "sasContent:file";
/** The synthetic "SAS Content" root. No actions. */
export const CONTEXT_ROOT = "sasContent:root";
/** The "My Folder" delegate — create inside it, but do not rename or delete. */
export const CONTEXT_MY_FOLDER = "sasContent:myFolder";
/** The "My Favorites" / "Recycle Bin" delegates — no create/rename/delete. */
export const CONTEXT_DELEGATE = "sasContent:delegate";

export interface NodePresentation {
  readonly label: string;
  /** `true` → the tree shows an expand chevron (collapsed). */
  readonly expandable: boolean;
  /**
   * `true` → a file leaf the `sasContent:` `FileSystemProvider` can open, so
   * `contentTree.ts` gives the node a `vscode.open` command. Only an ordinary
   * `file` member qualifies; a folder, the root, and a `dataFlow` leaf do not.
   */
  readonly openable: boolean;
  /** A `vscode.ThemeIcon` id — no bundled SVGs. */
  readonly icon: string;
  readonly contextValue: string;
}

/** The presentation for one item. */
export function nodePresentationOf(item: ContentItem): NodePresentation {
  const container = isContainer(item);
  return {
    label: item.name,
    expandable: container,
    openable: !container && typeNameOf(item) === FILE_CONTENT_TYPE,
    icon: iconIdFor(item, container),
    contextValue: contextValueFor(item, container),
  };
}

function contextValueFor(item: ContentItem, container: boolean): string {
  if (isSasContentRoot(item)) return CONTEXT_ROOT;
  if (isMyFolderDelegate(item)) return CONTEXT_MY_FOLDER;
  if (isDelegateFolder(item)) return CONTEXT_DELEGATE;
  return container ? CONTEXT_FOLDER : CONTEXT_FILE;
}

function iconIdFor(item: ContentItem, container: boolean): string {
  if (isSasContentRoot(item)) return "root-folder";
  switch (typeNameOf(item)) {
    case "favoritesFolder":
      return "star-full";
    case "trashFolder":
      return "trash";
    case "myFolder":
      return "folder-active";
    default:
      return container ? "folder" : "file";
  }
}
