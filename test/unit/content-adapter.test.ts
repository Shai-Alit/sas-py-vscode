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
  readContentItem,
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
});

/** A `ContentItem` parsed from a fixture the way the adapter would see it —
 * for the mutation tests that need a realistic member/folder link set. */
function readContentItemFixture(name: string): ContentItem {
  const item = readContentItem(readJsonFixture("content", name));
  assert.ok(item, `fixture ${name} is not a content item`);
  return item;
}
