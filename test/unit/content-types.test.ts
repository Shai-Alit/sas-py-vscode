// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  DELEGATE_FOLDERS,
  isContainer,
  isSasContentRoot,
  memberTypeFilter,
  readContentItem,
  resourceHrefOf,
  sameResource,
  SAS_CONTENT_ROOT,
  typeNameOf,
  type ContentItem,
} from "../../src/content/types";
import { readJsonFixture } from "../helpers/fixtures";

/**
 * The SAS Content vocabulary — grounded in findings 97–99 (`verde`,
 * 2026-09-09): a delegate folder's `type` is `myFolder`/`favoritesFolder`/
 * `trashFolder`; a root-listing folder's is `folder` with no `uri`/
 * `contentType`; a member's is always `"child"` and `contentType` carries the
 * real kind.
 */

function item(overrides: Partial<ContentItem>): ContentItem {
  return { id: "id", name: "name", links: [], ...overrides };
}

describe("content/types", () => {
  describe("typeNameOf / isContainer", () => {
    it("reads a member's kind from contentType, not its 'child' type", () => {
      const folderMember = item({ type: "child", contentType: "folder" });
      const fileMember = item({ type: "child", contentType: "file" });
      assert.equal(typeNameOf(folderMember), "folder");
      assert.equal(typeNameOf(fileMember), "file");
      assert.equal(isContainer(folderMember), true);
      assert.equal(isContainer(fileMember), false);
    });

    it("treats every folder-shaped type read directly as a container", () => {
      for (const type of [
        "folder",
        "myFolder",
        "favoritesFolder",
        "trashFolder",
        "userFolder",
        "userRoot",
      ]) {
        assert.equal(isContainer(item({ type })), true, type);
      }
    });

    it("treats the synthetic SAS Content root as a container", () => {
      assert.equal(isContainer(SAS_CONTENT_ROOT), true);
      assert.equal(isSasContentRoot(SAS_CONTENT_ROOT), true);
    });

    it("does not treat a bare file or an unknown type as a container", () => {
      assert.equal(
        isContainer(item({ type: "child", contentType: "file" })),
        false,
      );
      assert.equal(isContainer(item({ type: "reference" })), false);
      assert.equal(isContainer(item({})), false);
    });

    it("only recognises the real synthetic root, not any RootFolder-typed item", () => {
      assert.equal(
        isSasContentRoot(item({ type: "RootFolder", id: "something-else" })),
        false,
      );
    });
  });

  describe("readContentItem", () => {
    it("keeps id, name, and the optional service fields when present", () => {
      const parsed = readContentItem({
        id: "abc",
        name: "reports",
        type: "child",
        contentType: "folder",
        uri: "/folders/folders/abc",
        memberCount: 3,
        links: [
          {
            method: "GET",
            rel: "self",
            href: "/folders/folders/p/members/abc",
            uri: "/folders/folders/p/members/abc",
            type: "application/vnd.sas.content.folder.member",
          },
        ],
      });
      assert.deepEqual(parsed, {
        id: "abc",
        name: "reports",
        type: "child",
        contentType: "folder",
        uri: "/folders/folders/abc",
        memberCount: 3,
        links: [
          {
            rel: "self",
            href: "/folders/folders/p/members/abc",
            method: "GET",
            type: "application/vnd.sas.content.folder.member",
          },
        ],
      });
    });

    it("omits absent optional fields rather than carrying undefined", () => {
      const parsed = readContentItem({ id: "x", name: "y" });
      assert.deepEqual(parsed, { id: "x", name: "y", links: [] });
    });

    it("drops an entry with no usable id or name", () => {
      assert.equal(readContentItem({ name: "no id" }), undefined);
      assert.equal(readContentItem({ id: "", name: "empty id" }), undefined);
      assert.equal(readContentItem({ id: "ok", name: "" }), undefined);
      assert.equal(readContentItem("not an object"), undefined);
      assert.equal(readContentItem(null), undefined);
    });

    it("reads a real root-listing item — no uri, no contentType (finding 98)", () => {
      const listing = readJsonFixture("content", "root-listing.json") as {
        items: unknown[];
      };
      const first = readContentItem(listing.items[0]);
      assert.ok(first);
      assert.equal(first.type, "folder");
      assert.equal(first.uri, undefined);
      assert.equal(first.contentType, undefined);
      assert.ok(first.links.some((link) => link.rel === "self"));
    });
  });

  describe("resourceHrefOf", () => {
    it("prefers the stated uri", () => {
      assert.equal(
        resourceHrefOf(item({ uri: "/files/files/1", links: [] })),
        "/files/files/1",
      );
    });

    it("falls back to the self link when there is no uri (finding 98)", () => {
      assert.equal(
        resourceHrefOf(
          item({
            links: [{ rel: "self", href: "/folders/folders/2" }],
          }),
        ),
        "/folders/folders/2",
      );
    });

    it("is undefined when neither is available", () => {
      assert.equal(resourceHrefOf(item({ links: [] })), undefined);
      assert.equal(resourceHrefOf(item({ uri: "", links: [] })), undefined);
    });
  });

  describe("sameResource", () => {
    it("matches a create response's folder self link to the member listing's uri", () => {
      // A folder create returns the folder's own representation (folder id,
      // address in the self link); the listing renders it as a member (member
      // id, address in `uri`). Both name /folders/folders/new.
      const created = item({
        id: "folder-own-id",
        links: [{ rel: "self", href: "/folders/folders/new" }],
      });
      const listed = [
        item({ id: "member-a", uri: "/folders/folders/other", links: [] }),
        item({ id: "member-b", uri: "/folders/folders/new", links: [] }),
      ];
      assert.equal(sameResource(created, listed)?.id, "member-b");
    });

    it("matches a file member by its uri", () => {
      const created = item({ id: "m1", uri: "/files/files/x", links: [] });
      const listed = [item({ id: "m1", uri: "/files/files/x", links: [] })];
      assert.equal(sameResource(created, listed)?.id, "m1");
    });

    it("is undefined when the target has no resolvable href", () => {
      assert.equal(
        sameResource(item({ links: [] }), [item({ links: [] })]),
        undefined,
      );
    });

    it("is undefined when nothing in the list shares the resource", () => {
      const created = item({ uri: "/files/files/x", links: [] });
      const listed = [item({ uri: "/files/files/y", links: [] })];
      assert.equal(sameResource(created, listed), undefined);
    });
  });

  describe("memberTypeFilter", () => {
    it("keys the root query on 'type' and a folder's members on 'contentType'", () => {
      assert.match(memberTypeFilter("type"), /^in\(type,'file','dataFlow',/);
      assert.match(
        memberTypeFilter("contentType"),
        /^in\(contentType,'file','dataFlow',/,
      );
      assert.ok(memberTypeFilter("type").includes("'folder'"));
    });
  });

  it("lists the four delegate folders in display order", () => {
    assert.deepEqual(DELEGATE_FOLDERS, [
      "@myFavorites",
      "@myFolder",
      "@sasRoot",
      "@myRecycleBin",
    ]);
  });
});
