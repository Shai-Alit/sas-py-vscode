// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { moveObjection } from "../../src/content/contentMove";
import { SAS_CONTENT_ROOT, type ContentItem } from "../../src/content/types";

/**
 * `moveObjection` — the drag-and-drop guard (6c-ii). It settles the drops that
 * are wrong on their face; a folder dropped into its own descendant is left to
 * the server's `400` (finding 6.10) and is not exercised here.
 */

function member(overrides: Partial<ContentItem>): ContentItem {
  return {
    id: "m",
    name: "thing",
    type: "child",
    contentType: "file",
    uri: "/files/files/thing",
    links: [],
    ...overrides,
  };
}

function folder(
  href: string,
  overrides: Partial<ContentItem> = {},
): ContentItem {
  return {
    id: href,
    name: "dest",
    type: "child",
    contentType: "folder",
    uri: href,
    links: [],
    ...overrides,
  };
}

describe("content/contentMove moveObjection", () => {
  it("allows a file member dropped onto an ordinary folder", () => {
    assert.equal(
      moveObjection(
        member({ uri: "/files/files/a" }),
        folder("/folders/folders/dest"),
      ),
      undefined,
    );
  });

  it("allows a folder member dropped onto another folder", () => {
    assert.equal(
      moveObjection(
        member({ contentType: "folder", uri: "/folders/folders/src" }),
        folder("/folders/folders/dest"),
      ),
      undefined,
    );
  });

  it("allows a drop onto the My Folder delegate", () => {
    const myFolder: ContentItem = {
      id: "@myFolder",
      name: "My Folder",
      type: "myFolder",
      links: [{ rel: "self", href: "/folders/folders/mine" }],
    };
    assert.equal(
      moveObjection(member({ uri: "/files/files/a" }), myFolder),
      undefined,
    );
  });

  it("rejects dragging something that is not a member", () => {
    const rootListingFolder: ContentItem = {
      id: "top",
      name: "Products",
      type: "folder",
      links: [{ rel: "self", href: "/folders/folders/top" }],
    };
    assert.equal(
      moveObjection(rootListingFolder, folder("/folders/folders/dest")),
      "not-a-member",
    );
  });

  it("rejects a drop onto a file", () => {
    assert.equal(
      moveObjection(
        member({ uri: "/files/files/a" }),
        member({ id: "leaf", uri: "/files/files/leaf" }),
      ),
      "target-not-a-folder",
    );
  });

  it("rejects a drop onto the synthetic SAS Content root", () => {
    assert.equal(
      moveObjection(member({ uri: "/files/files/a" }), SAS_CONTENT_ROOT),
      "target-not-a-folder",
    );
  });

  it("rejects dragging a recycled item out of the Recycle Bin (a restore is 6d's)", () => {
    assert.equal(
      moveObjection(
        member({ uri: "/folders/folders/recycled", inRecycleBin: true }),
        folder("/folders/folders/dest"),
      ),
      "in-recycle-bin",
    );
  });

  it("rejects a drop into a recycled folder", () => {
    assert.equal(
      moveObjection(
        member({ uri: "/files/files/a" }),
        folder("/folders/folders/recycled", { inRecycleBin: true }),
      ),
      "in-recycle-bin",
    );
  });

  it("rejects a drop onto the Favorites / Recycle Bin delegates (6d, not a move)", () => {
    for (const type of ["favoritesFolder", "trashFolder"]) {
      const delegate: ContentItem = {
        id: type,
        name: type,
        type,
        links: [{ rel: "self", href: `/folders/folders/${type}` }],
      };
      assert.equal(
        moveObjection(member({ uri: "/files/files/a" }), delegate),
        "target-not-a-folder",
      );
    }
  });

  it("rejects dropping an item onto itself", () => {
    const f = member({ contentType: "folder", uri: "/folders/folders/same" });
    assert.equal(
      moveObjection(f, folder("/folders/folders/same")),
      "into-itself",
    );
  });

  it("rejects a no-op drop onto the current parent, read from parentFolderUri", () => {
    assert.equal(
      moveObjection(
        member({
          uri: "/files/files/a",
          parentFolderUri: "/folders/folders/home",
        }),
        folder("/folders/folders/home"),
      ),
      "already-there",
    );
  });

  it("falls back to the up link for the current parent when parentFolderUri is absent", () => {
    assert.equal(
      moveObjection(
        member({
          uri: "/files/files/a",
          links: [{ rel: "up", href: "/folders/folders/home" }],
        }),
        folder("/folders/folders/home"),
      ),
      "already-there",
    );
  });

  it("allows the move when the current parent differs from the target", () => {
    assert.equal(
      moveObjection(
        member({
          uri: "/files/files/a",
          parentFolderUri: "/folders/folders/home",
        }),
        folder("/folders/folders/elsewhere"),
      ),
      undefined,
    );
  });
});
