// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { ContentAdapter } from "../../src/content/adapter";
import {
  isSasContentRoot,
  SAS_CONTENT_ROOT,
  type ContentItem,
} from "../../src/content/types";
import {
  contentFail,
  contentFixture,
  contentOk,
  recordedContentClient,
  type RecordedContentRoute,
} from "../helpers/recorded-content";

/**
 * The real `ContentAdapter` against recorded Folders/Files wire shapes
 * (findings 83–85, `verde`, 2026-09-09). The adapter is `vscode`-free, so this
 * is a plain unit test; the HTTP boundary is the fake `ContentClient`.
 */

const MY_FOLDER = "/folders/folders/aaaaaaaa-0000-4000-8000-000000000001";

function adapterWith(routes: readonly RecordedContentRoute[]): {
  adapter: ContentAdapter;
  calls: { href: string; method: string }[];
} {
  const { client, calls } = recordedContentClient(routes);
  return { adapter: new ContentAdapter(client), calls };
}

const delegateRoutes: readonly RecordedContentRoute[] = [
  {
    when: "/folders/folders/@myFavorites",
    reply: contentFixture("delegate-favorites.json"),
  },
  {
    when: "/folders/folders/@myFolder",
    reply: contentFixture("delegate-my-folder.json"),
  },
  {
    when: "/folders/folders/@myRecycleBin",
    reply: contentFixture("delegate-recycle-bin.json"),
  },
];

describe("content/adapter", () => {
  describe("getRootItems", () => {
    it("returns the four top-level folders in display order, root synthesised", async () => {
      const { adapter, calls } = adapterWith(delegateRoutes);
      const result = await adapter.getRootItems();
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((i) => i.name),
        ["My Favorites", "My Folder", "SAS Content", "Recycle Bin"],
      );
      const third = result.value[2];
      assert.ok(third && isSasContentRoot(third));
      // No request for @sasRoot — it is synthetic.
      assert.deepEqual(calls.map((c) => c.href).sort(), [
        "/folders/folders/@myFavorites",
        "/folders/folders/@myFolder",
        "/folders/folders/@myRecycleBin",
      ]);
    });

    it("still returns the readable delegates when one is forbidden", async () => {
      const { adapter } = adapterWith([
        {
          when: "/folders/folders/@myFavorites",
          reply: contentFail({ code: "forbidden", error: { status: 403 } }),
        },
        {
          when: "/folders/folders/@myFolder",
          reply: contentFixture("delegate-my-folder.json"),
        },
        {
          when: "/folders/folders/@myRecycleBin",
          reply: contentFixture("delegate-recycle-bin.json"),
        },
      ]);
      const result = await adapter.getRootItems();
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((i) => i.name),
        ["My Folder", "SAS Content", "Recycle Bin"],
      );
    });

    it("propagates the first failure when every delegate fetch fails", async () => {
      const fail = contentFail({
        code: "content-rejected",
        error: { status: 500 },
      });
      const { adapter } = adapterWith([{ when: /@my/, reply: fail }]);
      const result = await adapter.getRootItems();
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "content-rejected");
    });

    it("skips a delegate whose body is not a folder representation", async () => {
      const { adapter } = adapterWith([
        {
          when: "/folders/folders/@myFavorites",
          reply: contentOk({ not: "a folder" }),
        },
        {
          when: "/folders/folders/@myFolder",
          reply: contentFixture("delegate-my-folder.json"),
        },
        {
          when: "/folders/folders/@myRecycleBin",
          reply: contentFixture("delegate-recycle-bin.json"),
        },
      ]);
      const result = await adapter.getRootItems();
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((i) => i.name),
        ["My Folder", "SAS Content", "Recycle Bin"],
      );
    });

    it("reports response-malformed when no delegate body is a folder", async () => {
      const { adapter } = adapterWith([
        { when: /@my/, reply: contentOk({ not: "a folder" }) },
      ]);
      const result = await adapter.getRootItems();
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "response-malformed");
    });
  });

  describe("getChildItems", () => {
    it("expands the SAS Content root with an isNull(parent) query", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: "/folders/folders",
          reply: contentFixture("root-listing.json"),
        },
      ]);
      const result = await adapter.getChildItems(SAS_CONTENT_ROOT);
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((i) => i.name),
        ["Products", "Public", "Users"],
      );
      assert.match(
        calls[0]?.href ?? "",
        /filter=and\(isNull\(parent\),in\(type,/,
      );
      assert.match(calls[0]?.href ?? "", /limit=1000000/);
    });

    it("follows a folder's members link and sorts folders first, then by name", async () => {
      const { adapter, calls } = adapterWith([
        ...delegateRoutes,
        {
          when: `${MY_FOLDER}/members`,
          reply: contentFixture("my-folder-members.json"),
        },
      ]);
      const roots = await adapter.getRootItems();
      assert.ok(roots.ok);
      const myFolder = roots.value.find((i) => i.name === "My Folder");
      assert.ok(myFolder);

      const result = await adapter.getChildItems(myFolder);
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.map((i) => i.name),
        ["archive", "reports", "analysis.py", "notes.sas"],
      );
      const memberCall = calls.find((c) => c.href.includes("/members"));
      assert.match(
        memberCall?.href ?? "",
        /\?limit=1000000&filter=in\(contentType,/,
      );
    });

    it("composes {uri}/members for a folder member that carries no members link", async () => {
      const { adapter } = adapterWith([
        ...delegateRoutes,
        {
          when: `${MY_FOLDER}/members`,
          reply: contentFixture("my-folder-members.json"),
        },
        {
          when: "/folders/folders/cccccccc-0000-4000-8000-000000000001/members",
          reply: contentFixture("child-folder-members.json"),
        },
      ]);
      const roots = await adapter.getRootItems();
      assert.ok(roots.ok);
      const myFolder = roots.value.find((i) => i.name === "My Folder");
      assert.ok(myFolder);
      const children = await adapter.getChildItems(myFolder);
      assert.ok(children.ok);
      const reports = children.value.find((i) => i.name === "reports");
      assert.ok(reports);
      assert.equal(
        reports.links.some((l) => l.rel === "members"),
        false,
      );

      const grandchildren = await adapter.getChildItems(reports);
      assert.ok(grandchildren.ok);
      assert.deepEqual(
        grandchildren.value.map((i) => i.name),
        ["readme.txt", "summary.py"],
      );
    });

    it("reports link-missing when a folder offers no way to reach its members", async () => {
      const { adapter } = adapterWith([]);
      const orphan: ContentItem = {
        id: "o",
        name: "orphan",
        type: "folder",
        links: [],
      };
      const result = await adapter.getChildItems(orphan);
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "link-missing");
      assert.equal(result.problem.rel, "members");
    });

    it("reports response-malformed when the listing has no items array", async () => {
      const { adapter } = adapterWith([
        {
          when: "/folders/folders",
          reply: contentOk({ version: 2, count: 0 }),
        },
      ]);
      const result = await adapter.getChildItems(SAS_CONTENT_ROOT);
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "response-malformed");
    });

    it("passes a client failure straight through", async () => {
      const { adapter } = adapterWith([
        {
          when: "/folders/folders",
          reply: contentFail({
            code: "content-rejected",
            error: { status: 404 },
          }),
        },
      ]);
      const result = await adapter.getChildItems(SAS_CONTENT_ROOT);
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "content-rejected");
    });
  });
});
