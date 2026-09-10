// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import type { ContentAdapter } from "../../../src/content/adapter";
import type { ContentResult } from "../../../src/content/client";
import { SasContentDragAndDropController } from "../../../src/content/contentDragAndDrop";
import { CONTENT_VIEW_ID } from "../../../src/content/contentExplorer";
import type { ContentItem } from "../../../src/content/types";

/**
 * The drag-and-drop move controller (6c-ii), constructed directly with a stub
 * adapter — the same pattern `fileSystem.test.ts` / `tree.test.ts` use for the
 * other `vscode` shells, since this file imports `vscode` and the coverage gate
 * does not see it. Whether a drop is a move is `test/unit/content-move.test.ts`;
 * the `PUT` wire shape is `test/unit/content-adapter.test.ts`.
 */

const MIME = "application/vnd.pythononviya.sascontent";

function fakeLog(): { channel: vscode.LogOutputChannel; errors: string[] } {
  const errors: string[] = [];
  const channel = {
    error: (message: string) => errors.push(message),
    info: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    append: () => undefined,
    appendLine: () => undefined,
  } as unknown as vscode.LogOutputChannel;
  return { channel, errors };
}

const fileMember: ContentItem = {
  id: "m1",
  name: "model.py",
  type: "child",
  contentType: "file",
  uri: "/files/files/m1",
  parentFolderUri: "/folders/folders/src",
  links: [
    { rel: "self", href: "/folders/folders/src/members/m1", method: "GET" },
  ],
};

const targetFolder: ContentItem = {
  id: "dest",
  name: "Destination",
  type: "child",
  contentType: "folder",
  uri: "/folders/folders/dest",
  links: [
    { rel: "self", href: "/folders/folders/dest/members/dest", method: "GET" },
  ],
};

type MoveItem = ContentAdapter["moveItem"];

interface Harness {
  controller: SasContentDragAndDropController;
  state: { refreshed: number };
  errors: string[];
}

function controllerWith(moveItem: MoveItem): Harness {
  const { channel, errors } = fakeLog();
  const state = { refreshed: 0 };
  const controller = new SasContentDragAndDropController({
    adapter: () => ({ moveItem }) as unknown as ContentAdapter,
    refresh: () => {
      state.refreshed += 1;
    },
    log: channel,
    viewId: CONTENT_VIEW_ID,
  });
  return { controller, state, errors };
}

const notCalled: MoveItem = () => {
  throw new Error("moveItem should not be called");
};

function droppedInto(target: ContentItem | undefined, holder: Harness) {
  const transfer = new vscode.DataTransfer();
  transfer.set(MIME, new vscode.DataTransferItem([fileMember]));
  const tokenSource = new vscode.CancellationTokenSource();
  return holder.controller
    .handleDrop(target, transfer, tokenSource.token)
    .finally(() => {
      tokenSource.dispose();
    });
}

describe("SAS Content drag-and-drop move", () => {
  it("handleDrag puts only draggable items on the transfer", () => {
    const { controller } = controllerWith(notCalled);
    const transfer = new vscode.DataTransfer();
    const rootListingFolder: ContentItem = {
      id: "top",
      name: "Top",
      type: "folder",
      links: [],
    };

    controller.handleDrag([fileMember, rootListingFolder], transfer);

    const payload = transfer.get(MIME)?.value as ContentItem[] | undefined;
    assert.ok(payload);
    assert.deepEqual(
      payload.map((i) => i.id),
      ["m1"],
    );
  });

  it("handleDrag sets nothing when no dragged item is draggable", () => {
    const { controller } = controllerWith(notCalled);
    const transfer = new vscode.DataTransfer();
    controller.handleDrag(
      [{ id: "t", name: "Top", type: "folder", links: [] }],
      transfer,
    );
    assert.equal(transfer.get(MIME), undefined);
  });

  it("handleDrop moves the dragged member into the target folder, then refreshes", async () => {
    const moves: { id: string; dest: string }[] = [];
    const holder = controllerWith((item, dest) => {
      moves.push({ id: item.id, dest });
      return Promise.resolve({
        ok: true,
        value: { ...item, parentFolderUri: dest },
      } as ContentResult<ContentItem>);
    });

    await droppedInto(targetFolder, holder);

    assert.deepEqual(moves, [{ id: "m1", dest: "/folders/folders/dest" }]);
    assert.equal(holder.state.refreshed, 1);
    assert.equal(holder.errors.length, 0);
  });

  it("handleDrop skips a drop that is not a move and never calls the adapter", async () => {
    const holder = controllerWith(notCalled);
    // Target is a file — moveObjection → "target-not-a-folder".
    await droppedInto(fileMember, holder);
    assert.equal(holder.state.refreshed, 0);
  });

  it("handleDrop surfaces a move failure and still refreshes", async () => {
    const holder = controllerWith(() =>
      Promise.resolve({
        ok: false,
        reason: "rejected",
        problem: {
          code: "content-rejected",
          error: {
            status: 400,
            detail: "A folder cannot be moved or copied into itself.",
          },
        },
      } as ContentResult<ContentItem>),
    );

    await droppedInto(targetFolder, holder);

    assert.equal(holder.state.refreshed, 1);
    assert.equal(holder.errors.length, 1);
  });

  it("handleDrop does nothing when dropped on empty space", async () => {
    const holder = controllerWith(notCalled);
    await droppedInto(undefined, holder);
    assert.equal(holder.state.refreshed, 0);
  });

  it("handleDrop skips a recycled item and never calls the adapter", async () => {
    const holder = controllerWith(notCalled);
    const transfer = new vscode.DataTransfer();
    transfer.set(
      MIME,
      new vscode.DataTransferItem([{ ...fileMember, inRecycleBin: true }]),
    );
    const tokenSource = new vscode.CancellationTokenSource();
    await holder.controller.handleDrop(
      targetFolder,
      transfer,
      tokenSource.token,
    );
    assert.equal(holder.state.refreshed, 0);
    tokenSource.dispose();
  });
});
