// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `SasLibraryDragAndDropController` (`src/data/dataDragAndDrop.ts`, 7d) —
 * constructed directly with a stubbed `showQuickPick`, the same pattern
 * `test/integration/content/dragAndDrop.test.ts` uses for its own controller,
 * since this file imports `vscode` and the coverage gate does not see it.
 * The variable-name heuristic and the two snippet bodies are
 * `test/unit/data-drag-snippet.test.ts`'s job; this file's job is the
 * `vscode` plumbing around them — what lands on the `DataTransfer`, and what
 * a real `TextDocument`'s own text does to the dedupe loop.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { SasLibraryDragAndDropController } from "../../../src/data/dataDragAndDrop";
import type { LibraryItem, TableItem } from "../../../src/data/types";

const TABLE_MIME = "application/vnd.pythononviya.saslibrarytable";

const classTable: TableItem = {
  kind: "table",
  libref: "SASHELP",
  name: "CLASS",
  links: [],
};

const carsTable: TableItem = {
  kind: "table",
  libref: "SASHELP",
  name: "CARS",
  links: [],
};

const sashelpLibrary: LibraryItem = {
  kind: "library",
  name: "SASHELP",
  links: [],
};

async function pythonDocument(content: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument({ language: "python", content });
}

function transferWith(tables: TableItem[]): vscode.DataTransfer {
  const transfer = new vscode.DataTransfer();
  transfer.set(TABLE_MIME, new vscode.DataTransferItem(tables));
  return transfer;
}

describe("SAS Libraries drag-and-drop (7d)", () => {
  it("handleDrag puts only table items on the transfer", () => {
    const controller = new SasLibraryDragAndDropController();
    const transfer = new vscode.DataTransfer();

    controller.handleDrag([sashelpLibrary, classTable], transfer);

    // Safe here, unlike the identical-looking cast this PR's own fix
    // replaced in dataDragAndDrop.ts: handleDrag sets this DataTransferItem's
    // value directly, in-process, and this test reads it back without
    // crossing the extension-host RPC boundary that serializes it into JSON
    // for a real tree->editor drop (see readDraggedTables in ./types.ts).
    const payload = transfer.get(TABLE_MIME)?.value as TableItem[] | undefined;
    assert.ok(payload);
    assert.deepEqual(
      payload.map((t) => t.name),
      ["CLASS"],
    );
  });

  it("handleDrag sets nothing when no dragged item is a table", () => {
    const controller = new SasLibraryDragAndDropController();
    const transfer = new vscode.DataTransfer();

    controller.handleDrag([sashelpLibrary], transfer);

    assert.equal(transfer.get(TABLE_MIME), undefined);
  });

  it("provideDocumentDropEdits returns undefined when the transfer carries no table", async () => {
    const controller = new SasLibraryDragAndDropController();
    const document = await pythonDocument("");
    const tokenSource = new vscode.CancellationTokenSource();

    const edit = await controller.provideDocumentDropEdits(
      document,
      new vscode.Position(0, 0),
      new vscode.DataTransfer(),
      tokenSource.token,
    );

    assert.equal(edit, undefined);
    tokenSource.dispose();
  });

  it("provideDocumentDropEdits returns undefined when the quick pick is cancelled", async () => {
    const controller = new SasLibraryDragAndDropController({
      showQuickPick: () => Promise.resolve(undefined),
    });
    const document = await pythonDocument("");
    const tokenSource = new vscode.CancellationTokenSource();

    const edit = await controller.provideDocumentDropEdits(
      document,
      new vscode.Position(0, 0),
      transferWith([classTable]),
      tokenSource.token,
    );

    assert.equal(edit, undefined);
    tokenSource.dispose();
  });

  it("provideDocumentDropEdits returns undefined once the token is already cancelled, without even showing the quick pick", async () => {
    let quickPickShown = false;
    const controller = new SasLibraryDragAndDropController({
      showQuickPick: (items) => {
        quickPickShown = true;
        return Promise.resolve(items[0]);
      },
    });
    const document = await pythonDocument("");
    const tokenSource = new vscode.CancellationTokenSource();
    tokenSource.cancel();

    const edit = await controller.provideDocumentDropEdits(
      document,
      new vscode.Position(0, 0),
      transferWith([classTable]),
      tokenSource.token,
    );

    assert.equal(edit, undefined);
    assert.equal(quickPickShown, false);
    tokenSource.dispose();
  });

  it("passes the drop's own cancellation token through to the quick pick", async () => {
    let receivedToken: vscode.CancellationToken | undefined;
    const controller = new SasLibraryDragAndDropController({
      showQuickPick: (items, _options, token) => {
        receivedToken = token;
        return Promise.resolve(items.find((i) => i.snippetKind === "sd2df"));
      },
    });
    const document = await pythonDocument("");
    const tokenSource = new vscode.CancellationTokenSource();

    await controller.provideDocumentDropEdits(
      document,
      new vscode.Position(0, 0),
      transferWith([classTable]),
      tokenSource.token,
    );

    assert.equal(receivedToken, tokenSource.token);
    tokenSource.dispose();
  });

  it('"Read directly" inserts a plain sd2df assignment, as plain text', async () => {
    const controller = new SasLibraryDragAndDropController({
      showQuickPick: (items) =>
        Promise.resolve(items.find((i) => i.snippetKind === "sd2df")),
    });
    const document = await pythonDocument("");
    const tokenSource = new vscode.CancellationTokenSource();

    const edit = await controller.provideDocumentDropEdits(
      document,
      new vscode.Position(0, 0),
      transferWith([classTable]),
      tokenSource.token,
    );

    assert.ok(edit);
    assert.equal(edit.insertText, 'class_df = SAS.sd2df("SASHELP.CLASS")');
    tokenSource.dispose();
  });

  it('"Filter with PROC SQL first" inserts a SnippetString with a mirrored view-name tabstop', async () => {
    const controller = new SasLibraryDragAndDropController({
      showQuickPick: (items) =>
        Promise.resolve(items.find((i) => i.snippetKind === "sql")),
    });
    const document = await pythonDocument("");
    const tokenSource = new vscode.CancellationTokenSource();

    const edit = await controller.provideDocumentDropEdits(
      document,
      new vscode.Position(0, 0),
      transferWith([classTable]),
      tokenSource.token,
    );

    assert.ok(edit);
    assert.ok(edit.insertText instanceof vscode.SnippetString);
    const text = edit.insertText.value;
    assert.match(text, /create view work\.\$\{1:class_view\} as/);
    assert.match(text, /select \* from SASHELP\.CLASS/);
    assert.match(text, /SAS\.sd2df\("work\.\$1"\)/);
    tokenSource.dispose();
  });

  it("uses only the first table when several were dragged together", async () => {
    // `handleDrag` puts every filtered table on the transfer (7a's tree has
    // no `canSelectMany`, but nothing stops a future caller passing more than
    // one) — the "only the first" restriction is applied on the read side,
    // in `provideDocumentDropEdits`, matching upstream's own `source?.[0]`.
    // Nothing before this test exercised that end to end with a real
    // multi-table payload.
    const controller = new SasLibraryDragAndDropController({
      showQuickPick: (items) =>
        Promise.resolve(items.find((i) => i.snippetKind === "sd2df")),
    });
    const document = await pythonDocument("");
    const tokenSource = new vscode.CancellationTokenSource();

    const edit = await controller.provideDocumentDropEdits(
      document,
      new vscode.Position(0, 0),
      transferWith([classTable, carsTable]),
      tokenSource.token,
    );

    assert.ok(edit);
    assert.equal(edit.insertText, 'class_df = SAS.sd2df("SASHELP.CLASS")');
    tokenSource.dispose();
  });

  it("dedupes the assigned variable name against the document's own text", async () => {
    const controller = new SasLibraryDragAndDropController({
      showQuickPick: (items) =>
        Promise.resolve(items.find((i) => i.snippetKind === "sd2df")),
    });
    const document = await pythonDocument("class_df = 1\n");
    const tokenSource = new vscode.CancellationTokenSource();

    const edit = await controller.provideDocumentDropEdits(
      document,
      new vscode.Position(1, 0),
      transferWith([classTable]),
      tokenSource.token,
    );

    assert.ok(edit);
    assert.equal(edit.insertText, 'class_df2 = SAS.sd2df("SASHELP.CLASS")');
    tokenSource.dispose();
  });
});
