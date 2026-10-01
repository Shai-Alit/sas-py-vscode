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
  FILE_CONTENT_TYPE,
  FILE_PROPERTIES_TYPE,
  MAX_MEMBER_PAGES,
  MAX_SERVER_FILE_BYTES,
  MEMBERS_PAGE_LIMIT,
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

describe("ContextAttributeCache", () => {
  it("forgets everything on clear", () => {
    const cache = new ContextAttributeCache();
    cache.set("s", null);
    assert.equal(cache.get("s"), null);
    cache.clear();
    assert.equal(cache.get("s"), undefined);
  });
});
