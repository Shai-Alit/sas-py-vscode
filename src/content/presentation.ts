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
 * ## Five kinds, and two state suffixes
 *
 * 6c-i adds create / rename / delete to the tree's context menu; 6d-i adds
 * add-to / remove-from My Favorites. The `when` clauses tell apart:
 *
 * - `sasContent:root` — the synthetic "SAS Content" node. No action: it has no
 *   service representation to create under, and cannot be renamed or deleted.
 * - `sasContent:myFolder` — the "My Folder" delegate. Create inside it; do not
 *   rename or delete it, and it is not favouritable.
 * - `sasContent:delegate` — the "My Favorites" delegate. None of create /
 *   rename / delete / favourite (favourites are references).
 * - `sasContent:recycleBin` — the "Recycle Bin" delegate. Its own action is
 *   "Empty Recycle Bin" (6d-ii); none of create / rename / delete / favourite.
 * - `sasContent:folder` — an ordinary folder (a root-listing folder or a
 *   folder member). Create, rename, delete, and favourite.
 * - `sasContent:file` — a file or other leaf member. Rename, delete, favourite.
 *
 * `sasContent:folder` / `sasContent:file` take **one** of two mutually exclusive
 * suffixes, so the one place this project's otherwise-discrete `contextValue`
 * set carries item state, and the reason `package.json`'s content `when` clauses
 * match with `=~` on an anchored pattern rather than `==`:
 *
 * - **`.fav`** (`sasContent:folder.fav`) — the item is already in My Favorites,
 *   so the menu offers "Remove from My Favorites" instead of "Add".
 * - **`.recycled`** (`sasContent:file.recycled`) — the item is shown inside the
 *   Recycle Bin ({@link ContentItem.inRecycleBin}). Every content `when` clause
 *   is `$`-anchored after its optional `.fav`, so a `.recycled` item matches
 *   **none** of them — create, rename, delete and favourite are all withheld
 *   from bin content, whose real actions (restore / permanently delete) are
 *   6d-ii's. This also tightens the 6c-i menu, which until 6d-i offered
 *   rename/delete on a bin child.
 */

import {
  FILE_CONTENT_TYPE,
  isContainer,
  isDelegateFolder,
  isMyFolderDelegate,
  isRecycleBinDelegate,
  isSasContentRoot,
  typeNameOf,
  type ContentItem,
} from "./types";

/** An ordinary folder the tree can descend into — create, rename, delete,
 * favourite. Takes a {@link FAVORITE_SUFFIX} when already favourited. */
export const CONTEXT_FOLDER = "sasContent:folder";
/** A leaf — a file or other non-navigable member. Rename, delete, favourite.
 * Takes a {@link FAVORITE_SUFFIX} when already favourited. */
export const CONTEXT_FILE = "sasContent:file";
/** The synthetic "SAS Content" root. No actions. */
export const CONTEXT_ROOT = "sasContent:root";
/** The "My Folder" delegate — create inside it, but do not rename or delete. */
export const CONTEXT_MY_FOLDER = "sasContent:myFolder";
/** The "My Favorites" delegate — no create/rename/delete/favourite. */
export const CONTEXT_DELEGATE = "sasContent:delegate";
/** The "Recycle Bin" delegate — carries only "Empty Recycle Bin" (6d-ii). */
export const CONTEXT_RECYCLE_BIN = "sasContent:recycleBin";
/** Appended to {@link CONTEXT_FOLDER} / {@link CONTEXT_FILE} for an item already
 * in My Favorites (6d-i). Mutually exclusive with {@link RECYCLED_SUFFIX}. */
export const FAVORITE_SUFFIX = ".fav";
/** Appended to {@link CONTEXT_FOLDER} / {@link CONTEXT_FILE} for an item shown
 * inside the Recycle Bin ({@link ContentItem.inRecycleBin}), so every content
 * `when` clause — all `$`-anchored — withholds itself (6d-i; the bin's own
 * actions are 6d-ii). Mutually exclusive with {@link FAVORITE_SUFFIX}: a bin
 * item is never favouritable. */
export const RECYCLED_SUFFIX = ".recycled";

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
  /**
   * `true` → the drag-and-drop controller (6c-ii) may pick this item up. A
   * `type: "child"` member — a folder or a file below the four delegates —
   * qualifies, **except** one flagged {@link ContentItem.inRecycleBin}: a
   * recycled item's drag is a restore, which is 6d's. A delegate folder, a
   * top-level root-listing folder, and the synthetic root never qualify (no
   * member record to re-parent). Whether a given *drop* is a valid move is
   * `src/content/contentMove.ts`'s call — this only pre-filters the drag.
   */
  readonly draggable: boolean;
  /**
   * Which My Favorites action the menu should offer (6d-i): `"remove"` when the
   * item is already favourited ({@link ContentItem.isInMyFavorites}), `"add"`
   * for an ordinary folder or leaf that is not, `"none"` for the synthetic root,
   * the delegates, and anything in the Recycle Bin. Mirrored into
   * {@link NodePresentation.contextValue} via {@link FAVORITE_SUFFIX}; exposed
   * on its own so the mapping is unit-testable without parsing the string.
   */
  readonly favoriteAction: "add" | "remove" | "none";
  /** A `vscode.ThemeIcon` id — no bundled SVGs. */
  readonly icon: string;
  readonly contextValue: string;
}

/** The presentation for one item. */
export function nodePresentationOf(item: ContentItem): NodePresentation {
  const container = isContainer(item);
  const base = contextValueFor(item, container);
  const favoriteAction = favoriteActionFor(item, base);
  return {
    label: item.name,
    expandable: container,
    openable: !container && typeNameOf(item) === FILE_CONTENT_TYPE,
    draggable: item.type === "child" && item.inRecycleBin !== true,
    favoriteAction,
    icon: iconIdFor(item, container),
    contextValue: contextValueWithState(item, base, favoriteAction),
  };
}

/**
 * The `base` `contextValue` plus at most one state suffix. `.fav` and
 * `.recycled` never co-occur (a bin item's {@link favoriteActionFor} is always
 * `"none"`), and both apply only to {@link CONTEXT_FOLDER} / {@link CONTEXT_FILE}
 * — a delegate or the root keeps its bare value.
 */
function contextValueWithState(
  item: ContentItem,
  base: string,
  favoriteAction: "add" | "remove" | "none",
): string {
  if (base !== CONTEXT_FOLDER && base !== CONTEXT_FILE) return base;
  if (favoriteAction === "remove") return `${base}${FAVORITE_SUFFIX}`;
  if (item.inRecycleBin === true) return `${base}${RECYCLED_SUFFIX}`;
  return base;
}

function contextValueFor(item: ContentItem, container: boolean): string {
  if (isSasContentRoot(item)) return CONTEXT_ROOT;
  if (isMyFolderDelegate(item)) return CONTEXT_MY_FOLDER;
  if (isRecycleBinDelegate(item)) return CONTEXT_RECYCLE_BIN;
  if (isDelegateFolder(item)) return CONTEXT_DELEGATE;
  return container ? CONTEXT_FOLDER : CONTEXT_FILE;
}

/**
 * Only an ordinary folder or leaf ({@link CONTEXT_FOLDER} / {@link CONTEXT_FILE})
 * is favouritable — the synthetic root, every delegate (My Favorites and the
 * Recycle Bin included), and My Folder all resolve to a different `base` and are
 * ruled out by the first check. An item shown *inside* the Recycle Bin
 * ({@link ContentItem.inRecycleBin}) is not favouritable either. A favouritable
 * item is `"remove"` when {@link ContentItem.isInMyFavorites} was stamped by
 * {@link ContentAdapter.getChildItems}, `"add"` otherwise.
 */
function favoriteActionFor(
  item: ContentItem,
  base: string,
): "add" | "remove" | "none" {
  if (base !== CONTEXT_FOLDER && base !== CONTEXT_FILE) return "none";
  if (item.inRecycleBin === true) return "none";
  return item.isInMyFavorites === true ? "remove" : "add";
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
