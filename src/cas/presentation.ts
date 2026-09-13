// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * How a {@link CasItem} presents in the tree — its label, whether it
 * expands, which theme icon it takes, and the `contextValue` a future
 * context-menu `when` clause keys on.
 *
 * **This module must never import `vscode`.**
 *
 * `src/cas/casTree.ts` maps this shape onto a `vscode.TreeItem` and does
 * nothing else with a branch in it — the same split `src/data/presentation.ts`
 * makes for the SAS Libraries tree.
 */

import { isCaslib, isCasServer, isCasTable, type CasItem } from "./types";

export const CONTEXT_SERVER = "sasCas:server";
export const CONTEXT_CASLIB = "sasCas:caslib";
export const CONTEXT_TABLE = "sasCas:table";
export const CONTEXT_COLUMN = "sasCas:column";

export interface NodePresentation {
  readonly label: string;
  /** Shown dimmed to the right of the label — only a column carries one in
   * this slice, its type, since there is no separate column-detail view
   * (unlike `src/data/tablePropertiesPanel.ts`'s table properties). */
  readonly description?: string | undefined;
  /** `true` → the tree shows an expand chevron (collapsed). */
  readonly expandable: boolean;
  /** A `vscode.ThemeIcon` id — no bundled SVGs. Every id here is confirmed
   * present in the codicon set VS Code ships (`server`, `database`, `table`,
   * `symbol-field`). */
  readonly icon: string;
  readonly contextValue: string;
}

/** The presentation for one item. */
export function nodePresentationOf(item: CasItem): NodePresentation {
  if (isCasServer(item)) {
    return {
      label: item.name,
      expandable: true,
      icon: "server",
      contextValue: CONTEXT_SERVER,
    };
  }
  if (isCaslib(item)) {
    return {
      label: item.name,
      expandable: true,
      icon: "database",
      contextValue: CONTEXT_CASLIB,
    };
  }
  if (isCasTable(item)) {
    return {
      label: item.name,
      expandable: true,
      icon: "table",
      contextValue: CONTEXT_TABLE,
    };
  }
  return {
    label: item.name,
    description: item.type,
    expandable: false,
    icon: "symbol-field",
    contextValue: CONTEXT_COLUMN,
  };
}
