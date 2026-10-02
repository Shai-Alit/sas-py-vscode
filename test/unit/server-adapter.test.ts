// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
} from "../../src/compute/client";
import { type ComputeSession } from "../../src/compute/session";
import {
  ContextAttributeCache,
  DISCARD_TIMEOUT_MS,
  FILE_CONTENT_TYPE,
  FILE_PROPERTIES_TYPE,
  MAX_MEMBER_PAGES,
  MAX_SERVER_FILE_BYTES,
  MAX_SERVER_TRANSFER_BYTES,
  MEMBERS_PAGE_LIMIT,
  SERVER_TRANSFER_TIMEOUT_MS,
  ServerAdapter,
  type ConnectedSession,
  type ProfileNavigation,
  type ServerResult,
} from "../../src/server/adapter";
import { type ServerItem } from "../../src/server/types";
import { type Link } from "../../src/wire/links";

/**
 * `ServerAdapter` against a stubbed `ComputeClient`, the boundary
 * `test/unit/compute-files.test.ts` stubs too. Shapes are the 13o probes'
 * (Findings 13.20–13.29), scrubbed: the session id, context id and paths
 * are made up, the relations and media types are as observed.
 */

const SESSION_ID = "5e55-ses0000";
const SESSION = `/compute/sessions/${SESSION_ID}`;
const FILES = `${SESSION}/files`;
const CONTEXT_NAME = "SAS Job Execution compute context";
const CONTEXT_SELF = "/compute/contexts/c0ffee";
const CONTEXTS_QUERY = `/compute/contexts?filter=${encodeURIComponent(
  `eq(name,'${CONTEXT_NAME}')`,
)}`;

/** The summary's `createSession` link, which `resolveContext` requires. */
const CREATE_SESSION: Link = {
  rel: "createSession",
  method: "POST",
  href: `${CONTEXT_SELF}/sessions`,
};

type Handler = (request: ComputeRequest) => ComputeResult<ComputeResponse>;

/** A client that answers by `METHOD href` and records every request. */
class FakeClient implements ComputeClient {
  readonly requests: ComputeRequest[] = [];
  private readonly routes = new Map<string, Handler>();

  on(method: string, href: string, handler: Handler | object | string): this {
    this.routes.set(
      `${method} ${href}`,
      typeof handler === "function" ? (handler as Handler) : () => ok(handler),
    );
    return this;
  }

  send(request: ComputeRequest): Promise<ComputeResult<ComputeResponse>> {
    this.requests.push(request);
    const key = `${request.link.method ?? "GET"} ${request.link.href}`;
    const handler = this.routes.get(key);
    if (handler === undefined) {
      return Promise.reject(new Error(`unexpected request: ${key}`));
    }
    return Promise.resolve(handler(request));
  }

  hrefs(): string[] {
    return this.requests.map((request) => request.link.href);
  }
}

function ok(
  body: unknown,
  init?: { etag?: string; rawBody?: Uint8Array; contentType?: string },
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: 200,
      notModified: false,
      ...(init?.etag === undefined ? {} : { etag: init.etag }),
      contentType: init?.contentType ?? "application/json",
      text: typeof body === "string" ? body : JSON.stringify(body),
      body: typeof body === "string" ? undefined : body,
      ...(init?.rawBody === undefined ? {} : { rawBody: init.rawBody }),
    },
  };
}

function rejected(status: number): ComputeFailure {
  return {
    ok: false,
    reason: `HTTP ${String(status)}`,
    problem: {
      code: "compute-rejected",
      error: { status, message: "Not Found" },
    },
  };
}

function session(links?: readonly Link[]): ComputeSession {
  return {
    id: SESSION_ID,
    state: "idle",
    links: links ?? [
      { rel: "self", method: "GET", href: SESSION },
      { rel: "state", method: "GET", href: `${SESSION}/state` },
    ],
  };
}

function directoryLinks(href: string): Link[] {
  return [
    { rel: "self", method: "GET", href, type: FILE_PROPERTIES_TYPE },
    {
      rel: "getDirectoryMembers",
      method: "GET",
      href: `${href}/members`,
      type: "application/vnd.sas.collection",
    },
  ];
}

function fileLinks(href: string): Link[] {
  return [
    { rel: "self", method: "GET", href, type: FILE_PROPERTIES_TYPE },
    {
      rel: "getFile",
      method: "GET",
      href: `${href}/content`,
      type: "text/plain",
    },
    {
      rel: "createFile",
      method: "PUT",
      href: `${href}/content`,
      type: "text/plain",
    },
  ];
}

function folderJson(name: string, parent: string, href: string) {
  return {
    name,
    path: parent,
    isDirectory: true,
    readOnly: name === "",
    size: 4096,
    modifiedTimeStamp: "2026-10-01T14:24:45.386Z",
    version: 1,
    links: directoryLinks(href),
  };
}

function fileJson(name: string, parent: string, href: string, size = 12) {
  return {
    name,
    path: parent,
    isDirectory: false,
    readOnly: false,
    size,
    modifiedTimeStamp: "2026-10-01T14:27:29.853Z",
    version: 1,
    links: fileLinks(href),
  };
}

/** A client already answering the context lookup with `attributes`. */
function contextClient(attributes?: Record<string, unknown>): FakeClient {
  return new FakeClient()
    .on("GET", CONTEXTS_QUERY, {
      items: [
        {
          id: "c0ffee",
          name: CONTEXT_NAME,
          links: [
            { rel: "self", method: "GET", href: CONTEXT_SELF },
            CREATE_SESSION,
          ],
        },
      ],
    })
    .on("GET", CONTEXT_SELF, {
      id: "c0ffee",
      name: CONTEXT_NAME,
      ...(attributes === undefined ? {} : { attributes }),
    });
}

function adapter(
  client: FakeClient | undefined,
  options?: {
    navigation?: ProfileNavigation;
    showHidden?: boolean;
    attributes?: ContextAttributeCache;
    session?: ComputeSession;
  },
): ServerAdapter {
  const connection: ConnectedSession | undefined =
    client === undefined
      ? undefined
      : {
          client,
          session: options?.session ?? session(),
          context: CONTEXT_NAME,
        };
  return new ServerAdapter({ current: () => connection }, "profile-1", {
    navigation: options?.navigation ?? {},
    showHidden: options?.showHidden ?? false,
    attributes: options?.attributes ?? new ContextAttributeCache(),
  });
}

function value<T>(result: ServerResult<T>): T {
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.value;
}

function problem(result: ServerResult<unknown>) {
  assert.ok(!result.ok, "expected a failure");
  return result.problem;
}

const TMP = `${FILES}/~fs~tmp`;
const FILE = `${TMP}~fs~x.py`;

function tmpFolder(): ServerItem {
  return {
    name: "tmp",
    path: "/tmp",
    isDirectory: true,
    readOnly: false,
    size: 4096,
    modifiedAt: undefined,
    links: directoryLinks(TMP),
  };
}

describe("ServerAdapter: no session", () => {
  it("reports not-connected from every call, without a request", async () => {
    const subject = adapter(undefined);
    for (const result of [
      await subject.getRoot(),
      await subject.getChildren(tmpFolder()),
      await subject.stat("/tmp"),
      await subject.readFile("/tmp/x.py"),
      await subject.writeFile("/tmp/x.py", new Uint8Array(), '"e"'),
    ]) {
      assert.deepEqual(problem(result), { code: "not-connected" });
    }
  });
});

describe("ServerAdapter.getRoot", () => {
  it("starts USER at / through the one composed URL, labelled Home", async () => {
    const client = contextClient().on(
      "GET",
      `${FILES}/~fs~`,
      folderJson("", "/", `${FILES}/~fs~`),
    );
    const root = value(await adapter(client).getRoot());
    assert.deepEqual(root.root, {
      path: "/",
      label: "Home",
      setBy: "profile",
      custom: false,
    });
    assert.equal(root.item.path, "/");
    assert.equal(root.item.readOnly, true);
    const last = client.requests.at(-1);
    assert.equal(last?.link.type, FILE_PROPERTIES_TYPE);
  });

  it("reads the context's attributes once per session, and lets them win", async () => {
    const attributes = new ContextAttributeCache();
    const client = contextClient({
      fileNavigationRoot: "CUSTOM",
      fileNavigationCustomRootPath: "/mnt/shared",
    }).on(
      "GET",
      `${FILES}/~fs~mnt~fs~shared`,
      folderJson("shared", "/mnt", `${FILES}/~fs~mnt~fs~shared`),
    );
    const subject = adapter(client, {
      navigation: { root: "SYSTEM" },
      attributes,
    });
    const first = value(await subject.getRoot());
    assert.deepEqual(first.root, {
      path: "/mnt/shared",
      label: "shared",
      setBy: "context",
      custom: true,
    });
    await subject.getRoot();
    assert.equal(
      client.hrefs().filter((href) => href === CONTEXT_SELF).length,
      1,
    );
  });

  it("uses the profile's setting when the context is not found", async () => {
    const client = new FakeClient()
      .on("GET", CONTEXTS_QUERY, { items: [] })
      .on(
        "GET",
        `${FILES}/~fs~srv`,
        folderJson("srv", "/", `${FILES}/~fs~srv`),
      );
    const root = value(
      await adapter(client, {
        navigation: { root: "CUSTOM", customPath: "/srv" },
      }).getRoot(),
    );
    assert.equal(root.root.setBy, "profile");
    assert.equal(root.item.path, "/srv");
  });

  it("fails when the context cannot be read, rather than guess a root", async () => {
    const client = new FakeClient().on("GET", CONTEXTS_QUERY, () =>
      rejected(403),
    );
    assert.equal(problem(await adapter(client).getRoot()).code, "compute");
  });

  it("fails when the context or the session carries no self link", async () => {
    const noContextSelf = new FakeClient().on("GET", CONTEXTS_QUERY, {
      items: [{ id: "c0ffee", name: CONTEXT_NAME, links: [CREATE_SESSION] }],
    });
    assert.deepEqual(problem(await adapter(noContextSelf).getRoot()), {
      code: "compute",
      problem: {
        code: "link-missing",
        rel: "self",
        resource: `compute context "${CONTEXT_NAME}"`,
      },
    });

    const noSessionSelf = contextClient();
    assert.deepEqual(
      problem(await adapter(noSessionSelf, { session: session([]) }).getRoot()),
      {
        code: "compute",
        problem: {
          code: "link-missing",
          rel: "self",
          resource: `compute session "${SESSION_ID}"`,
        },
      },
    );
  });

  it("fails when the context detail cannot be read", async () => {
    const client = contextClient().on("GET", CONTEXT_SELF, () => rejected(500));
    assert.equal(problem(await adapter(client).getRoot()).code, "compute");
  });

  it("names the setting when a custom root is not there (Finding 13.21)", async () => {
    const client = contextClient()
      .on("GET", `${FILES}/~fs~nope`, () => rejected(404))
      .on("GET", `${SESSION}/state?wait=0`, ok("idle"));
    assert.deepEqual(
      problem(
        await adapter(client, {
          navigation: { root: "CUSTOM", customPath: "/nope" },
        }).getRoot(),
      ),
      {
        code: "path-not-found",
        path: "/nope",
        error: { status: 404, message: "Not Found" },
        root: { setBy: "profile" },
      },
    );
  });

  it("reads a 404 as the session gone when its state is gone too (Finding 13.29)", async () => {
    const client = contextClient()
      .on("GET", `${FILES}/~fs~`, () => rejected(404))
      .on("GET", `${SESSION}/state?wait=0`, () => rejected(404));
    const found = problem(await adapter(client).getRoot());
    assert.equal(found.code, "compute");
    assert.equal(found.problem.code, "session-gone");
  });

  it("refuses a root that is a file, or that is not a properties body", async () => {
    const file = contextClient().on(
      "GET",
      `${FILES}/~fs~`,
      fileJson("x", "/", `${FILES}/~fs~`),
    );
    assert.deepEqual(problem(await adapter(file).getRoot()), {
      code: "wrong-kind",
      path: "/",
      expected: "folder",
    });

    const malformed = contextClient().on("GET", `${FILES}/~fs~`, {
      unexpected: true,
    });
    const found = problem(await adapter(malformed).getRoot());
    assert.equal(
      found.code === "compute" ? found.problem.code : undefined,
      "response-malformed",
    );
  });
});

describe("ServerAdapter.getChildren", () => {
  it("follows the folder's own link and next, with showAll on every page (Finding 13.22)", async () => {
    const first = `${TMP}/members?limit=${String(MEMBERS_PAGE_LIMIT)}&showAll=true`;
    const next = `${TMP}/members?limit=2&start=2`;
    const client = new FakeClient()
      .on("GET", first, {
        count: 3,
        items: [
          fileJson("b.py", "/tmp", `${TMP}~fs~b.py`),
          folderJson("z", "/tmp", `${TMP}~fs~z`),
        ],
        links: [{ rel: "next", method: "GET", href: next }],
      })
      .on("GET", `${next}&showAll=true`, {
        count: 3,
        items: [fileJson(".hidden", "/tmp", `${TMP}~fs~.hidden`), { bad: 1 }],
        links: [],
      });
    const listing = value(
      await adapter(client, { showHidden: true }).getChildren(tmpFolder()),
    );
    assert.deepEqual(
      listing.items.map((item) => item.path),
      ["/tmp/z", "/tmp/.hidden", "/tmp/b.py"],
    );
    assert.equal(listing.truncated, false);
    for (const request of client.requests) {
      assert.equal(request.link.type, "application/vnd.sas.collection");
    }
  });

  it("asks for showAll=false by default, and keeps one the server sent", async () => {
    const client = new FakeClient().on(
      "GET",
      `${TMP}/members?limit=${String(MEMBERS_PAGE_LIMIT)}&showAll=false`,
      {
        items: [],
        links: [
          {
            rel: "next",
            method: "GET",
            href: `${TMP}/members?start=1&showAll=false`,
          },
        ],
      },
    );
    client.on("GET", `${TMP}/members?start=1&showAll=false`, {
      items: [],
      links: [],
    });
    assert.deepEqual(value(await adapter(client).getChildren(tmpFolder())), {
      items: [],
      truncated: false,
    });
  });

  it("stops after MAX_MEMBER_PAGES when next never ends, and says so", async () => {
    const loop = `${TMP}/members?limit=${String(MEMBERS_PAGE_LIMIT)}&showAll=false`;
    const client = new FakeClient().on("GET", loop, {
      items: [fileJson("a.py", "/tmp", `${TMP}~fs~a.py`)],
      links: [{ rel: "next", method: "GET", href: loop }],
    });
    const listing = value(await adapter(client).getChildren(tmpFolder()));
    assert.equal(client.requests.length, MAX_MEMBER_PAGES);
    assert.equal(listing.truncated, true);
    assert.equal(listing.items.length, MAX_MEMBER_PAGES);
  });

  it("fails on a folder with no members link, or a page with no items", async () => {
    assert.deepEqual(
      problem(
        await adapter(new FakeClient()).getChildren({
          ...tmpFolder(),
          links: [],
        }),
      ),
      {
        code: "compute",
        problem: {
          code: "link-missing",
          rel: "getDirectoryMembers",
          resource: 'folder "/tmp"',
        },
      },
    );

    const client = new FakeClient().on(
      "GET",
      `${TMP}/members?limit=${String(MEMBERS_PAGE_LIMIT)}&showAll=false`,
      { count: 0 },
    );
    const found = problem(await adapter(client).getChildren(tmpFolder()));
    assert.equal(
      found.code === "compute" ? found.problem.code : undefined,
      "response-malformed",
    );
  });

  it("reads a 404 with the session alive as the folder gone", async () => {
    const client = new FakeClient()
      .on(
        "GET",
        `${TMP}/members?limit=${String(MEMBERS_PAGE_LIMIT)}&showAll=false`,
        () => rejected(404),
      )
      .on("GET", `${SESSION}/state?wait=0`, ok("idle"));
    assert.equal(
      problem(await adapter(client).getChildren(tmpFolder())).code,
      "path-not-found",
    );
  });

  it("passes any other failure through", async () => {
    const client = new FakeClient().on(
      "GET",
      `${TMP}/members?limit=${String(MEMBERS_PAGE_LIMIT)}&showAll=false`,
      () => rejected(403),
    );
    assert.equal(
      problem(await adapter(client).getChildren(tmpFolder())).code,
      "compute",
    );
  });
});

describe("ServerAdapter.stat and readFile", () => {
  it("stats a path through the composed URL", async () => {
    const client = new FakeClient().on(
      "GET",
      FILE,
      fileJson("x.py", "/tmp", FILE),
    );
    const item = value(await adapter(client).stat("/tmp/x.py"));
    assert.equal(item.path, "/tmp/x.py");
    assert.equal(item.size, 12);
  });

  it("passes the caller's signal to the session check a 404 makes", async () => {
    const controller = new AbortController();
    const client = new FakeClient()
      .on("GET", FILE, () => rejected(404))
      .on("GET", `${SESSION}/state?wait=0`, ok("idle"));
    await adapter(client).stat("/tmp/x.py", { signal: controller.signal });
    assert.deepEqual(
      client.requests.map((request) => request.signal),
      [controller.signal, controller.signal],
    );
  });

  it("passes a failed stat through", async () => {
    const client = new FakeClient().on("GET", FILE, () => rejected(401));
    assert.equal(
      problem(await adapter(client).stat("/tmp/x.py")).code,
      "compute",
    );
  });

  it("reads bytes by the file's getFile link, capped, with the content's ETag", async () => {
    const bytes = new Uint8Array([0, 255, 10]);
    const client = new FakeClient()
      .on("GET", FILE, () =>
        ok(fileJson("x.py", "/tmp", FILE), { etag: '"props"' }),
      )
      .on("GET", `${FILE}/content`, () =>
        ok("", {
          rawBody: bytes,
          etag: '"content"',
          contentType: "text/plain",
        }),
      );
    assert.deepEqual(value(await adapter(client).readFile("/tmp/x.py")), {
      bytes,
      etag: '"content"',
    });
    const read = client.requests.at(-1);
    assert.ok(read);
    assert.equal(read.maxBodyBytes, MAX_SERVER_FILE_BYTES);
    // Finding 13.24: the bytes are asked for as octet-stream, not as the
    // link's own `text/plain`. The client turns `responseType` into `Accept`.
    assert.equal(read.link.responseType, FILE_CONTENT_TYPE);
    assert.equal(read.link.type, "text/plain");
  });

  it("falls back to the properties' ETag when the content has none", async () => {
    const client = new FakeClient()
      .on("GET", FILE, () =>
        ok(fileJson("x.py", "/tmp", FILE), { etag: '"props"' }),
      )
      .on("GET", `${FILE}/content`, () =>
        ok("", { rawBody: new Uint8Array() }),
      );
    assert.equal(
      value(await adapter(client).readFile("/tmp/x.py")).etag,
      '"props"',
    );
  });

  it("refuses a folder, and a file over the cap without fetching it", async () => {
    const folder = new FakeClient().on("GET", TMP, folderJson("tmp", "/", TMP));
    assert.deepEqual(problem(await adapter(folder).readFile("/tmp")), {
      code: "wrong-kind",
      path: "/tmp",
      expected: "file",
    });

    const big = new FakeClient().on(
      "GET",
      FILE,
      fileJson("x.py", "/tmp", FILE, MAX_SERVER_FILE_BYTES + 1),
    );
    assert.equal(
      problem(await adapter(big).readFile("/tmp/x.py")).code,
      "too-large",
    );
    assert.equal(big.requests.length, 1);
  });

  it("reads a body over the cap as too large", async () => {
    const client = new FakeClient()
      .on("GET", FILE, fileJson("x.py", "/tmp", FILE))
      .on("GET", `${FILE}/content`, () => ({
        ok: false,
        reason: "too large",
        problem: {
          code: "compute-response-too-large",
          limitBytes: MAX_SERVER_FILE_BYTES,
        },
      }));
    assert.equal(
      problem(await adapter(client).readFile("/tmp/x.py")).code,
      "too-large",
    );
  });

  it("fails with no getFile link, no raw bytes, or a failed fetch", async () => {
    const noLink = new FakeClient().on("GET", FILE, {
      ...fileJson("x.py", "/tmp", FILE),
      links: [],
    });
    assert.equal(
      problem(await adapter(noLink).readFile("/tmp/x.py")).code,
      "compute",
    );

    const noBytes = new FakeClient()
      .on("GET", FILE, fileJson("x.py", "/tmp", FILE))
      .on("GET", `${FILE}/content`, ok("text"));
    const found = problem(await adapter(noBytes).readFile("/tmp/x.py"));
    assert.equal(
      found.code === "compute" ? found.problem.code : undefined,
      "response-malformed",
    );

    const gone = new FakeClient()
      .on("GET", FILE, fileJson("x.py", "/tmp", FILE))
      .on("GET", `${FILE}/content`, () => rejected(404))
      .on("GET", `${SESSION}/state?wait=0`, ok("idle"));
    assert.equal(
      problem(await adapter(gone).readFile("/tmp/x.py")).code,
      "path-not-found",
    );

    const missing = new FakeClient()
      .on("GET", FILE, () => rejected(404))
      .on("GET", `${SESSION}/state?wait=0`, ok("idle"));
    assert.equal(
      problem(await adapter(missing).readFile("/tmp/x.py")).code,
      "path-not-found",
    );
  });
});

describe("ServerAdapter.writeFile", () => {
  it("PUTs raw bytes to createFile with the editor's ETag, not a fresh one (Findings 13.24, 13.26)", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const client = new FakeClient()
      .on("GET", FILE, () =>
        ok(fileJson("x.py", "/tmp", FILE), { etag: '"current"' }),
      )
      .on("PUT", `${FILE}/content`, () =>
        ok(fileJson("x.py", "/tmp", FILE), { etag: '"next"' }),
      );
    assert.equal(
      value(await adapter(client).writeFile("/tmp/x.py", bytes, '"opened"')),
      '"next"',
    );
    const put = client.requests.at(-1);
    assert.ok(put);
    assert.equal(put.link.type, FILE_CONTENT_TYPE);
    assert.equal(put.etag, '"opened"');
    assert.equal(put.rawBody, bytes);
  });

  it("reads a 412 as changed on the server", async () => {
    const client = new FakeClient()
      .on("GET", FILE, fileJson("x.py", "/tmp", FILE))
      .on("PUT", `${FILE}/content`, () => rejected(412));
    assert.deepEqual(
      problem(
        await adapter(client).writeFile("/tmp/x.py", new Uint8Array(), '"o"'),
      ),
      {
        code: "changed-on-server",
        path: "/tmp/x.py",
        error: { status: 412, message: "Not Found" },
      },
    );
  });

  it("refuses a folder, a missing createFile link, and a failed lookup", async () => {
    const folder = new FakeClient().on("GET", TMP, folderJson("tmp", "/", TMP));
    assert.equal(
      problem(await adapter(folder).writeFile("/tmp", new Uint8Array(), '"o"'))
        .code,
      "wrong-kind",
    );

    const noLink = new FakeClient().on("GET", FILE, {
      ...fileJson("x.py", "/tmp", FILE),
      links: [],
    });
    assert.equal(
      problem(
        await adapter(noLink).writeFile("/tmp/x.py", new Uint8Array(), '"o"'),
      ).code,
      "compute",
    );

    const lookup = new FakeClient().on("GET", FILE, () => rejected(500));
    assert.equal(
      problem(
        await adapter(lookup).writeFile("/tmp/x.py", new Uint8Array(), '"o"'),
      ).code,
      "compute",
    );
  });

  it("passes another failed write through", async () => {
    const client = new FakeClient()
      .on("GET", FILE, fileJson("x.py", "/tmp", FILE))
      .on("PUT", `${FILE}/content`, () => rejected(403));
    assert.equal(
      problem(
        await adapter(client).writeFile("/tmp/x.py", new Uint8Array(), '"o"'),
      ).code,
      "compute",
    );
  });
});

describe("ServerAdapter.getRoot: allowDownload", () => {
  async function allowDownloadFor(attributes?: Record<string, unknown>) {
    const client = contextClient(attributes).on(
      "GET",
      `${FILES}/~fs~`,
      folderJson("", "/", `${FILES}/~fs~`),
    );
    return value(await adapter(client).getRoot()).allowDownload;
  }

  it("allows downloads unless the context says false, in any case, as upstream reads it", async () => {
    assert.equal(await allowDownloadFor(), true);
    assert.equal(await allowDownloadFor({ allowDownload: "true" }), true);
    assert.equal(await allowDownloadFor({ allowDownload: "yes" }), true);
    assert.equal(await allowDownloadFor({ allowDownload: "False" }), false);
    assert.equal(await allowDownloadFor({ allowDownload: false }), false);
  });
});

/** The write relations Findings 13.20, 13.22 and 13.32 recorded on a folder
 * and on a file. */
function writableFolderLinks(href: string): Link[] {
  return [
    ...directoryLinks(href),
    { rel: "makeDirectory", method: "POST", href, type: FILE_PROPERTIES_TYPE },
    { rel: "createFile", method: "POST", href, type: FILE_PROPERTIES_TYPE },
    {
      rel: "renameDirectory",
      method: "PUT",
      href,
      type: FILE_PROPERTIES_TYPE,
      responseType: FILE_PROPERTIES_TYPE,
    },
    { rel: "deleteDirectory", method: "DELETE", href },
  ];
}

function writableFileLinks(href: string): Link[] {
  return [
    ...fileLinks(href),
    {
      rel: "renameFile",
      method: "PUT",
      href,
      type: FILE_PROPERTIES_TYPE,
      responseType: FILE_PROPERTIES_TYPE,
    },
    { rel: "deleteFile", method: "DELETE", href },
  ];
}

function writableFolder(path: string, href: string): ServerItem {
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    isDirectory: true,
    readOnly: false,
    size: 4096,
    modifiedAt: undefined,
    links: writableFolderLinks(href),
  };
}

function writableFile(path: string, href: string): ServerItem {
  return {
    ...writableFolder(path, href),
    isDirectory: false,
    size: 3,
    links: writableFileLinks(href),
  };
}

function fileBody(name: string, parent: string, href: string) {
  return { ...fileJson(name, parent, href), links: writableFileLinks(href) };
}

function folderBody(name: string, parent: string, href: string) {
  return {
    ...folderJson(name, parent, href),
    links: writableFolderLinks(href),
  };
}

/** The `200` a rename answers with a missing or stale `If-Match` (Findings
 * 13.25 and 13.32), scrubbed. */
function embeddedFailure(inner: number, errorCode: number) {
  return {
    httpStatusCode: 0,
    errorCode,
    message:
      "The updated resource is not based on the most recently saved version of the resource.",
    details: [],
    errors: [
      {
        version: 2,
        httpStatusCode: inner,
        errorCode,
        message: "inner",
        details: ["The given If-Match header does not match."],
      },
    ],
  };
}

const TMP_FOLDER = writableFolder("/tmp", TMP);
const NEW_DIR = `${TMP}~fs~new`;
const NEW_FILE = `${TMP}~fs~new.py`;

describe("ServerAdapter.createFolder and createFile", () => {
  it("POSTs {name, isDirectory} to the folder's makeDirectory link (Finding 13.24)", async () => {
    const client = new FakeClient().on("POST", TMP, (request) => {
      assert.deepEqual(request.body, { name: "new", isDirectory: true });
      return ok(folderBody("new", "/tmp", NEW_DIR), { etag: '"t1"' });
    });
    const created = value(
      await adapter(client).createFolder(TMP_FOLDER, "new"),
    );
    assert.equal(created.path, "/tmp/new");
    assert.equal(created.isDirectory, true);
    const post = client.requests[0];
    assert.equal(post?.link.rel, "makeDirectory");
    assert.equal(post.link.type, FILE_PROPERTIES_TYPE);
    assert.equal(post.link.responseType, FILE_PROPERTIES_TYPE);
  });

  it("creates an empty file by the folder's createFile link, with no write", async () => {
    const client = new FakeClient().on("POST", TMP, (request) => {
      assert.deepEqual(request.body, { name: "new.py", isDirectory: false });
      return ok(fileBody("new.py", "/tmp", NEW_FILE), { etag: '"t1"' });
    });
    const created = value(
      await adapter(client).createFile(TMP_FOLDER, "new.py"),
    );
    assert.equal(created.path, "/tmp/new.py");
    assert.equal(client.requests.length, 1);
    assert.equal(client.requests[0]?.link.rel, "createFile");
  });

  it("writes an upload's bytes with the create's own ETag (Finding 13.34)", async () => {
    const bytes = new Uint8Array([104, 105]);
    const signal = new AbortController().signal;
    const client = new FakeClient()
      .on("POST", TMP, () =>
        ok(fileBody("new.py", "/tmp", NEW_FILE), { etag: '"t1"' }),
      )
      .on("PUT", `${NEW_FILE}/content`, () =>
        ok(fileBody("new.py", "/tmp", NEW_FILE), { etag: '"t2"' }),
      );
    value(
      await adapter(client).createFile(TMP_FOLDER, "new.py", bytes, {
        signal,
      }),
    );
    const put = client.requests[1];
    assert.equal(put?.etag, '"t1"');
    assert.equal(put.rawBody, bytes);
    assert.equal(put.link.type, FILE_CONTENT_TYPE);
    assert.equal(put.timeoutMs, SERVER_TRANSFER_TIMEOUT_MS);
    assert.equal(put.signal, signal);
  });

  it("deletes the empty file with the create's ETag when the bytes fail, and returns why they failed", async () => {
    const client = new FakeClient()
      .on("POST", TMP, () =>
        ok(fileBody("new.py", "/tmp", NEW_FILE), { etag: '"t1"' }),
      )
      .on("PUT", `${NEW_FILE}/content`, () => rejected(412))
      .on("DELETE", NEW_FILE, () => ({
        ok: true,
        value: { status: 204, notModified: false, text: "", body: undefined },
      }));
    const found = problem(
      await adapter(client).createFile(
        TMP_FOLDER,
        "new.py",
        new Uint8Array([1]),
      ),
    );
    assert.equal(found.code, "changed-on-server");
    const discard = client.requests[2];
    assert.equal(discard?.link.method, "DELETE");
    assert.equal(discard.etag, '"t1"');
    assert.equal(discard.timeoutMs, DISCARD_TIMEOUT_MS);
    assert.equal(discard.signal, undefined);
  });

  it("says an empty file was left when it cannot be deleted again", async () => {
    const client = new FakeClient()
      .on("POST", TMP, () =>
        ok(fileBody("new.py", "/tmp", NEW_FILE), { etag: '"t1"' }),
      )
      .on("PUT", `${NEW_FILE}/content`, () => rejected(403))
      .on("DELETE", NEW_FILE, () => rejected(403));
    const found = problem(
      await adapter(client).createFile(
        TMP_FOLDER,
        "new.py",
        new Uint8Array([1]),
      ),
    );
    assert.equal(found.code, "left-empty");
    assert.equal(found.path, "/tmp/new.py");
    assert.equal(found.cause.code, "compute");
  });

  it("cannot write or discard a created file whose reply carried no ETag", async () => {
    const client = new FakeClient().on(
      "POST",
      TMP,
      fileBody("new.py", "/tmp", NEW_FILE),
    );
    const found = problem(
      await adapter(client).createFile(
        TMP_FOLDER,
        "new.py",
        new Uint8Array([1]),
      ),
    );
    assert.equal(found.code, "left-empty");
    assert.equal(found.cause.code, "no-version");
    assert.equal(client.requests.length, 1);
  });

  it("reads a 409 as the name taken (Finding 13.24)", async () => {
    const client = new FakeClient().on("POST", TMP, () => rejected(409));
    const found = problem(
      await adapter(client).createFolder(TMP_FOLDER, "new"),
    );
    assert.equal(found.code, "name-taken");
    assert.equal(found.path, "/tmp/new");
  });

  it("reads a 404 with the session alive as the folder gone", async () => {
    const client = new FakeClient()
      .on("POST", TMP, () => rejected(404))
      .on("GET", `${SESSION}/state?wait=0`, ok("idle"));
    const found = problem(
      await adapter(client).createFolder(TMP_FOLDER, "new"),
    );
    assert.equal(found.code, "path-not-found");
    assert.equal(found.path, "/tmp");
  });

  it("refuses a bad name, a file as the parent, and a missing link, before sending", async () => {
    const client = new FakeClient();
    const subject = adapter(client);
    assert.equal(
      problem(await subject.createFolder(TMP_FOLDER, "a/b")).code,
      "invalid-name",
    );
    assert.equal(
      problem(await subject.createFile(writableFile("/tmp/x.py", FILE), "y.py"))
        .code,
      "wrong-kind",
    );
    assert.equal(
      problem(await subject.createFolder({ ...TMP_FOLDER, links: [] }, "new"))
        .code,
      "compute",
    );
    assert.deepEqual(client.requests, []);
  });

  it("refuses a reply that does not name the new item where it was asked for", async () => {
    const client = new FakeClient().on(
      "POST",
      TMP,
      folderBody("other", "/tmp", NEW_DIR),
    );
    const found = problem(
      await adapter(client).createFolder(TMP_FOLDER, "new"),
    );
    assert.equal(found.code, "compute");
    assert.equal(found.problem.code, "response-malformed");
  });

  it("reports not-connected with no session", async () => {
    assert.equal(
      problem(await adapter(undefined).createFolder(TMP_FOLDER, "new")).code,
      "not-connected",
    );
    assert.equal(
      problem(await adapter(undefined).createFile(TMP_FOLDER, "new")).code,
      "not-connected",
    );
  });
});

describe("ServerAdapter.rename and move", () => {
  const X = writableFile("/tmp/x.py", FILE);
  const RENAMED = `${TMP}~fs~y.py`;

  function renameClient(reply: Parameters<FakeClient["on"]>[2]): FakeClient {
    return new FakeClient()
      .on("GET", FILE, () =>
        ok(fileBody("x.py", "/tmp", FILE), { etag: '"now"' }),
      )
      .on("PUT", FILE, reply);
  }

  it("PUTs {name, path} with the item's current ETag, read by its self link (Findings 13.25, 13.32)", async () => {
    const client = renameClient((request) => {
      assert.deepEqual(request.body, { name: "y.py", path: "/tmp" });
      return ok(fileBody("y.py", "/tmp", RENAMED));
    });
    const renamed = value(await adapter(client).rename(X, "y.py"));
    assert.equal(renamed.path, "/tmp/y.py");
    const [get, put] = client.requests;
    assert.equal(get?.link.method, "GET");
    assert.equal(get.link.type, FILE_PROPERTIES_TYPE);
    assert.equal(put?.link.rel, "renameFile");
    assert.equal(put.etag, '"now"');
    assert.equal(put.link.responseType, FILE_PROPERTIES_TYPE);
  });

  it("renames a folder by its renameDirectory link", async () => {
    const DIR = `${TMP}~fs~d`;
    const client = new FakeClient()
      .on("GET", DIR, () => ok(folderBody("d", "/tmp", DIR), { etag: '"d"' }))
      .on("PUT", DIR, () => ok(folderBody("e", "/tmp", `${TMP}~fs~e`)));
    value(await adapter(client).rename(writableFolder("/tmp/d", DIR), "e"));
    assert.equal(client.requests[1]?.link.rel, "renameDirectory");
  });

  it("reads a 200 with an error body by its inner status: 412 as changed (Finding 13.32)", async () => {
    const client = renameClient(() => ok(embeddedFailure(412, 5034)));
    const found = problem(await adapter(client).rename(X, "y.py"));
    assert.equal(found.code, "changed-on-server");
    assert.equal(found.path, "/tmp/x.py");
    assert.equal(found.error.status, 412);
    assert.equal(found.error.errorCode, 5034);
  });

  it("reads any other error body as refused, never as a rename (Finding 13.25)", async () => {
    const client = renameClient(() => ok(embeddedFailure(428, 5033)));
    const found = problem(await adapter(client).rename(X, "y.py"));
    assert.equal(found.code, "compute");
    assert.equal(found.problem.code, "compute-rejected");
    assert.equal(found.problem.error.status, 428);
  });

  it("falls back to the outer status, then the wire's, when the error body has no inner one", async () => {
    const outer = renameClient(() =>
      ok({ httpStatusCode: 409, errorCode: 5451, message: "exists" }),
    );
    assert.equal(
      problem(await adapter(outer).rename(X, "y.py")).code,
      "name-taken",
    );

    const none = renameClient(() =>
      ok({ httpStatusCode: 0, errorCode: 1, errors: ["not an object"] }),
    );
    const found = problem(await adapter(none).rename(X, "y.py"));
    assert.equal(found.code, "compute");
    assert.equal(found.problem.code, "compute-rejected");
    assert.equal(found.problem.error.status, 200);
  });

  it("refuses an empty reply, or one naming another path, as malformed (Finding 13.32)", async () => {
    const empty = renameClient(() => ok(""));
    const first = problem(await adapter(empty).rename(X, "y.py"));
    assert.equal(first.code, "compute");
    assert.equal(first.problem.code, "response-malformed");

    const elsewhere = renameClient(() =>
      ok(fileBody("y.py", "/opt/sas/work", `${FILES}/~fs~opt~fs~y.py`)),
    );
    const second = problem(await adapter(elsewhere).rename(X, "y.py"));
    assert.equal(second.code, "compute");
    assert.equal(second.problem.code, "response-malformed");
  });

  it("reads a 409 as the name taken at the new path (Finding 13.31)", async () => {
    const client = renameClient(() => rejected(409));
    const found = problem(await adapter(client).rename(X, "y.py"));
    assert.equal(found.code, "name-taken");
    assert.equal(found.path, "/tmp/y.py");
  });

  it("refuses without an ETag, a self link or a rename link", async () => {
    const noTag = new FakeClient().on(
      "GET",
      FILE,
      fileBody("x.py", "/tmp", FILE),
    );
    assert.equal(
      problem(await adapter(noTag).rename(X, "y.py")).code,
      "no-version",
    );

    assert.equal(
      problem(await adapter(new FakeClient()).rename({ ...X, links: [] }, "y"))
        .code,
      "compute",
    );

    const noRename = new FakeClient().on("GET", FILE, () =>
      ok(fileJson("x.py", "/tmp", FILE), { etag: '"now"' }),
    );
    const found = problem(await adapter(noRename).rename(X, "y.py"));
    assert.equal(found.code, "compute");
    assert.equal(found.problem.code, "link-missing");
  });

  it("reads a gone item, or a properties read it cannot place, before sending anything", async () => {
    const gone = new FakeClient()
      .on("GET", FILE, () => rejected(404))
      .on("GET", `${SESSION}/state?wait=0`, ok("idle"));
    assert.equal(
      problem(await adapter(gone).rename(X, "y.py")).code,
      "path-not-found",
    );

    const odd = new FakeClient().on("GET", FILE, () =>
      ok({ unexpected: true }, { etag: '"now"' }),
    );
    const found = problem(await adapter(odd).rename(X, "y.py"));
    assert.equal(found.code, "compute");
    assert.equal(found.problem.code, "response-malformed");
  });

  it("refuses a bad name and reports not-connected, before sending", async () => {
    const client = new FakeClient();
    assert.equal(
      problem(await adapter(client).rename(X, "..")).code,
      "invalid-name",
    );
    assert.deepEqual(client.requests, []);
    assert.equal(
      problem(await adapter(undefined).rename(X, "y.py")).code,
      "not-connected",
    );
  });

  it("moves into another folder, keeping the name (Finding 13.25)", async () => {
    const DEST = `${FILES}/~fs~srv`;
    const client = renameClient((request) => {
      assert.deepEqual(request.body, { name: "x.py", path: "/srv" });
      return ok(fileBody("x.py", "/srv", `${DEST}~fs~x.py`));
    });
    const moved = value(
      await adapter(client).move(X, writableFolder("/srv", DEST)),
    );
    assert.equal(moved.path, "/srv/x.py");
  });

  it("refuses a move the rule objects to, before sending (Finding 13.31)", async () => {
    const client = new FakeClient();
    const subject = adapter(client);
    const into = problem(await subject.move(X, TMP_FOLDER));
    assert.deepEqual(into, {
      code: "invalid-move",
      path: "/tmp/x.py",
      target: "/tmp",
    });
    assert.equal(
      problem(await subject.move(X, writableFile("/srv/y.py", FILE))).code,
      "wrong-kind",
    );
    assert.deepEqual(client.requests, []);
  });

  it("reads a 404 on a move as the item gone, when the session is alive (Finding 13.31)", async () => {
    const client = renameClient(() => rejected(404)).on(
      "GET",
      `${SESSION}/state?wait=0`,
      ok("idle"),
    );
    const found = problem(
      await adapter(client).move(
        X,
        writableFolder("/nope", `${FILES}/~fs~nope`),
      ),
    );
    assert.equal(found.code, "path-not-found");
    assert.equal(found.path, "/tmp/x.py");
  });
});

describe("ServerAdapter.delete", () => {
  const X = writableFile("/tmp/x.py", FILE);
  const noContent = (): ReturnType<Handler> => ({
    ok: true,
    value: { status: 204, notModified: false, text: "", body: undefined },
  });

  it("DELETEs by deleteFile with the current ETag (Finding 13.26)", async () => {
    const signal = new AbortController().signal;
    const client = new FakeClient()
      .on("GET", FILE, () =>
        ok(fileBody("x.py", "/tmp", FILE), { etag: '"now"' }),
      )
      .on("DELETE", FILE, noContent);
    value(await adapter(client).delete(X, { signal }));
    const del = client.requests[1];
    assert.equal(del?.link.rel, "deleteFile");
    assert.equal(del.etag, '"now"');
    assert.equal(del.signal, signal);
  });

  it("deletes a folder by deleteDirectory (Finding 13.33)", async () => {
    const DIR = `${TMP}~fs~d`;
    const client = new FakeClient()
      .on("GET", DIR, () => ok(folderBody("d", "/tmp", DIR), { etag: '"d"' }))
      .on("DELETE", DIR, noContent);
    value(await adapter(client).delete(writableFolder("/tmp/d", DIR)));
    assert.equal(client.requests[1]?.link.rel, "deleteDirectory");
  });

  it("reads a 412 as changed, and refuses without an ETag or a delete link", async () => {
    const changed = new FakeClient()
      .on("GET", FILE, () =>
        ok(fileBody("x.py", "/tmp", FILE), { etag: '"now"' }),
      )
      .on("DELETE", FILE, () => rejected(412));
    assert.equal(
      problem(await adapter(changed).delete(X)).code,
      "changed-on-server",
    );

    const noTag = new FakeClient().on(
      "GET",
      FILE,
      fileBody("x.py", "/tmp", FILE),
    );
    assert.equal(problem(await adapter(noTag).delete(X)).code, "no-version");

    const noLink = new FakeClient().on("GET", FILE, () =>
      ok(fileJson("x.py", "/tmp", FILE), { etag: '"now"' }),
    );
    assert.equal(problem(await adapter(noLink).delete(X)).code, "compute");
  });

  it("reads a 404 on the delete itself as the session gone when its state is gone too", async () => {
    const client = new FakeClient()
      .on("GET", FILE, () =>
        ok(fileBody("x.py", "/tmp", FILE), { etag: '"now"' }),
      )
      .on("DELETE", FILE, () => rejected(404))
      .on("GET", `${SESSION}/state?wait=0`, () => rejected(404));
    const found = problem(await adapter(client).delete(X));
    assert.equal(found.code, "compute");
    assert.equal(found.problem.code, "session-gone");
  });

  it("reports not-connected with no session", async () => {
    assert.equal(
      problem(await adapter(undefined).delete(X)).code,
      "not-connected",
    );
  });
});

describe("ServerAdapter.downloadFile", () => {
  const X = writableFile("/tmp/x.py", FILE);

  it("reads the bytes by getFile, as octet-stream, capped, with the transfer timeout", async () => {
    const bytes = new Uint8Array([0, 255]);
    const client = new FakeClient().on("GET", `${FILE}/content`, () =>
      ok("", { rawBody: bytes, contentType: FILE_CONTENT_TYPE }),
    );
    assert.equal(value(await adapter(client).downloadFile(X)), bytes);
    const request = client.requests[0];
    assert.equal(request?.link.responseType, FILE_CONTENT_TYPE);
    assert.equal(request.maxBodyBytes, MAX_SERVER_TRANSFER_BYTES);
    assert.equal(request.timeoutMs, SERVER_TRANSFER_TIMEOUT_MS);
  });

  it("refuses a folder, and a file listed over the cap, without fetching", async () => {
    const client = new FakeClient();
    assert.equal(
      problem(await adapter(client).downloadFile(TMP_FOLDER)).code,
      "wrong-kind",
    );
    const found = problem(
      await adapter(client).downloadFile({
        ...X,
        size: MAX_SERVER_TRANSFER_BYTES + 1,
      }),
    );
    assert.equal(found.code, "too-large");
    assert.equal(found.limitBytes, MAX_SERVER_TRANSFER_BYTES);
    assert.deepEqual(client.requests, []);
  });

  it("reads a body over the cap as too large, at the transfer limit", async () => {
    const client = new FakeClient().on("GET", `${FILE}/content`, () => ({
      ok: false,
      reason: "too large",
      problem: {
        code: "compute-response-too-large",
        limitBytes: MAX_SERVER_TRANSFER_BYTES,
      },
    }));
    const found = problem(
      await adapter(client).downloadFile({ ...X, size: undefined }),
    );
    assert.equal(found.code, "too-large");
    assert.equal(found.size, MAX_SERVER_TRANSFER_BYTES + 1);
    assert.equal(found.limitBytes, MAX_SERVER_TRANSFER_BYTES);
  });

  it("fails with no getFile link, no raw bytes, or a failed fetch", async () => {
    const client = new FakeClient();
    assert.equal(
      problem(await adapter(client).downloadFile({ ...X, links: [] })).code,
      "compute",
    );

    const noBytes = new FakeClient().on("GET", `${FILE}/content`, () =>
      ok("text"),
    );
    assert.equal(
      problem(await adapter(noBytes).downloadFile(X)).code,
      "compute",
    );

    const gone = new FakeClient()
      .on("GET", `${FILE}/content`, () => rejected(404))
      .on("GET", `${SESSION}/state?wait=0`, ok("idle"));
    assert.equal(
      problem(await adapter(gone).downloadFile(X)).code,
      "path-not-found",
    );
  });

  it("reports not-connected with no session", async () => {
    assert.equal(
      problem(await adapter(undefined).downloadFile(X)).code,
      "not-connected",
    );
  });
});

describe("ContextAttributeCache", () => {
  it("forgets everything on clear", () => {
    const cache = new ContextAttributeCache();
    cache.set("s", null);
    assert.equal(cache.get("s"), null);
    cache.clear();
    assert.equal(cache.get("s"), undefined);
  });
});
