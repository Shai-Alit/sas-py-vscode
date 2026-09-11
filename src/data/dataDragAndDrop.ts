// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Drag a table out of the "SAS Libraries" tree into a `.py` editor — 7d's
 * own drag-and-drop snippet, resolving the question `phase-7.md`'s Plan
 * section left open once 7a's tree existed to drop *from*.
 *
 * One class plays both `vscode` roles this needs, mirroring upstream's own
 * `LibraryDataProvider` (Apache-2.0) rather than this project's own 6c-ii
 * split (`src/content/contentDragAndDrop.ts` is a `TreeDragAndDropController`
 * only, since a content move never leaves the tree): `handleDrag` puts the
 * dragged table on a private MIME the tree never reads back
 * (`dropMimeTypes` is empty — there is no in-tree drop target), and
 * `provideDocumentDropEdits` is what a `.py` editor calls once the drop
 * actually lands there.
 *
 * ## The payload is a JSON string by the time it lands
 *
 * Between those two halves the payload crosses the extension-host RPC
 * boundary and VS Code serializes it, so what `provideDocumentDropEdits`
 * reads back is `JSON.stringify`'d text rather than the `TableItem[]`
 * `handleDrag` set. `readDraggedTables` (`./types`) owns that boundary and
 * carries the citation; upstream's own `ContentDataProvider` parses at the
 * identical point for the identical reason. This is the one respect in which
 * a tree→editor drop differs from `contentDragAndDrop.ts`'s tree→tree drop,
 * which does get the live objects back.
 *
 * ## The choice on drop
 *
 * Sean's own call (2026-09-11): a drop always asks, via a quick pick,
 * whether to insert a plain `SAS.sd2df(...)` read or a `SAS.submit`-based
 * `PROC SQL` pass-through that pushes a filter to the engine first — more
 * useful for a SAS/ACCESS-connected external table, at the cost of one extra
 * interaction upstream's own single-insert drop does not have. Cancelling
 * the quick pick (`Escape`, or the token firing) inserts nothing, the same
 * as cancelling any other quick pick in this project.
 *
 * ## Only the first dragged table
 *
 * Matches upstream's own `source?.[0]` restriction — this view has no
 * `canSelectMany` (7a never added it, and a multi-table drop would need its
 * own per-table naming and snippet-choice UI this slice does not need to
 * invent).
 *
 * ## The variable-name heuristic lives in `dragSnippet.ts`
 *
 * `deriveVariableName`/`dedupeIdentifier` are `vscode`-free and unit-tested;
 * this file's only job is turning the *document*'s own text into the
 * `isTaken` predicate they need — a document is a `vscode` type, so that
 * scan cannot move into `dragSnippet.ts` without breaking its own
 * `vscode`-free rule.
 */

import * as vscode from "vscode";

import {
  buildSd2dfSnippet,
  buildSqlPassthroughSnippet,
  dedupeIdentifier,
  deriveVariableName,
  deriveViewName,
} from "./dragSnippet";
import {
  isTable,
  readDraggedTables,
  type DataItem,
  type TableItem,
} from "./types";

/** Private to this view — a drop only means something when the drag started
 * here, matching `contentDragAndDrop.ts`'s own single-MIME convention. */
export const TABLE_MIME = "application/vnd.pythononviya.saslibrarytable";

/** `.py` documents only — a `SAS.sd2df`/`SAS.submit` snippet means nothing
 * in any other language this project's editor drop could land in. */
export const PYTHON_DROP_SELECTOR: vscode.DocumentSelector = {
  language: "python",
};

interface SnippetChoice extends vscode.QuickPickItem {
  // Named `snippetKind`, not `kind` — `vscode.QuickPickItem.kind` is already a
  // reserved property (`QuickPickItemKind`, for separator rendering).
  readonly snippetKind: "sd2df" | "sql";
}

/** Built fresh per drop, not module-level — every other quick pick in this
 * project calls `vscode.l10n.t()` from inside a function, not at import
 * time. */
function snippetChoices(): readonly SnippetChoice[] {
  return [
    {
      snippetKind: "sd2df",
      label: vscode.l10n.t("Read directly"),
      description: vscode.l10n.t("SAS.sd2df(...)"),
      detail: vscode.l10n.t("Read the whole table into a pandas DataFrame."),
    },
    {
      snippetKind: "sql",
      label: vscode.l10n.t("Filter with PROC SQL first"),
      description: vscode.l10n.t("SAS.submit(...)"),
      detail: vscode.l10n.t(
        "Push a WHERE filter down to the engine before reading, via a PROC SQL pass-through.",
      ),
    },
  ];
}

/** The one `vscode` port this class needs that an integration test cannot
 * drive for real — same reasoning as `RunCommandDeps.showQuickPick`. */
export interface DataDragAndDropDeps {
  /** Defaults to `vscode.window.showQuickPick`. */
  showQuickPick?:
    | ((
        items: readonly SnippetChoice[],
        options: vscode.QuickPickOptions,
        token: vscode.CancellationToken,
      ) => Thenable<SnippetChoice | undefined>)
    | undefined;
}

/** Escapes a value for use inside the `RegExp` constructor's own pattern
 * text — `variableName` candidates are this module's own sanitized output
 * (`[a-z0-9_]+`, never a regex metacharacter), but the guard costs nothing
 * and does not depend on that staying true. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class SasLibraryDragAndDropController
  implements
    vscode.TreeDragAndDropController<DataItem>,
    vscode.DocumentDropEditProvider
{
  readonly dragMimeTypes = [TABLE_MIME];
  readonly dropMimeTypes: string[] = [];

  constructor(private readonly deps: DataDragAndDropDeps = {}) {}

  handleDrag(
    source: readonly DataItem[],
    dataTransfer: vscode.DataTransfer,
  ): void {
    const tables = source.filter(isTable);
    if (tables.length === 0) return;
    dataTransfer.set(TABLE_MIME, new vscode.DataTransferItem(tables));
  }

  async provideDocumentDropEdits(
    document: vscode.TextDocument,
    _position: vscode.Position,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentDropEdit | undefined> {
    // `DataTransferItem.value` is `any`, and for a tree→editor drop it is the
    // JSON *string* VS Code serialized `handleDrag`'s array into, not the
    // array itself — `readDraggedTables` documents that boundary and is where
    // the per-entry validation lives (it is `vscode`-free, so unlike this
    // file it is unit-tested). Casting instead is what shipped first, and it
    // produced a `table` whose every field was `undefined`.
    const table = readDraggedTables(dataTransfer.get(TABLE_MIME)?.value)[0];
    // A closure, not a direct `token.isCancellationRequested` read at each
    // call site — the token can flip to cancelled while `showChoice` below
    // is awaited, and re-reading through a function call (matching
    // `contentDragAndDrop.ts`'s own `cancelled()`) is what makes the second
    // check below mean something different from the first, rather than
    // narrowing to the same answer TypeScript already knows.
    const cancelled = () => token.isCancellationRequested;
    if (table === undefined || cancelled()) {
      return undefined;
    }

    const chosen = await this.showChoice(table, token);
    if (chosen === undefined || cancelled()) {
      return undefined;
    }

    const documentText = document.getText();
    const isTaken = (candidate: string) =>
      new RegExp(
        `(^|[\\r\\n])[ \\t]*${escapeForRegExp(candidate)}[ \\t]*=`,
      ).test(documentText);
    const variableName = dedupeIdentifier(
      deriveVariableName(table.name),
      isTaken,
    );

    if (chosen.snippetKind === "sd2df") {
      return new vscode.DocumentDropEdit(
        buildSd2dfSnippet(table.libref, table.name, variableName),
      );
    }

    const viewName = deriveViewName(table.name);
    return new vscode.DocumentDropEdit(
      new vscode.SnippetString(
        buildSqlPassthroughSnippet(
          table.libref,
          table.name,
          variableName,
          viewName,
        ),
      ),
    );
  }

  private async showChoice(
    table: TableItem,
    token: vscode.CancellationToken,
  ): Promise<SnippetChoice | undefined> {
    const options: vscode.QuickPickOptions = {
      title: vscode.l10n.t(
        'Insert "{0}.{1}" into Python as…',
        table.libref,
        table.name,
      ),
      placeHolder: vscode.l10n.t("Choose how to bring this table into Python"),
    };
    const choices = snippetChoices();
    const show = this.deps.showQuickPick;
    if (show !== undefined) return await show(choices, options, token);
    return await vscode.window.showQuickPick([...choices], options, token);
  }
}
