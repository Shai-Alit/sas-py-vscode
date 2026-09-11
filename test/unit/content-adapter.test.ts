// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  ContentAdapter,
  MAX_FILE_CONTENT_BYTES,
} from "../../src/content/adapter";
import { type ContentRequest } from "../../src/content/client";
import {
  isContainer,
  isSasContentRoot,
  readContentItem,
  SAS_CONTENT_ROOT,
  typeNameOf,
  type ContentItem,
} from "../../src/content/types";
import { readJsonFixture } from "../helpers/fixtures";
import {
  contentBytes,
  contentFail,
  contentFixture,
  contentNoBody,
  contentOk,
  recordedContentClient,
  type RecordedContentRoute,
} from "../helpers/recorded-content";

/**
 * The real `ContentAdapter` against recorded Folders/Files wire shapes
 * (findings 97–99, `verde`, 2026-09-09). The adapter is `vscode`-free, so this
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

    it("flags the Recycle Bin's direct children inRecycleBin, but not My Folder's (6c-ii)", async () => {
      const { adapter } = adapterWith([
        ...delegateRoutes,
        {
          when: `${MY_FOLDER}/members`,
          reply: contentFixture("my-folder-members.json"),
        },
        {
          when: "/folders/folders/aaaaaaaa-0000-4000-8000-000000000003/members",
          reply: contentFixture("my-folder-members.json"),
        },
      ]);
      const roots = await adapter.getRootItems();
      assert.ok(roots.ok);
      const recycleBin = roots.value.find((i) => i.name === "Recycle Bin");
      const myFolder = roots.value.find((i) => i.name === "My Folder");
      assert.ok(recycleBin && myFolder);

      const recycled = await adapter.getChildItems(recycleBin);
      assert.ok(recycled.ok);
      assert.ok(recycled.value.length > 0);
      assert.ok(recycled.value.every((c) => c.inRecycleBin === true));

      const mine = await adapter.getChildItems(myFolder);
      assert.ok(mine.ok);
      assert.ok(mine.value.every((c) => c.inRecycleBin === undefined));
    });

    it("propagates inRecycleBin into a recycled folder's own children too (PR #159 review)", async () => {
      // Not just the bin's direct children — descending into a recycled
      // *folder* must keep flagging every level, or a file two levels deep in
      // the bin reads as an ordinary editable item with no Restore action.
      const { adapter } = adapterWith([
        ...delegateRoutes,
        {
          when: "/folders/folders/aaaaaaaa-0000-4000-8000-000000000003/members",
          reply: contentFixture("recycle-bin-members.json"),
        },
        {
          when: "/folders/folders/eeee5555-0000-4000-8000-000000000c01/members",
          reply: contentFixture("my-folder-members.json"),
        },
      ]);
      const roots = await adapter.getRootItems();
      assert.ok(roots.ok);
      const recycleBin = roots.value.find((i) => i.name === "Recycle Bin");
      assert.ok(recycleBin);

      const recycled = await adapter.getChildItems(recycleBin);
      assert.ok(recycled.ok);
      const recycledFolder = recycled.value.find(
        (c) => c.name === "old-experiments",
      );
      assert.ok(recycledFolder?.inRecycleBin === true);

      const grandchildren = await adapter.getChildItems(recycledFolder);
      assert.ok(grandchildren.ok);
      assert.ok(grandchildren.value.length > 0);
      assert.ok(grandchildren.value.every((c) => c.inRecycleBin === true));
    });

    describe("markFavorites (6d-i)", () => {
      const FAV_MEMBERS = "/folders/folders/@myFavorites/members";
      const FAV_RECORD =
        "/folders/folders/aaaaaaaa-0000-4000-8000-000000000002/members/eeeeeeee-0000-4000-8000-0000000000f1";

      it("stamps isInMyFavorites + favoriteUri on a child referenced from My Favorites", async () => {
        const { adapter, calls } = adapterWith([
          ...delegateRoutes,
          {
            when: `${MY_FOLDER}/members`,
            reply: contentFixture("my-folder-members.json"),
          },
          {
            when: FAV_MEMBERS,
            reply: contentFixture("favorites-members.json"),
          },
        ]);
        const roots = await adapter.getRootItems();
        assert.ok(roots.ok);
        const myFolder = roots.value.find((i) => i.name === "My Folder");
        assert.ok(myFolder);

        const result = await adapter.getChildItems(myFolder, undefined, {
          markFavorites: true,
        });
        assert.ok(result.ok);
        const analysis = result.value.find((i) => i.name === "analysis.py");
        assert.ok(analysis);
        assert.equal(analysis.isInMyFavorites, true);
        assert.equal(analysis.favoriteUri, FAV_RECORD);
        // Every other child is left unmarked.
        for (const other of result.value.filter((i) => i !== analysis)) {
          assert.equal(other.isInMyFavorites, undefined);
          assert.equal(other.favoriteUri, undefined);
        }
        // The favourites listing was filtered to the tree's member types.
        const favCall = calls.find((c) => c.href.startsWith(FAV_MEMBERS));
        assert.match(favCall?.href ?? "", /filter=in\(contentType,/);
      });

      it("leaves every child unmarked when the favourites lookup fails", async () => {
        const { adapter } = adapterWith([
          ...delegateRoutes,
          {
            when: `${MY_FOLDER}/members`,
            reply: contentFixture("my-folder-members.json"),
          },
          {
            when: FAV_MEMBERS,
            reply: contentFail({
              code: "content-rejected",
              error: { status: 500 },
            }),
          },
        ]);
        const roots = await adapter.getRootItems();
        assert.ok(roots.ok);
        const myFolder = roots.value.find((i) => i.name === "My Folder");
        assert.ok(myFolder);

        const result = await adapter.getChildItems(myFolder, undefined, {
          markFavorites: true,
        });
        assert.ok(result.ok); // the listing itself still succeeds
        assert.ok(result.value.every((i) => i.isInMyFavorites === undefined));
      });

      it("does not fetch the favourites listing unless asked", async () => {
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
        await adapter.getChildItems(myFolder); // no opts
        assert.equal(
          calls.some((c) => c.href.startsWith(FAV_MEMBERS)),
          false,
        );
      });

      it("marks every child of My Favorites itself, keyed on its delete link", async () => {
        const { adapter } = adapterWith([
          ...delegateRoutes,
          {
            when: "/folders/folders/aaaaaaaa-0000-4000-8000-000000000002/members",
            reply: contentFixture("favorites-members.json"),
          },
        ]);
        const roots = await adapter.getRootItems();
        assert.ok(roots.ok);
        const favorites = roots.value.find((i) => i.name === "My Favorites");
        assert.ok(favorites);

        const result = await adapter.getChildItems(favorites, undefined, {
          markFavorites: true,
        });
        assert.ok(result.ok);
        assert.ok(result.value.length > 0);
        assert.ok(result.value.every((c) => c.isInMyFavorites === true));

        // The wire type of a favourite is `"reference"`, not `"child"`; the real
        // kind is still in `contentType`, so a favourited folder browsed here
        // stays navigable and a favourited file stays openable — and the record
        // to remove is the child's own `delete` link, not `deleteResource`.
        const folder = result.value.find((c) => c.name === "reports");
        const file = result.value.find((c) => c.name === "analysis.py");
        assert.ok(folder && file);
        assert.equal(file.favoriteUri, FAV_RECORD);
        assert.equal(folder.type, "reference");
        assert.equal(isContainer(folder), true);
        assert.equal(typeNameOf(file), "file");
        assert.equal(isContainer(file), false);
      });

      it("falls back to the self link for a favourite child with no delete link", async () => {
        const { adapter } = adapterWith([
          ...delegateRoutes,
          {
            when: "/folders/folders/aaaaaaaa-0000-4000-8000-000000000002/members",
            reply: contentOk({
              version: 2,
              count: 1,
              items: [
                {
                  id: "ref-only-self",
                  name: "pinned.py",
                  type: "reference",
                  contentType: "file",
                  uri: "/files/files/self-only",
                  links: [
                    {
                      method: "GET",
                      rel: "self",
                      href: "/folders/folders/fav/members/ref-only-self",
                    },
                  ],
                },
              ],
            }),
          },
        ]);
        const roots = await adapter.getRootItems();
        assert.ok(roots.ok);
        const favorites = roots.value.find((i) => i.name === "My Favorites");
        assert.ok(favorites);
        const result = await adapter.getChildItems(favorites, undefined, {
          markFavorites: true,
        });
        assert.ok(result.ok);
        assert.equal(
          result.value[0]?.favoriteUri,
          "/folders/folders/fav/members/ref-only-self",
        );
      });
    });
  });

  describe("getParentOfItem (finding 6.12)", () => {
    const ANCESTORS =
      "/folders/ancestors?childUri=/files/files/cccccccc-0000-4000-8000-0000000000a1";

    /** A member record carrying the `ancestors` link the adapter follows. */
    function memberWithAncestors(): ContentItem {
      return {
        id: "member-1",
        name: "analysis.py",
        type: "child",
        contentType: "file",
        uri: "/files/files/cccccccc-0000-4000-8000-0000000000a1",
        links: [
          {
            rel: "ancestors",
            href: ANCESTORS,
            method: "GET",
            type: "application/vnd.sas.content.folder.ancestor",
          },
        ],
      };
    }

    it("follows the ancestors link and returns the immediate parent", async () => {
      const { adapter, calls } = adapterWith([
        { when: ANCESTORS, reply: contentFixture("ancestors-my-folder.json") },
      ]);
      const result = await adapter.getParentOfItem(memberWithAncestors());
      assert.ok(result.ok);
      assert.ok(result.value);
      // ancestors[0] — My Folder, carrying its own folder id (not the member's).
      assert.equal(result.value.id, "aaaaaaaa-0000-4000-8000-000000000001");
      assert.equal(result.value.name, "My Folder");
      assert.equal(result.value.type, "myFolder");
      assert.deepEqual(
        calls.map((c) => `${c.method} ${c.href}`),
        [`GET ${ANCESTORS}`],
      );
    });

    it("returns undefined, with no request, when the item has no ancestors link", async () => {
      const { adapter, calls } = adapterWith([]);
      const result = await adapter.getParentOfItem({
        id: "x",
        name: "x",
        type: "folder",
        links: [{ rel: "self", href: "/folders/folders/x", method: "GET" }],
      });
      assert.ok(result.ok);
      assert.equal(result.value, undefined);
      assert.equal(calls.length, 0);
    });

    it("returns undefined for an empty ancestors array (a folder under the root)", async () => {
      const { adapter } = adapterWith([
        {
          when: ANCESTORS,
          reply: contentOk({
            childUri: "/folders/folders/top",
            ancestors: [],
            version: 1,
          }),
        },
      ]);
      const result = await adapter.getParentOfItem(memberWithAncestors());
      assert.ok(result.ok);
      assert.equal(result.value, undefined);
    });

    it("returns undefined for a 204 (an unknown childUri)", async () => {
      const { adapter } = adapterWith([
        { when: ANCESTORS, reply: contentNoBody() },
      ]);
      const result = await adapter.getParentOfItem(memberWithAncestors());
      assert.ok(result.ok);
      assert.equal(result.value, undefined);
    });

    it("reports response-malformed when the 200 body carries no ancestors array", async () => {
      const { adapter } = adapterWith([
        { when: ANCESTORS, reply: contentOk({ childUri: "x", version: 1 }) },
      ]);
      const result = await adapter.getParentOfItem(memberWithAncestors());
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "response-malformed");
    });

    it("reports response-malformed when the first ancestor is not a folder representation", async () => {
      const { adapter } = adapterWith([
        {
          when: ANCESTORS,
          reply: contentOk({ childUri: "x", ancestors: [{}], version: 1 }),
        },
      ]);
      const result = await adapter.getParentOfItem(memberWithAncestors());
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "response-malformed");
    });

    it("passes a transport failure straight through", async () => {
      const { adapter } = adapterWith([
        {
          when: ANCESTORS,
          reply: contentFail({ code: "content-unreachable", detail: "down" }),
        },
      ]);
      const result = await adapter.getParentOfItem(memberWithAncestors());
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "content-unreachable");
    });
  });

  describe("statFile / readFileContent / writeFileContent (findings 6.1/6.2)", () => {
    const FILE_RES = "/files/files/dddddddd-0000-4000-8000-000000000001";
    const CONTENT = `${FILE_RES}/content`;
    const fileRep = () => readJsonFixture("content", "file-python.json");
    const isGet = (href: string, method: string) =>
      href === CONTENT && method === "GET";
    const isPut = (href: string, method: string) =>
      href === CONTENT && method === "PUT";

    describe("statFile", () => {
      it("reads size and timestamps, preferring the Last-Modified header for mtime", async () => {
        const { adapter, calls } = adapterWith([
          {
            when: FILE_RES,
            reply: contentOk(fileRep(), {
              contentType: "application/vnd.sas.file+json;version=1",
              lastModified: "Wed, 07 Jan 2026 08:15:00 GMT",
            }),
          },
        ]);
        const result = await adapter.statFile(FILE_RES);
        assert.ok(result.ok);
        assert.equal(result.value.size, 42);
        assert.equal(
          result.value.createdAt,
          Date.parse("2026-01-05T12:00:00.000Z"),
        );
        assert.equal(
          result.value.modifiedAt,
          Date.parse("Wed, 07 Jan 2026 08:15:00 GMT"),
        );
        assert.deepEqual(calls, [{ href: FILE_RES, method: "GET" }]);
      });

      it("falls back to the body's modifiedTimeStamp when there is no header", async () => {
        const { adapter } = adapterWith([
          { when: FILE_RES, reply: contentOk(fileRep()) },
        ]);
        const result = await adapter.statFile(FILE_RES);
        assert.ok(result.ok);
        assert.equal(
          result.value.modifiedAt,
          Date.parse("2026-01-06T09:30:00.000Z"),
        );
      });

      it("returns size 0 and undefined timestamps when the body has none", async () => {
        const { adapter } = adapterWith([
          { when: FILE_RES, reply: contentOk({ id: "d", name: "x.py" }) },
        ]);
        const result = await adapter.statFile(FILE_RES);
        assert.ok(result.ok);
        assert.deepEqual(result.value, {
          size: 0,
          createdAt: undefined,
          modifiedAt: undefined,
        });
      });

      it("reports response-malformed when the body is not an object", async () => {
        const { adapter } = adapterWith([
          { when: FILE_RES, reply: contentOk("just a string") },
        ]);
        const result = await adapter.statFile(FILE_RES);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("passes a client failure straight through", async () => {
        const { adapter } = adapterWith([
          {
            when: FILE_RES,
            reply: contentFail({
              code: "content-rejected",
              error: { status: 404 },
            }),
          },
        ]);
        const result = await adapter.statFile(FILE_RES);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-rejected");
      });
    });

    describe("readFileContent", () => {
      it("composes {href}/content, returns the bytes, etag and content-type, raising the body cap", async () => {
        let seen: ContentRequest | undefined;
        const { adapter, calls } = adapterWith([
          {
            when: isGet,
            reply: (request) => {
              seen = request;
              return contentBytes("print('hi')\n", {
                etag: '"abc123"',
                contentType: "application/x-python;charset=UTF-8",
              });
            },
          },
        ]);
        const result = await adapter.readFileContent(FILE_RES);
        assert.ok(result.ok);
        assert.equal(
          new TextDecoder().decode(result.value.bytes),
          "print('hi')\n",
        );
        assert.equal(result.value.etag, '"abc123"');
        assert.equal(
          result.value.contentType,
          "application/x-python;charset=UTF-8",
        );
        assert.equal(seen?.maxBodyBytes, MAX_FILE_CONTENT_BYTES);
        assert.deepEqual(calls, [{ href: CONTENT, method: "GET" }]);
      });

      it("reports response-malformed when the transport returned no bytes", async () => {
        const { adapter } = adapterWith([
          { when: isGet, reply: contentOk({ unexpected: "json" }) },
        ]);
        const result = await adapter.readFileContent(FILE_RES);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("passes a client failure straight through", async () => {
        const { adapter } = adapterWith([
          {
            when: isGet,
            reply: contentFail({ code: "forbidden", error: { status: 403 } }),
          },
        ]);
        const result = await adapter.readFileContent(FILE_RES);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "forbidden");
      });
    });

    describe("writeFileContent", () => {
      it("PUTs the bytes with the caller's ETag as If-Match, and returns the server's fresh ETag", async () => {
        let put: ContentRequest | undefined;
        const { adapter, calls } = adapterWith([
          {
            when: isPut,
            reply: (request) => {
              put = request;
              return contentOk(fileRep(), {
                contentType: "application/vnd.sas.file+json;version=1",
                status: 200,
                etag: '"e2"',
              });
            },
          },
        ]);
        const bytes = new TextEncoder().encode("new content\n");
        const result = await adapter.writeFileContent(FILE_RES, bytes, {
          etag: '"e1"',
          contentType: "application/x-python;charset=UTF-8",
        });
        assert.ok(result.ok);
        assert.equal(result.value.etag, '"e2"');
        assert.ok(put !== undefined);
        assert.equal(put.etag, '"e1"');
        assert.equal(put.contentType, "application/x-python;charset=UTF-8");
        assert.deepEqual(put.rawBody, bytes);
        // No pre-read: the write path never re-fetches the ETag.
        assert.deepEqual(calls, [{ href: CONTENT, method: "PUT" }]);
      });

      it("defaults the content-type when the precondition has none", async () => {
        let put: ContentRequest | undefined;
        const { adapter } = adapterWith([
          {
            when: isPut,
            reply: (request) => {
              put = request;
              return contentOk(fileRep(), { status: 200 });
            },
          },
        ]);
        await adapter.writeFileContent(FILE_RES, new Uint8Array(), {
          etag: '"e1"',
          contentType: undefined,
        });
        assert.ok(put !== undefined);
        assert.equal(put.contentType, "text/plain");
      });

      it("surfaces a 412 from the PUT as content-rejected (the conflict)", async () => {
        const { adapter } = adapterWith([
          {
            when: isPut,
            reply: contentFail({
              code: "content-rejected",
              error: { status: 412 },
            }),
          },
        ]);
        const result = await adapter.writeFileContent(
          FILE_RES,
          new Uint8Array(),
          { etag: '"stale"', contentType: undefined },
        );
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-rejected");
        assert.equal(result.problem.error.status, 412);
      });

      it("passes any other PUT failure straight through", async () => {
        const { adapter } = adapterWith([
          {
            when: isPut,
            reply: contentFail({ code: "forbidden", error: { status: 403 } }),
          },
        ]);
        const result = await adapter.writeFileContent(
          FILE_RES,
          new Uint8Array(),
          { etag: '"e1"', contentType: undefined },
        );
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "forbidden");
      });
    });
  });

  describe("6c-i mutations (findings 6.3–6.9)", () => {
    const PARENT = "/folders/folders/ffff0000-0000-4000-8000-000000000009";
    const VALIDATE_NEW =
      "/folders/commons/validations/folders/ffff0000-0000-4000-8000-000000000009/members/@new/name";

    /** A folder item carrying the links `createChild` / `addMember` /
     * `validateNewMemberName` need (the shape `createFolder` returns, minus the
     * validate link unless `withValidate`). */
    function parentFolder(withValidate = true): ContentItem {
      const links = [
        { rel: "self", href: PARENT, method: "GET" },
        {
          rel: "createChild",
          href: `/folders/folders?parentFolderUri=${PARENT}`,
          method: "POST",
          type: "application/vnd.sas.content.folder",
        },
        {
          rel: "addMember",
          href: `${PARENT}/members`,
          method: "POST",
          type: "application/vnd.sas.content.folder.member",
        },
      ];
      if (withValidate) {
        links.push({
          rel: "validateNewMemberName",
          href: `${VALIDATE_NEW}?value={newname}&type={newtype}`,
          method: "PUT",
          type: "application/vnd.sas.validation",
        });
      }
      return { id: "p", name: "My Folder", type: "folder", links };
    }

    const fileRep = () => readJsonFixture("content", "file-python.json");
    const FILE_SELF = "/files/files/dddddddd-0000-4000-8000-000000000001";

    describe("createFolder", () => {
      it("validates the name, then POSTs {name} to the createChild link", async () => {
        let body: unknown;
        const { adapter, calls } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true, version: 1 }) },
          {
            when: "/folders/folders",
            reply: (request) => {
              body = request.jsonBody;
              return contentFixture("folder-created.json");
            },
          },
        ]);
        const result = await adapter.createFolder(parentFolder(), "reports");
        assert.ok(result.ok);
        assert.equal(result.value.name, "reports");
        assert.deepEqual(body, { name: "reports" });
        assert.deepEqual(
          calls.map((c) => `${c.method} ${c.href.split("?")[0] ?? ""}`),
          [
            "PUT /folders/commons/validations/folders/ffff0000-0000-4000-8000-000000000009/members/@new/name",
            "POST /folders/folders",
          ],
        );
        // The templated validate href had its placeholders filled.
        assert.match(calls[0]?.href ?? "", /value=reports&type=folder/);
      });

      it("returns content-name-rejected on a taken name, without creating", async () => {
        const { adapter, calls } = adapterWith([
          {
            when: VALIDATE_NEW,
            reply: contentFixture("validate-name-taken.json"),
          },
        ]);
        const result = await adapter.createFolder(parentFolder(), "reports");
        assert.ok(!result.ok);
        assert.ok(result.problem.code === "content-name-rejected");
        assert.match(result.problem.message, /already exists/);
        assert.equal(result.problem.suggestion, "reports (1)");
        assert.equal(
          calls.some((c) => c.method === "POST"),
          false,
        );
      });

      it("still creates when the parent offers no validateNewMemberName link", async () => {
        const { adapter, calls } = adapterWith([
          {
            when: "/folders/folders",
            reply: contentFixture("folder-created.json"),
          },
        ]);
        const result = await adapter.createFolder(
          parentFolder(false),
          "reports",
        );
        assert.ok(result.ok);
        assert.deepEqual(
          calls.map((c) => c.method),
          ["POST"],
        );
      });

      it("reports link-missing when the parent has no createChild link", async () => {
        const { adapter } = adapterWith([]);
        const result = await adapter.createFolder(
          { id: "p", name: "x", type: "folder", links: [] },
          "reports",
        );
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
        assert.equal(result.problem.rel, "createChild");
      });

      it("reports response-malformed when the create body is not a folder", async () => {
        const { adapter } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          { when: "/folders/folders", reply: contentOk({ nope: true }) },
        ]);
        const result = await adapter.createFolder(parentFolder(), "reports");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });
    });

    describe("createFile", () => {
      const routesFor = (
        over: readonly RecordedContentRoute[] = [],
      ): readonly RecordedContentRoute[] => [
        ...over,
        { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
        {
          when: "/types/types",
          reply: contentFixture("types-python.json"),
        },
        {
          when: "/files/files",
          reply: contentOk(fileRep(), { status: 201, etag: '"new"' }),
        },
        {
          when: `${PARENT}/members`,
          reply: contentFixture("member-created.json"),
        },
      ];

      it("resolves the type, POSTs an empty file with a Content-Disposition, then addMember", async () => {
        let filePost: ContentRequest | undefined;
        let memberBody: unknown;
        const { adapter, calls } = adapterWith(
          routesFor([
            {
              when: (href, method) =>
                href.startsWith("/files/files?") && method === "POST",
              reply: (request) => {
                filePost = request;
                return contentOk(fileRep(), { status: 201 });
              },
            },
            {
              when: (href, method) =>
                href === `${PARENT}/members` && method === "POST",
              reply: (request) => {
                memberBody = request.jsonBody;
                return contentFixture("member-created.json");
              },
            },
          ]),
        );
        const result = await adapter.createFile(parentFolder(), "model.py");
        assert.ok(result.ok);
        assert.equal(result.value.name, "model.py");
        assert.ok(filePost);
        assert.match(filePost.link.href, /typeDefName=file_py/);
        assert.equal(filePost.contentDisposition, "filename*=UTF-8''model.py");
        assert.equal(filePost.contentType, "application/x-python");
        assert.deepEqual(memberBody, {
          uri: FILE_SELF,
          type: "CHILD",
          name: "model.py",
          contentType: "file_py",
        });
        assert.ok(calls.some((c) => c.href.startsWith("/types/types")));
      });

      it("short-circuits .sas to programFile with no /types/types lookup", async () => {
        let filePost: ContentRequest | undefined;
        const { adapter, calls } = adapterWith(
          routesFor([
            {
              when: (href, method) =>
                href.startsWith("/files/files?") && method === "POST",
              reply: (request) => {
                filePost = request;
                return contentOk(fileRep(), { status: 201 });
              },
            },
          ]),
        );
        const result = await adapter.createFile(parentFolder(), "notes.sas");
        assert.ok(result.ok);
        assert.match(filePost?.link.href ?? "", /typeDefName=programFile/);
        assert.equal(
          calls.some((c) => c.href.startsWith("/types/types")),
          false,
        );
      });

      it("falls back to typeDefName=file when the lookup finds nothing", async () => {
        let filePost: ContentRequest | undefined;
        const { adapter } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          { when: "/types/types", reply: contentOk({ count: 0, items: [] }) },
          {
            when: (href, method) =>
              href.startsWith("/files/files?") && method === "POST",
            reply: (request) => {
              filePost = request;
              return contentOk(fileRep(), { status: 201 });
            },
          },
          {
            when: `${PARENT}/members`,
            reply: contentFixture("member-created.json"),
          },
        ]);
        const result = await adapter.createFile(parentFolder(), "data.weird");
        assert.ok(result.ok);
        assert.match(filePost?.link.href ?? "", /typeDefName=file(&|$)/);
      });

      it("caches the type lookup per extension across calls", async () => {
        const { adapter, calls } = adapterWith(routesFor());
        await adapter.createFile(parentFolder(), "a.py");
        await adapter.createFile(parentFolder(), "b.py");
        assert.equal(
          calls.filter((c) => c.href.startsWith("/types/types")).length,
          1,
        );
      });

      it("deletes the orphan file resource when addMember fails", async () => {
        const { adapter, calls } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          { when: "/types/types", reply: contentFixture("types-python.json") },
          {
            when: (href, method) =>
              href.startsWith("/files/files?") && method === "POST",
            reply: contentOk(fileRep(), { status: 201 }),
          },
          {
            when: (href, method) =>
              href === `${PARENT}/members` && method === "POST",
            reply: contentFail({ code: "forbidden", error: { status: 403 } }),
          },
          { when: FILE_SELF, reply: contentOk({}, { status: 204 }) },
        ]);
        const result = await adapter.createFile(parentFolder(), "model.py");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "forbidden");
        assert.ok(
          calls.some((c) => c.method === "DELETE" && c.href === FILE_SELF),
          "expected a rollback DELETE of the created file",
        );
      });

      it("rolls the orphan back even when the caller's signal is already aborted", async () => {
        // The most likely reason addMember fails partway is the caller's signal
        // firing. The rollback DELETE must not carry that aborted signal, or it
        // rejects before it reaches the network and the file is orphaned.
        let rollback: ContentRequest | undefined;
        const { adapter } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          { when: "/types/types", reply: contentFixture("types-python.json") },
          {
            when: (href, method) =>
              href.startsWith("/files/files?") && method === "POST",
            reply: contentOk(fileRep(), { status: 201 }),
          },
          {
            when: (href, method) =>
              href === `${PARENT}/members` && method === "POST",
            reply: contentFail({
              code: "content-unreachable",
              detail: "aborted",
            }),
          },
          {
            when: (href, method) => href === FILE_SELF && method === "DELETE",
            reply: (request) => {
              rollback = request;
              return contentOk({}, { status: 204 });
            },
          },
        ]);
        const result = await adapter.createFile(
          parentFolder(),
          "model.py",
          AbortSignal.abort(),
        );
        assert.ok(!result.ok);
        assert.ok(rollback, "the rollback DELETE was not attempted");
        assert.equal(
          rollback.signal,
          undefined,
          "the rollback must not forward the caller's aborted signal",
        );
      });
    });

    describe("renameItem", () => {
      it("PUTs a minimal {name} body for a folder read directly", async () => {
        let body: unknown;
        const folder: ContentItem = {
          id: "d",
          name: "old",
          type: "folder",
          links: [
            { rel: "self", href: PARENT, method: "GET" },
            {
              rel: "update",
              href: PARENT,
              method: "PUT",
              type: "application/vnd.sas.content.folder",
            },
          ],
        };
        const { adapter } = adapterWith([
          {
            when: (href, method) => href === PARENT && method === "PUT",
            reply: (request) => {
              body = request.jsonBody;
              return contentFixture("folder-created.json");
            },
          },
        ]);
        const result = await adapter.renameItem(folder, "reports");
        assert.ok(result.ok);
        assert.deepEqual(body, { name: "reports" });
      });

      it("reads then PUTs the whole representation for a member, name changed", async () => {
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        assert.ok(memberSelf);
        let body: Record<string, unknown> | undefined;
        const { adapter, calls } = adapterWith([
          {
            when: (href) => href.includes("/validations/"),
            reply: contentOk({ valid: true }),
          },
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentFixture("member-created.json"),
          },
          {
            when: (href, method) => href === memberSelf && method === "PUT",
            reply: (request) => {
              body = request.jsonBody as Record<string, unknown>;
              return contentFixture("member-created.json");
            },
          },
        ]);
        const result = await adapter.renameItem(member, "renamed.py");
        assert.ok(result.ok);
        assert.ok(body);
        assert.equal(body.name, "renamed.py");
        assert.equal(body.id, member.id); // carried from the read
        assert.deepEqual(
          calls.map((c) => c.method),
          ["PUT", "GET", "PUT"],
        );
      });

      it("returns content-name-rejected on a rename collision, without the PUT", async () => {
        const member = readContentItemFixture("member-created.json");
        const { adapter, calls } = adapterWith([
          {
            when: (href) => href.includes("/validations/"),
            reply: contentFixture("validate-name-taken.json"),
          },
        ]);
        const result = await adapter.renameItem(member, "reports");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-name-rejected");
        assert.equal(
          calls.some(
            (c) => c.method === "PUT" && !c.href.includes("validation"),
          ),
          false,
        );
      });
    });

    describe("moveItem (finding 6.10)", () => {
      const DEST = "/folders/folders/cccc3333-0000-4000-8000-00000000000e";

      it("reads the member, then PUTs it back with parentFolderUri changed", async () => {
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        assert.ok(memberSelf);
        let body: Record<string, unknown> | undefined;
        const { adapter, calls } = adapterWith([
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentFixture("member-created.json"),
          },
          {
            when: (href, method) => href === memberSelf && method === "PUT",
            reply: (request) => {
              body = request.jsonBody as Record<string, unknown>;
              return contentFixture("member-moved.json");
            },
          },
        ]);

        const result = await adapter.moveItem(member, DEST);
        assert.ok(result.ok);
        assert.ok(body);
        assert.equal(body.parentFolderUri, DEST);
        assert.equal(body.id, member.id); // whole representation echoed back
        assert.equal(body.uri, member.uri); // the field the server requires
        assert.deepEqual(
          calls.map((c) => c.method),
          ["GET", "PUT"],
        );
        // The returned item is the server's, re-read: same id, new parent.
        assert.equal(result.value.id, member.id);
        assert.equal(result.value.parentFolderUri, DEST);
      });

      it("uses the update link when the item carries no self link", async () => {
        const updateHref = "/folders/folders/p/members/m";
        const item: ContentItem = {
          id: "m",
          name: "thing.py",
          type: "child",
          uri: "/files/files/x",
          links: [{ rel: "update", href: updateHref, method: "PUT" }],
        };
        const seen: string[] = [];
        const { adapter } = adapterWith([
          {
            when: (href, method) => href === updateHref && method === "GET",
            reply: () => {
              seen.push("GET");
              return contentOk({ id: "m", name: "thing.py", links: [] });
            },
          },
          {
            when: (href, method) => href === updateHref && method === "PUT",
            reply: () => {
              seen.push("PUT");
              return contentFixture("member-moved.json");
            },
          },
        ]);
        const result = await adapter.moveItem(item, DEST);
        assert.ok(result.ok);
        assert.deepEqual(seen, ["GET", "PUT"]);
      });

      it("reports link-missing when the item has no self or update link", async () => {
        const item: ContentItem = {
          id: "m",
          name: "orphan",
          type: "child",
          links: [
            { rel: "getResource", href: "/files/files/x", method: "GET" },
          ],
        };
        const { adapter, calls } = adapterWith([]);
        const result = await adapter.moveItem(item, DEST);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
        assert.equal(calls.length, 0);
      });

      it("reports response-malformed when the read body is not an object", async () => {
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        const { adapter } = adapterWith([
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentOk("not an object"),
          },
        ]);
        const result = await adapter.moveItem(member, DEST);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("reports response-malformed when the PUT does not return a member", async () => {
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        const { adapter } = adapterWith([
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentFixture("member-created.json"),
          },
          {
            when: (href, method) => href === memberSelf && method === "PUT",
            reply: contentOk({ nope: true }),
          },
        ]);
        const result = await adapter.moveItem(member, DEST);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("passes a read failure straight through", async () => {
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        const { adapter } = adapterWith([
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentFail({ code: "content-unreachable", detail: "down" }),
          },
        ]);
        const result = await adapter.moveItem(member, DEST);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-unreachable");
      });

      it("passes a PUT rejection (a cycle / self-move 400) straight through", async () => {
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        const { adapter } = adapterWith([
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentFixture("member-created.json"),
          },
          {
            when: (href, method) => href === memberSelf && method === "PUT",
            reply: contentFail({
              code: "content-rejected",
              error: {
                status: 400,
                detail: "A folder cannot be moved or copied into itself.",
              },
            }),
          },
        ]);
        const result = await adapter.moveItem(member, DEST);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-rejected");
      });
    });

    describe("deleteItem", () => {
      it("deletes a leaf's resource then tidies its member record", async () => {
        const leaf = readContentItemFixture("member-created.json");
        const resourceHref = leaf.links.find(
          (l) => l.rel === "deleteResource",
        )?.href;
        const memberHref = leaf.links.find((l) => l.rel === "delete")?.href;
        assert.ok(resourceHref);
        assert.ok(memberHref);
        const { adapter, calls } = adapterWith([
          { when: resourceHref, reply: contentOk({}, { status: 204 }) },
          { when: memberHref, reply: contentOk({}, { status: 204 }) },
        ]);
        const result = await adapter.deleteItem(leaf);
        assert.ok(result.ok);
        assert.deepEqual(
          calls.map((c) => `${c.method} ${c.href}`),
          [`DELETE ${resourceHref}`, `DELETE ${memberHref}`],
        );
      });

      it("treats a 404 on the trailing member delete as success", async () => {
        const leaf = readContentItemFixture("member-created.json");
        const resourceHref = leaf.links.find(
          (l) => l.rel === "deleteResource",
        )?.href;
        const { adapter } = adapterWith([
          { when: resourceHref ?? "", reply: contentOk({}, { status: 204 }) },
          {
            when: (href, method) =>
              method === "DELETE" && href.includes("/members/"),
            reply: contentFail({
              code: "content-rejected",
              error: { status: 404 },
            }),
          },
        ]);
        const result = await adapter.deleteItem(leaf);
        assert.ok(result.ok);
      });

      it("propagates a failure on the resource delete itself", async () => {
        const leaf = readContentItemFixture("member-created.json");
        const resourceHref = leaf.links.find(
          (l) => l.rel === "deleteResource",
        )?.href;
        const { adapter, calls } = adapterWith([
          {
            when: resourceHref ?? "",
            reply: contentFail({ code: "forbidden", error: { status: 403 } }),
          },
        ]);
        const result = await adapter.deleteItem(leaf);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "forbidden");
        assert.equal(calls.length, 1); // no trailing member delete
      });

      /** A folder to delete, plus the members-collection reply listing two file
       * children that each carry `deleteResource` + `delete` links. */
      const doomedFolder = (): ContentItem => ({
        id: "fdel",
        name: "doomed",
        type: "folder",
        links: [
          { rel: "self", href: PARENT, method: "GET" },
          {
            rel: "members",
            href: `${PARENT}/members`,
            method: "GET",
            type: "application/vnd.sas.collection",
          },
          {
            rel: "deleteRecursively",
            href: `${PARENT}?recursive=true`,
            method: "DELETE",
          },
        ],
      });
      const childMember = (suffix: string) => ({
        id: `child-${suffix}`,
        name: `c${suffix}.py`,
        type: "child",
        contentType: "file",
        uri: `/files/files/child00${suffix}`,
        links: [
          {
            rel: "self",
            href: `${PARENT}/members/child-${suffix}`,
            method: "GET",
          },
          {
            rel: "deleteResource",
            href: `/files/files/child00${suffix}`,
            method: "DELETE",
          },
          {
            rel: "delete",
            href: `${PARENT}/members/child-${suffix}`,
            method: "DELETE",
          },
        ],
      });
      const twoChildren = contentOk({
        count: 2,
        items: [childMember("1"), childMember("2")],
      });

      it("empties a folder before deleting it, children first", async () => {
        const order: string[] = [];
        const { adapter } = adapterWith([
          { when: `${PARENT}/members`, reply: twoChildren },
          {
            when: (href, method) =>
              method === "DELETE" && href.startsWith("/files/files/child"),
            reply: () => {
              order.push("child");
              return contentOk({}, { status: 204 });
            },
          },
          {
            when: (href, method) =>
              method === "DELETE" && href.includes("/members/child-"),
            reply: contentOk({}, { status: 204 }),
          },
          {
            when: (href, method) =>
              method === "DELETE" && href === `${PARENT}?recursive=true`,
            reply: () => {
              order.push("folder");
              return contentOk({}, { status: 204 });
            },
          },
        ]);
        const result = await adapter.deleteItem(doomedFolder());
        assert.ok(result.ok);
        assert.deepEqual(order, ["child", "child", "folder"]);
      });

      it("stops and propagates when a child delete fails", async () => {
        let folderDeleted = false;
        const { adapter } = adapterWith([
          { when: `${PARENT}/members`, reply: twoChildren },
          {
            when: (href, method) =>
              method === "DELETE" && href.startsWith("/files/files/child"),
            reply: contentFail({ code: "forbidden", error: { status: 403 } }),
          },
          {
            when: (href, method) =>
              method === "DELETE" && href === `${PARENT}?recursive=true`,
            reply: () => {
              folderDeleted = true;
              return contentOk({}, { status: 204 });
            },
          },
        ]);
        const result = await adapter.deleteItem(doomedFolder());
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "forbidden");
        assert.equal(folderDeleted, false);
      });
    });

    describe("defensive paths", () => {
      const fileRepJson = () => readJsonFixture("content", "file-python.json");

      it("createFolder passes a create failure straight through", async () => {
        const { adapter } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          {
            when: "/folders/folders",
            reply: contentFail({ code: "forbidden", error: { status: 403 } }),
          },
        ]);
        const result = await adapter.createFolder(parentFolder(), "x");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "forbidden");
      });

      it("createFolder proceeds when the validate call itself fails", async () => {
        const { adapter, calls } = adapterWith([
          {
            when: VALIDATE_NEW,
            reply: contentFail({
              code: "content-unreachable",
              detail: "ECONNRESET",
            }),
          },
          {
            when: "/folders/folders",
            reply: contentFixture("folder-created.json"),
          },
        ]);
        const result = await adapter.createFolder(parentFolder(), "x");
        assert.ok(result.ok);
        assert.ok(calls.some((c) => c.method === "POST"));
      });

      it("createFolder names a bare valid:false with no error object", async () => {
        const { adapter } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: false }) },
        ]);
        const result = await adapter.createFolder(parentFolder(), "x");
        assert.ok(!result.ok);
        assert.ok(result.problem.code === "content-name-rejected");
        assert.match(result.problem.message, /cannot be used/);
        assert.equal(result.problem.suggestion, undefined);
      });

      it("createFolder keeps a valid:false message but drops a details list with no suggestion", async () => {
        const { adapter } = adapterWith([
          {
            when: VALIDATE_NEW,
            reply: contentOk({
              valid: false,
              error: { message: "reserved", details: ["not a suggestion"] },
            }),
          },
        ]);
        const result = await adapter.createFolder(parentFolder(), "x");
        assert.ok(!result.ok);
        assert.ok(result.problem.code === "content-name-rejected");
        assert.equal(result.problem.message, "reserved");
        assert.equal(result.problem.suggestion, undefined);
      });

      it("createFile reports link-missing when the parent has no addMember link", async () => {
        const parent: ContentItem = {
          id: "p",
          name: "x",
          type: "folder",
          links: [{ rel: "self", href: PARENT, method: "GET" }],
        };
        const result = await adapterWith([]).adapter.createFile(parent, "a.py");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
        assert.equal(result.problem.rel, "addMember");
      });

      it("createFile passes a file-create failure straight through", async () => {
        const { adapter } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          { when: "/types/types", reply: contentFixture("types-python.json") },
          {
            when: "/files/files",
            reply: contentFail({ code: "forbidden", error: { status: 403 } }),
          },
        ]);
        const result = await adapter.createFile(parentFolder(), "a.py");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "forbidden");
      });

      it("createFile reports response-malformed when the created file has no self link", async () => {
        const { adapter } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          { when: "/types/types", reply: contentFixture("types-python.json") },
          {
            when: "/files/files",
            reply: contentOk({ id: "x", name: "a.py" }, { status: 201 }),
          },
        ]);
        const result = await adapter.createFile(parentFolder(), "a.py");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("createFile reports response-malformed when addMember returns a non-member", async () => {
        const { adapter } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          { when: "/types/types", reply: contentFixture("types-python.json") },
          {
            when: (href, method) =>
              href.startsWith("/files/files?") && method === "POST",
            reply: contentOk(fileRepJson(), { status: 201 }),
          },
          { when: `${PARENT}/members`, reply: contentOk({ nope: true }) },
          { when: FILE_SELF, reply: contentOk({}, { status: 204 }) },
        ]);
        const result = await adapter.createFile(parentFolder(), "a.py");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("createFile falls back to typeDefName=file when the /types/types lookup errors", async () => {
        let filePost: ContentRequest | undefined;
        const { adapter } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          {
            when: "/types/types",
            reply: contentFail({
              code: "content-unreachable",
              detail: "ETIMEDOUT",
            }),
          },
          {
            when: (href, method) =>
              href.startsWith("/files/files?") && method === "POST",
            reply: (request) => {
              filePost = request;
              return contentOk(fileRepJson(), { status: 201 });
            },
          },
          {
            when: `${PARENT}/members`,
            reply: contentFixture("member-created.json"),
          },
        ]);
        const result = await adapter.createFile(parentFolder(), "a.py");
        assert.ok(result.ok);
        assert.ok(filePost);
        assert.match(filePost.link.href, /typeDefName=file(&|$)/);
      });

      it("createFile reports response-malformed when the created file's links carry no usable self", async () => {
        const { adapter } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          { when: "/types/types", reply: contentFixture("types-python.json") },
          {
            when: "/files/files",
            reply: contentOk(
              {
                id: "x",
                name: "a.py",
                links: [
                  null,
                  { rel: "alternate", href: "/y" },
                  { rel: "self" },
                ],
              },
              { status: 201 },
            ),
          },
        ]);
        const result = await adapter.createFile(parentFolder(), "a.py");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("createFile uses typeDefName=file for a name with no extension, no lookup", async () => {
        let filePost: ContentRequest | undefined;
        const { adapter, calls } = adapterWith([
          { when: VALIDATE_NEW, reply: contentOk({ valid: true }) },
          {
            when: (href, method) =>
              href.startsWith("/files/files?") && method === "POST",
            reply: (request) => {
              filePost = request;
              return contentOk(fileRepJson(), { status: 201 });
            },
          },
          {
            when: `${PARENT}/members`,
            reply: contentFixture("member-created.json"),
          },
        ]);
        const result = await adapter.createFile(parentFolder(), "Makefile");
        assert.ok(result.ok);
        assert.ok(filePost);
        assert.match(filePost.link.href, /typeDefName=file(&|$)/);
        assert.equal(
          calls.some((c) => c.href.startsWith("/types/types")),
          false,
        );
      });

      it("renameItem reports link-missing when the item has no update or self link", async () => {
        const result = await adapterWith([]).adapter.renameItem(
          { id: "x", name: "x", type: "folder", links: [] },
          "y",
        );
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
      });

      it("renameItem passes a member-read failure straight through", async () => {
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        assert.ok(memberSelf);
        const { adapter } = adapterWith([
          {
            when: (href) => href.includes("/validations/"),
            reply: contentOk({ valid: true }),
          },
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentFail({
              code: "content-rejected",
              error: { status: 404 },
            }),
          },
        ]);
        const result = await adapter.renameItem(member, "y.py");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-rejected");
      });

      it("renameItem reports response-malformed when the member read is not an object", async () => {
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        assert.ok(memberSelf);
        const { adapter } = adapterWith([
          {
            when: (href) => href.includes("/validations/"),
            reply: contentOk({ valid: true }),
          },
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentOk("just a string"),
          },
        ]);
        const result = await adapter.renameItem(member, "y.py");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("renameItem reports response-malformed when the rename PUT body is not readable", async () => {
        const folder: ContentItem = {
          id: "d",
          name: "old",
          type: "folder",
          links: [
            { rel: "self", href: PARENT, method: "GET" },
            { rel: "update", href: PARENT, method: "PUT" },
          ],
        };
        const { adapter } = adapterWith([
          {
            when: (href, method) => href === PARENT && method === "PUT",
            reply: contentOk({ not: "an item" }),
          },
        ]);
        const result = await adapter.renameItem(folder, "new");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("renameItem passes a rename PUT failure straight through", async () => {
        const folder: ContentItem = {
          id: "d",
          name: "old",
          type: "folder",
          links: [{ rel: "update", href: PARENT, method: "PUT" }],
        };
        const { adapter } = adapterWith([
          {
            when: (href, method) => href === PARENT && method === "PUT",
            reply: contentFail({
              code: "content-rejected",
              error: { status: 412 },
            }),
          },
        ]);
        const result = await adapter.renameItem(folder, "new");
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-rejected");
      });

      it("deleteItem reports link-missing for a leaf with no deleteResource link", async () => {
        const result = await adapterWith([]).adapter.deleteItem({
          id: "f",
          name: "a.py",
          type: "child",
          contentType: "file",
          links: [{ rel: "self", href: "/x", method: "GET" }],
        });
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
        assert.equal(result.problem.rel, "deleteResource");
      });

      it("deleteItem reports link-missing for a folder with no delete link, after emptying it", async () => {
        const folder: ContentItem = {
          id: "d",
          name: "d",
          type: "folder",
          links: [
            {
              rel: "members",
              href: `${PARENT}/members`,
              method: "GET",
              type: "application/vnd.sas.collection",
            },
          ],
        };
        const { adapter } = adapterWith([
          { when: `${PARENT}/members`, reply: contentOk({ items: [] }) },
        ]);
        const result = await adapter.deleteItem(folder);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
      });

      it("deleteItem propagates a failed child listing", async () => {
        const folder: ContentItem = {
          id: "d",
          name: "d",
          type: "folder",
          links: [
            {
              rel: "members",
              href: `${PARENT}/members`,
              method: "GET",
              type: "application/vnd.sas.collection",
            },
            {
              rel: "deleteRecursively",
              href: `${PARENT}?recursive=true`,
              method: "DELETE",
            },
          ],
        };
        const { adapter } = adapterWith([
          {
            when: `${PARENT}/members`,
            reply: contentFail({ code: "forbidden", error: { status: 403 } }),
          },
        ]);
        const result = await adapter.deleteItem(folder);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "forbidden");
      });

      it("deleteItem deletes a sub-folder member by its resource and tidies the member record", async () => {
        // A folder *member* (type "child", contentType "folder") carries
        // deleteResource + delete, not deleteRecursively (finding 99).
        const subFolder: ContentItem = {
          id: "sf",
          name: "sub",
          type: "child",
          contentType: "folder",
          uri: "/folders/folders/sf",
          links: [
            {
              rel: "members",
              href: "/folders/folders/sf/members",
              method: "GET",
              type: "application/vnd.sas.collection",
            },
            {
              rel: "deleteResource",
              href: "/folders/folders/sf",
              method: "DELETE",
            },
            {
              rel: "delete",
              href: `${PARENT}/members/sf`,
              method: "DELETE",
            },
          ],
        };
        const { adapter, calls } = adapterWith([
          {
            when: "/folders/folders/sf/members",
            reply: contentOk({ items: [] }),
          },
          {
            when: (href, method) =>
              method === "DELETE" && href === "/folders/folders/sf",
            reply: contentOk({}, { status: 204 }),
          },
          {
            when: (href, method) =>
              method === "DELETE" && href === `${PARENT}/members/sf`,
            reply: contentOk({}, { status: 204 }),
          },
        ]);
        const result = await adapter.deleteItem(subFolder);
        assert.ok(result.ok);
        assert.deepEqual(
          calls.filter((c) => c.method === "DELETE").map((c) => c.href),
          ["/folders/folders/sf", `${PARENT}/members/sf`],
        );
      });
    });
  });

  describe("addToFavorites / removeFromFavorites (finding 6.13)", () => {
    const FAV_SELF = "/folders/folders/@myFavorites";
    const FAV_ADD =
      "/folders/folders/aaaaaaaa-0000-4000-8000-000000000002/members";

    describe("addToFavorites", () => {
      it("POSTs a reference member to the My Favorites addMember link", async () => {
        const member = readContentItemFixture("member-created.json");
        let body: Record<string, unknown> | undefined;
        const { adapter, calls } = adapterWith([
          { when: FAV_SELF, reply: contentFixture("delegate-favorites.json") },
          {
            when: (href, method) => href === FAV_ADD && method === "POST",
            reply: (request) => {
              body = request.jsonBody as Record<string, unknown>;
              return contentOk(
                { id: "ref", name: member.name, links: [] },
                {
                  status: 201,
                },
              );
            },
          },
        ]);

        const result = await adapter.addToFavorites(member);
        assert.ok(result.ok);
        assert.ok(body);
        assert.equal(body.type, "reference");
        assert.equal(body.uri, member.uri);
        assert.equal(body.name, member.name);
        assert.equal(body.contentType, member.contentType);
        assert.deepEqual(
          calls.map((c) => `${c.method} ${c.href}`),
          [`GET ${FAV_SELF}`, `POST ${FAV_ADD}`],
        );
      });

      it("omits contentType when the item has none (a root-listing folder)", async () => {
        const folder: ContentItem = {
          id: "f",
          name: "Shared",
          type: "folder",
          links: [{ rel: "self", href: "/folders/folders/f" }],
        };
        let body: Record<string, unknown> | undefined;
        const { adapter } = adapterWith([
          { when: FAV_SELF, reply: contentFixture("delegate-favorites.json") },
          {
            when: (href, method) => href === FAV_ADD && method === "POST",
            reply: (request) => {
              body = request.jsonBody as Record<string, unknown>;
              return contentOk(
                { id: "ref", name: "Shared", links: [] },
                {
                  status: 201,
                },
              );
            },
          },
        ]);
        const result = await adapter.addToFavorites(folder);
        assert.ok(result.ok);
        assert.ok(body);
        assert.equal("contentType" in body, false);
        assert.equal(body.uri, "/folders/folders/f");
      });

      it("re-fetches the My Favorites folder on every call — never cached", async () => {
        // `@myFavorites` resolves per account; one ContentAdapter is reused
        // across profile switches on an endpoint, so a cached href would let one
        // account's addMember land in another's favourites (PR review, blocking).
        const member = readContentItemFixture("member-created.json");
        let favGets = 0;
        const { adapter } = adapterWith([
          {
            when: FAV_SELF,
            reply: () => {
              favGets += 1;
              return contentFixture("delegate-favorites.json");
            },
          },
          {
            when: (href, method) => href === FAV_ADD && method === "POST",
            reply: contentOk(
              { id: "r", name: "x", links: [] },
              { status: 201 },
            ),
          },
        ]);

        assert.ok((await adapter.addToFavorites(member)).ok);
        assert.ok((await adapter.addToFavorites(member)).ok);
        assert.ok((await adapter.addToFavorites(member)).ok);
        assert.equal(favGets, 3);
      });

      it("reports link-missing when the item has no resolvable resource href", async () => {
        const { adapter } = adapterWith([]);
        const result = await adapter.addToFavorites({
          id: "x",
          name: "orphan",
          links: [],
        });
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
      });

      it("reports link-missing when My Favorites carries no addMember link", async () => {
        const { adapter } = adapterWith([
          {
            when: FAV_SELF,
            reply: contentOk({
              id: "fav",
              name: "My Favorites",
              type: "favoritesFolder",
              links: [{ rel: "self", href: FAV_SELF }],
            }),
          },
        ]);
        const result = await adapter.addToFavorites(
          readContentItemFixture("member-created.json"),
        );
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
        assert.equal(result.problem.rel, "addMember");
      });

      it("reports response-malformed when the My Favorites body is not a folder", async () => {
        const { adapter } = adapterWith([
          { when: FAV_SELF, reply: contentOk({ not: "a folder" }) },
        ]);
        const result = await adapter.addToFavorites(
          readContentItemFixture("member-created.json"),
        );
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("passes a POST failure straight through", async () => {
        const { adapter } = adapterWith([
          { when: FAV_SELF, reply: contentFixture("delegate-favorites.json") },
          {
            when: (href, method) => href === FAV_ADD && method === "POST",
            reply: contentFail({
              code: "content-rejected",
              error: { status: 409 },
            }),
          },
        ]);
        const result = await adapter.addToFavorites(
          readContentItemFixture("member-created.json"),
        );
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-rejected");
      });
    });

    describe("removeFromFavorites", () => {
      const RECORD = "/folders/folders/fav/members/ref-1";

      it("DELETEs the favoriteUri record, not the underlying resource", async () => {
        const { adapter, calls } = adapterWith([
          {
            when: (href, method) => href === RECORD && method === "DELETE",
            reply: contentNoBody(),
          },
        ]);
        const item: ContentItem = {
          id: "m",
          name: "analysis.py",
          type: "child",
          contentType: "file",
          uri: "/files/files/a1",
          favoriteUri: RECORD,
          links: [
            {
              rel: "deleteResource",
              href: "/files/files/a1",
              method: "DELETE",
            },
          ],
        };
        const result = await adapter.removeFromFavorites(item);
        assert.ok(result.ok);
        assert.deepEqual(
          calls.map((c) => `${c.method} ${c.href}`),
          [`DELETE ${RECORD}`],
        );
      });

      it("reports link-missing when the item carries no favoriteUri", async () => {
        const { adapter } = adapterWith([]);
        const result = await adapter.removeFromFavorites({
          id: "m",
          name: "x",
          links: [],
        });
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
      });

      it("passes a DELETE failure straight through", async () => {
        const { adapter } = adapterWith([
          {
            when: (href, method) => href === RECORD && method === "DELETE",
            reply: contentFail({
              code: "content-rejected",
              error: { status: 404 },
            }),
          },
        ]);
        const result = await adapter.removeFromFavorites({
          id: "m",
          name: "x",
          favoriteUri: RECORD,
          links: [],
        });
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-rejected");
      });
    });
  });

  describe("recycleItem / restoreItem / emptyRecycleBin (findings 6.14/6.15)", () => {
    const BIN_SELF = "/folders/folders/aaaaaaaa-0000-4000-8000-000000000003";
    const BIN_MEMBERS = `${BIN_SELF}/members`;

    describe("recycleItem", () => {
      it("resolves @myRecycleBin and moves the member onto its self href", async () => {
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        assert.ok(memberSelf);
        let body: Record<string, unknown> | undefined;
        const { adapter, calls } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: contentFixture("delegate-recycle-bin.json"),
          },
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentFixture("member-created.json"),
          },
          {
            when: (href, method) => href === memberSelf && method === "PUT",
            reply: (request) => {
              body = request.jsonBody as Record<string, unknown>;
              return contentFixture("member-moved.json");
            },
          },
        ]);

        const result = await adapter.recycleItem(member);
        assert.ok(result.ok);
        assert.ok(body);
        assert.equal(body.parentFolderUri, BIN_SELF);
        assert.deepEqual(
          calls.map((c) => `${c.method} ${c.href}`),
          [
            "GET /folders/folders/@myRecycleBin",
            `GET ${memberSelf}`,
            `PUT ${memberSelf}`,
          ],
        );
      });

      it("re-fetches @myRecycleBin on every call — never cached", async () => {
        // Same reasoning as favoritesFolder: `@myRecycleBin` resolves per
        // account, one adapter is reused across profile switches on an endpoint.
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        let binGets = 0;
        const { adapter } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: () => {
              binGets += 1;
              return contentFixture("delegate-recycle-bin.json");
            },
          },
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentFixture("member-created.json"),
          },
          {
            when: (href, method) => href === memberSelf && method === "PUT",
            reply: contentFixture("member-moved.json"),
          },
        ]);

        assert.ok((await adapter.recycleItem(member)).ok);
        assert.ok((await adapter.recycleItem(member)).ok);
        assert.equal(binGets, 2);
      });

      it("reports link-missing when the Recycle Bin carries no self link", async () => {
        const { adapter, calls } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: contentOk({
              id: "bin",
              name: "Recycle Bin",
              type: "trashFolder",
              links: [],
            }),
          },
        ]);
        const result = await adapter.recycleItem(
          readContentItemFixture("member-created.json"),
        );
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
        assert.equal(calls.length, 1);
      });

      it("passes a bin-resolve failure straight through", async () => {
        const { adapter } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: contentFail({ code: "content-unreachable", detail: "down" }),
          },
        ]);
        const result = await adapter.recycleItem(
          readContentItemFixture("member-created.json"),
        );
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-unreachable");
      });

      it("reports response-malformed when @myRecycleBin is not a folder", async () => {
        const { adapter } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: contentOk("not a folder"),
          },
        ]);
        const result = await adapter.recycleItem(
          readContentItemFixture("member-created.json"),
        );
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "response-malformed");
      });

      it("passes a move rejection straight through", async () => {
        const member = readContentItemFixture("member-created.json");
        const memberSelf = member.links.find((l) => l.rel === "self")?.href;
        const { adapter } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: contentFixture("delegate-recycle-bin.json"),
          },
          {
            when: (href, method) => href === memberSelf && method === "GET",
            reply: contentFixture("member-created.json"),
          },
          {
            when: (href, method) => href === memberSelf && method === "PUT",
            reply: contentFail({
              code: "content-rejected",
              error: { status: 409 },
            }),
          },
        ]);
        const result = await adapter.recycleItem(member);
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-rejected");
      });
    });

    describe("restoreItem", () => {
      it("moves the item back onto its previousParent href", async () => {
        // The second bin member (a file) — read straight out of the listing
        // fixture, the way `getChildItems` would hand it to the command layer.
        const listing = readJsonFixture("content", "recycle-bin-members.json");
        const item = readContentItem(
          (listing as { items: unknown[] }).items[1],
        );
        assert.ok(item);
        const self = item.links.find((l) => l.rel === "self")?.href;
        const previousParent = item.links.find(
          (l) => l.rel === "previousParent",
        )?.href;
        assert.ok(self && previousParent);

        let body: Record<string, unknown> | undefined;
        const { adapter, calls } = adapterWith([
          {
            when: (href, method) => href === self && method === "GET",
            reply: contentOk({
              id: item.id,
              name: item.name,
              type: "child",
              uri: item.uri,
              links: item.links,
            }),
          },
          {
            when: (href, method) => href === self && method === "PUT",
            reply: (request) => {
              body = request.jsonBody as Record<string, unknown>;
              return contentFixture("member-restored.json");
            },
          },
        ]);

        const result = await adapter.restoreItem(item);
        assert.ok(result.ok);
        assert.ok(body);
        assert.equal(body.parentFolderUri, previousParent);
        assert.deepEqual(
          calls.map((c) => c.method),
          ["GET", "PUT"],
        );
      });

      it("reports link-missing when the item carries no previousParent", async () => {
        const { adapter, calls } = adapterWith([]);
        const result = await adapter.restoreItem({
          id: "m",
          name: "orphan.py",
          type: "child",
          links: [{ rel: "self", href: "/folders/folders/b/members/m" }],
        });
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "link-missing");
        assert.equal(result.problem.rel, "previousParent");
        assert.equal(calls.length, 0);
      });

      it("passes a move failure straight through", async () => {
        const { adapter } = adapterWith([
          {
            when: (href, method) =>
              href === "/folders/folders/b/members/m" && method === "GET",
            reply: contentFail({
              code: "content-unreachable",
              detail: "down",
            }),
          },
        ]);
        const result = await adapter.restoreItem({
          id: "m",
          name: "x.py",
          type: "child",
          uri: "/files/files/x",
          links: [
            { rel: "self", href: "/folders/folders/b/members/m" },
            { rel: "previousParent", href: "/folders/folders/home" },
          ],
        });
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-unreachable");
      });
    });

    describe("emptyRecycleBin", () => {
      it("deletes every listed bin member, folder child-first, then tidies records", async () => {
        const deleted: string[] = [];
        const { adapter, calls } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: contentFixture("delegate-recycle-bin.json"),
          },
          {
            when: BIN_MEMBERS,
            reply: contentFixture("recycle-bin-members.json"),
          },
          // the recycled folder child's own (empty) members listing
          {
            when: "/folders/folders/eeee5555-0000-4000-8000-000000000c01/members",
            reply: contentOk({ items: [] }),
          },
          {
            when: (_href, method) => method === "DELETE",
            reply: (request) => {
              deleted.push(request.link.href);
              // the trailing member-record delete is a 404, swallowed
              return request.link.href.includes("/members/")
                ? contentFail({
                    code: "content-rejected",
                    error: { status: 404 },
                  })
                : contentNoBody();
            },
          },
        ]);

        const result = await adapter.emptyRecycleBin();
        assert.ok(result.ok);
        // both resources deleted (folder + file), each followed by its record
        assert.ok(
          deleted.includes(
            "/folders/folders/eeee5555-0000-4000-8000-000000000c01",
          ),
        );
        assert.ok(
          deleted.includes("/files/files/eeee5555-0000-4000-8000-000000000c02"),
        );
        assert.equal(calls[0]?.href, "/folders/folders/@myRecycleBin");
      });

      it("resolves an empty bin to ok with no deletes", async () => {
        const { adapter, calls } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: contentFixture("delegate-recycle-bin.json"),
          },
          { when: BIN_MEMBERS, reply: contentOk({ items: [] }) },
        ]);
        const result = await adapter.emptyRecycleBin();
        assert.ok(result.ok);
        assert.ok(!calls.some((c) => c.method === "DELETE"));
      });

      it("stops at the first member that fails to delete", async () => {
        const { adapter } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: contentFixture("delegate-recycle-bin.json"),
          },
          {
            when: BIN_MEMBERS,
            reply: contentFixture("recycle-bin-members.json"),
          },
          {
            when: "/folders/folders/eeee5555-0000-4000-8000-000000000c01/members",
            reply: contentOk({ items: [] }),
          },
          {
            when: (_href, method) => method === "DELETE",
            reply: contentFail({
              code: "content-rejected",
              error: { status: 403 },
            }),
          },
        ]);
        const result = await adapter.emptyRecycleBin();
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-rejected");
      });

      it("passes a members-listing failure straight through", async () => {
        const { adapter } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: contentFixture("delegate-recycle-bin.json"),
          },
          {
            when: BIN_MEMBERS,
            reply: contentFail({
              code: "content-unreachable",
              detail: "down",
            }),
          },
        ]);
        const result = await adapter.emptyRecycleBin();
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-unreachable");
      });

      it("passes a bin-resolve failure straight through", async () => {
        const { adapter, calls } = adapterWith([
          {
            when: "/folders/folders/@myRecycleBin",
            reply: contentFail({ code: "content-unreachable", detail: "x" }),
          },
        ]);
        const result = await adapter.emptyRecycleBin();
        assert.ok(!result.ok);
        assert.equal(result.problem.code, "content-unreachable");
        assert.equal(calls.length, 1);
      });
    });
  });
});

/** A `ContentItem` parsed from a fixture the way the adapter would see it —
 * for the mutation tests that need a realistic member/folder link set. */
function readContentItemFixture(name: string): ContentItem {
  const item = readContentItem(readJsonFixture("content", name));
  assert.ok(item, `fixture ${name} is not a content item`);
  return item;
}
