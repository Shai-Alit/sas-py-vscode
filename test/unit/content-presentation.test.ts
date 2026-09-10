// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  CONTEXT_DELEGATE,
  CONTEXT_FILE,
  CONTEXT_FOLDER,
  CONTEXT_MY_FOLDER,
  CONTEXT_ROOT,
  nodePresentationOf,
} from "../../src/content/presentation";
import { SAS_CONTENT_ROOT, type ContentItem } from "../../src/content/types";

/**
 * How `contentTree.ts` renders each of the three item shapes (findings 97–99):
 * a delegate folder, a root-listing folder, and a member record whose
 * `contentType` — not its `"child"` type — decides whether it expands.
 */

function item(overrides: Partial<ContentItem>): ContentItem {
  return { id: "id", name: "name", links: [], ...overrides };
}

describe("content/presentation nodePresentationOf", () => {
  it("presents the synthetic SAS Content root", () => {
    assert.deepEqual(nodePresentationOf(SAS_CONTENT_ROOT), {
      label: "SAS Content",
      expandable: true,
      openable: false,
      draggable: false,
      icon: "root-folder",
      contextValue: CONTEXT_ROOT,
    });
  });

  it("gives each delegate folder its own icon", () => {
    assert.equal(
      nodePresentationOf(item({ type: "favoritesFolder" })).icon,
      "star-full",
    );
    assert.equal(
      nodePresentationOf(item({ type: "trashFolder" })).icon,
      "trash",
    );
    assert.equal(
      nodePresentationOf(item({ type: "myFolder" })).icon,
      "folder-active",
    );
  });

  it("gives the delegates a contextValue that gates the mutation menu", () => {
    // My Folder: create inside it, but no rename/delete.
    assert.equal(
      nodePresentationOf(item({ type: "myFolder" })).contextValue,
      CONTEXT_MY_FOLDER,
    );
    // Favorites / Recycle Bin: none of create/rename/delete.
    assert.equal(
      nodePresentationOf(item({ type: "favoritesFolder" })).contextValue,
      CONTEXT_DELEGATE,
    );
    assert.equal(
      nodePresentationOf(item({ type: "trashFolder" })).contextValue,
      CONTEXT_DELEGATE,
    );
  });

  it("presents a root-listing folder as an expandable folder", () => {
    const p = nodePresentationOf(item({ name: "Products", type: "folder" }));
    assert.deepEqual(p, {
      label: "Products",
      expandable: true,
      openable: false,
      draggable: false,
      icon: "folder",
      contextValue: CONTEXT_FOLDER,
    });
  });

  it("presents a folder member from its contentType, not its child type", () => {
    const p = nodePresentationOf(
      item({ name: "reports", type: "child", contentType: "folder" }),
    );
    assert.equal(p.expandable, true);
    assert.equal(p.icon, "folder");
    assert.equal(p.contextValue, CONTEXT_FOLDER);
  });

  it("presents a file member as a non-expandable, openable leaf", () => {
    const p = nodePresentationOf(
      item({ name: "analysis.py", type: "child", contentType: "file" }),
    );
    assert.deepEqual(p, {
      label: "analysis.py",
      expandable: false,
      openable: true,
      draggable: true,
      icon: "file",
      contextValue: CONTEXT_FILE,
    });
  });

  it("marks only member records draggable (6c-ii)", () => {
    // Every `type: "child"` member — folder or file — can be picked up.
    assert.equal(
      nodePresentationOf(item({ type: "child", contentType: "folder" }))
        .draggable,
      true,
    );
    assert.equal(
      nodePresentationOf(item({ type: "child", contentType: "file" }))
        .draggable,
      true,
    );
    // A delegate, a top-level root-listing folder, and the synthetic root have
    // no member record to re-parent.
    assert.equal(
      nodePresentationOf(item({ type: "myFolder" })).draggable,
      false,
    );
    assert.equal(
      nodePresentationOf(item({ type: "favoritesFolder" })).draggable,
      false,
    );
    assert.equal(nodePresentationOf(item({ type: "folder" })).draggable, false);
    assert.equal(nodePresentationOf(SAS_CONTENT_ROOT).draggable, false);
    // A recycled member's drag would be a restore — 6d's, not 6c-ii's.
    assert.equal(
      nodePresentationOf(
        item({ type: "child", contentType: "folder", inRecycleBin: true }),
      ).draggable,
      false,
    );
  });

  it("does not mark a folder or a dataFlow leaf openable", () => {
    assert.equal(
      nodePresentationOf(item({ type: "child", contentType: "folder" }))
        .openable,
      false,
    );
    assert.equal(
      nodePresentationOf(item({ type: "child", contentType: "dataFlow" }))
        .openable,
      false,
    );
    assert.equal(nodePresentationOf(item({ type: "folder" })).openable, false);
  });
});
