// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  CONTEXT_FILE,
  CONTEXT_FOLDER,
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

  it("presents a root-listing folder as an expandable folder", () => {
    const p = nodePresentationOf(item({ name: "Products", type: "folder" }));
    assert.deepEqual(p, {
      label: "Products",
      expandable: true,
      openable: false,
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
      icon: "file",
      contextValue: CONTEXT_FILE,
    });
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
