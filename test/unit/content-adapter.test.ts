// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  ContentAdapter,
  MAX_FILE_CONTENT_BYTES,
} from "../../src/content/adapter";
import { type ContentRequest } from "../../src/content/client";
import {
  isSasContentRoot,
  SAS_CONTENT_ROOT,
  type ContentItem,
} from "../../src/content/types";
import { readJsonFixture } from "../helpers/fixtures";
import {
  contentBytes,
  contentFail,
  contentFixture,
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
});
