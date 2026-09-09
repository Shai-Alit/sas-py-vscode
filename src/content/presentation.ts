// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * How a {@link ContentItem} presents in the tree — its label, whether it
 * expands, which theme icon it takes, and the `contextValue` a future
 * context-menu `when` clause keys on.
 *
 * **This module must never import `vscode`.**
 *
 * `src/content/contentTree.ts` maps this shape onto a `vscode.TreeItem` and
 * does nothing else with a branch in it, so the mapping decisions are all
 * unit-testable here rather than only reachable through the extension host.
 */

import {
  isContainer,
  isSasContentRoot,
  typeNameOf,
  type ContentItem,
} from "./types";

/** A folder-shaped item the tree can descend into. */
export const CONTEXT_FOLDER = "sasContent:folder";
/** A leaf — a file or other non-navigable member. */
export const CONTEXT_FILE = "sasContent:file";
/** The synthetic "SAS Content" root. */
export const CONTEXT_ROOT = "sasContent:root";

export interface NodePresentation {
  readonly label: string;
  /** `true` → the tree shows an expand chevron (collapsed). */
  readonly expandable: boolean;
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
    icon: iconIdFor(item, container),
    contextValue: isSasContentRoot(item)
      ? CONTEXT_ROOT
      : container
        ? CONTEXT_FOLDER
        : CONTEXT_FILE,
  };
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
