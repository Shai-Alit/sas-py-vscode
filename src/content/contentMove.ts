// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Whether a drag-and-drop move should be attempted at all — the guard the
 * `TreeDragAndDropController` in `src/content/contentDragAndDrop.ts` consults
 * before calling `ContentAdapter.moveItem`. 6c-ii.
 *
 * **This module must never import `vscode`.**
 *
 * It answers only the questions that can be settled from the two items in hand.
 * A **cycle** — dropping a folder onto something inside it — is deliberately
 * *not* one of them: detecting it would need an ancestor walk this tree has no
 * cheap way to do before `getParent`/`reveal` lands in 6c-iii, and finding 6.10
 * measured the Folders service rejecting it itself with a `400` ("A folder
 * cannot be moved or copied into itself"), which reaches the user as a
 * `content-rejected` message. So this guard covers the drops that are wrong on
 * their face; the server covers the one that needs tree structure to see.
 */

import { findLink } from "../wire/links";
import {
  isContainer,
  isDelegateFolder,
  isMyFolderDelegate,
  isSasContentRoot,
  resourceHrefOf,
  UP_REL,
  type ContentItem,
} from "./types";

/**
 * Why a drop was not turned into a move.
 *
 * - `not-a-member` — the dragged item is not a `type: "child"` member (a
 *   delegate folder, a top-level root-listing folder, the synthetic root). Only
 *   members carry the `self`/`update` link `moveItem` PUTs and an `up` link to
 *   reason about; moving one is out of scope for 6c-ii.
 * - `target-not-a-folder` — the drop landed on a file, the synthetic "SAS
 *   Content" root (no representation to move into), or the My Favorites /
 *   Recycle Bin delegates (their drops are add-to-favourites / recycle, which
 *   are 6d, not a move).
 * - `in-recycle-bin` — either side is a direct child of the Recycle Bin
 *   ({@link ContentItem.inRecycleBin}, set by `getChildItems`). Dragging a
 *   recycled item out would be a restore, and dropping into one an odd
 *   half-recycle — both are 6d's to define, not a plain move.
 * - `into-itself` — the item was dropped onto itself.
 * - `already-there` — the item was dropped onto the folder it already lives in;
 *   nothing to do.
 */
export type MoveObjection =
  | "not-a-member"
  | "target-not-a-folder"
  | "in-recycle-bin"
  | "into-itself"
  | "already-there";

/**
 * `undefined` when `dragged` may be moved into `target`, otherwise the reason
 * not to try. A caller with several dragged items filters the list through this
 * and moves what is left, silently skipping the rest.
 */
export function moveObjection(
  dragged: ContentItem,
  target: ContentItem,
): MoveObjection | undefined {
  if (dragged.type !== "child") return "not-a-member";
  if (dragged.inRecycleBin === true || target.inRecycleBin === true) {
    return "in-recycle-bin";
  }

  const targetCanReceive =
    isContainer(target) &&
    !isSasContentRoot(target) &&
    (!isDelegateFolder(target) || isMyFolderDelegate(target));
  if (!targetCanReceive) return "target-not-a-folder";

  const targetHref = resourceHrefOf(target);
  const draggedHref = resourceHrefOf(dragged);
  if (
    targetHref !== undefined &&
    draggedHref !== undefined &&
    targetHref === draggedHref
  ) {
    return "into-itself";
  }

  const currentParent =
    dragged.parentFolderUri ?? findLink(dragged.links, UP_REL)?.href;
  if (
    currentParent !== undefined &&
    targetHref !== undefined &&
    currentParent === targetHref
  ) {
    return "already-there";
  }

  return undefined;
}
