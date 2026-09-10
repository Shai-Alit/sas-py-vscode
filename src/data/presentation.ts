// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * How a {@link DataItem} presents in the tree — its label, whether it
 * expands, which theme icon it takes, and the `contextValue` a future
 * context-menu `when` clause keys on.
 *
 * **This module must never import `vscode`.**
 *
 * `src/data/dataTree.ts` maps this shape onto a `vscode.TreeItem` and does
 * nothing else with a branch in it — the same split `src/content/presentation.ts`
 * makes for the SAS Content tree.
 */

import { isLibrary, type DataItem } from "./types";

/** A library — always expandable, even when it turns out to hold no tables. */
export const CONTEXT_LIBRARY = "sasData:library";
/** A table — always a leaf in this slice; opening one is 7b. */
export const CONTEXT_TABLE = "sasData:table";

export interface NodePresentation {
  readonly label: string;
  /** `true` → the tree shows an expand chevron (collapsed). */
  readonly expandable: boolean;
  /** A `vscode.ThemeIcon` id — no bundled SVGs. Both ids are confirmed
   * present in the codicon set VS Code ships (`database`, `symbol-array`). */
  readonly icon: string;
  readonly contextValue: string;
}

/** The presentation for one item. */
export function nodePresentationOf(item: DataItem): NodePresentation {
  if (isLibrary(item)) {
    return {
      label: item.name,
      expandable: true,
      icon: "database",
      contextValue: CONTEXT_LIBRARY,
    };
  }
  return {
    label: item.name,
    expandable: false,
    icon: "symbol-array",
    contextValue: CONTEXT_TABLE,
  };
}
