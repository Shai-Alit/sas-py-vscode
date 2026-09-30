// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  FILEREF_NAME_PATTERN,
  STARTUP_FILEREF_NAME,
} from "../../src/backend/procPython";
import {
  type ComputeClient,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
} from "../../src/compute/client";
import {
  DEFAULT_CAS_TOKEN_FILEREF,
  isOwnTokenFileref,
  normaliseCasTokenFilerefName,
  writeCasToken,
} from "../../src/compute/casToken";
import {
  ASSIGN_REL,
  FILEREF_ALREADY_EXISTS_ERROR_CODE,
  FILEREF_LIST_REL,
  FILEREF_SELF_REL,
  FILEREF_UPLOAD_REL,
} from "../../src/compute/fileref";
import { type Link } from "../../src/wire/links";
import { type ComputeSession } from "../../src/compute/session";

/**
 * 8b's own token-delivery module, under a stable name since 12n: create the
 * fileref on first use, rewrite it in place afterwards, and never write into
 * a held fileref this module did not create (Finding 12.25). The Compute
 * calls themselves are `compute-fileref.test.ts`'s contract; this file is
 * `writeCasToken`'s own — which calls it makes, when it refuses, and that
 * the token never appears anywhere but `rawBody`.
 */

const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;
const HOME =
  "/opt/sas/viya/config/var/run/compsrv/default/3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34";
const NAME = "CASTOKEN";

function sessionLinks(): readonly Link[] {
  return [
    {
      method: "POST",
      rel: ASSIGN_REL,
      href: `${SESSION_PATH}/filerefs`,
      type: "application/vnd.sas.compute.fileref.request",
      responseType: "application/vnd.sas.compute.fileref",
    },
    {
      method: "GET",
      rel: FILEREF_LIST_REL,
      href: `${SESSION_PATH}/filerefs`,
      type: "application/vnd.sas.collection",
    },
  ];
}

/** A session; `null` stands for one whose representation carried no
 * `homeDirectory`. */
function session(homeDirectory: string | null = HOME): ComputeSession {
  return {
    id: SESSION_ID,
    state: "idle",
    ...(homeDirectory === null ? {} : { homeDirectory }),
    links: sessionLinks(),
  };
}

function filerefLinks(id: string): readonly Link[] {
  const path = `${SESSION_PATH}/filerefs/${id}`;
  return [
    {
      method: "GET",
      rel: "self",
      href: path,
      type: "application/vnd.sas.compute.fileref",
    },
    {
      method: "PUT",
      rel: "upload",
      href: `${path}/content`,
      type: "application/octet-stream",
    },
  ];
}

function ok(
  body: unknown,
  init?: { status?: number; etag?: string },
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      notModified: false,
      ...(init?.etag === undefined ? {} : { etag: init.etag }),
      contentType: "application/vnd.sas.compute.fileref+json",
      text: JSON.stringify(body),
      body,
    },
  };
}

function rejected(
  status: number,
  errorCode?: number,
): ComputeResult<ComputeResponse> {
  return {
    ok: false,
    reason: `the compute service answered HTTP ${String(status)}`,
    problem: {
      code: "compute-rejected",
      error: {
        status,
        message: "",
        ...(errorCode === undefined ? {} : { errorCode }),
      },
    },
  };
}

/** `assign` of a held name: `400`, `errorCode` 5402 (Finding 12.10). */
function taken(): ComputeResult<ComputeResponse> {
  return rejected(400, FILEREF_ALREADY_EXISTS_ERROR_CODE);
}

interface Fake {
  readonly requests: ComputeRequest[];
  readonly client: ComputeClient;
}

function fake(replies: readonly ComputeResult<ComputeResponse>[]): Fake {
  const requests: ComputeRequest[] = [];
  const client: ComputeClient = {
    send: (request) => {
      const index = requests.length;
      requests.push(request);
      const reply = replies[index];
      assert.ok(
        reply !== undefined,
        `the module sent ${String(index + 1)} requests and the script had fewer replies`,
      );
      return Promise.resolve(reply);
    },
  };
  return { requests, client };
}

/** A fileref representation, the fields as Finding 12.25 read them for one
 * this module's own `assign` made. `overrides` swaps any of them. */
function representation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: NAME.toLowerCase(),
    name: NAME.toLowerCase(),
    accessMethod: "DISK",
    fileName: NAME,
    filePath: `${HOME}/${NAME}`,
    links: filerefLinks(NAME.toLowerCase()),
    ...overrides,
  };
}

/** The `files` collection holding one summary item for the token fileref,
 * with `self`, `alternate` and `deassign` only (Finding 12.23). */
function listing(): ComputeResult<ComputeResponse> {
  const path = `${SESSION_PATH}/filerefs/${NAME.toLowerCase()}`;
  return ok({
    items: [
      {
        id: NAME.toLowerCase(),
        links: [
          { method: "GET", rel: "self", href: path },
          { method: "GET", rel: "alternate", href: path },
          { method: "DELETE", rel: "deassign", href: path },
        ],
      },
    ],
  });
}

/** The replies for a rewrite of a held fileref whose full representation is
 * `held`: the refused `assign`, the listing, the item's `self`, then — only
 * when the module goes on to write — the fresh `self` and the `upload`. */
function rewrite(
  held: Record<string, unknown>,
): ComputeResult<ComputeResponse>[] {
  return [
    taken(),
    listing(),
    ok(held),
    ok(held, { etag: '"e2"' }),
    ok(null, { status: 201 }),
  ];
}

describe("normaliseCasTokenFilerefName", () => {
  it("upper-cases a valid SAS name", () => {
    assert.equal(normaliseCasTokenFilerefName("castoken"), "CASTOKEN");
    assert.equal(normaliseCasTokenFilerefName(" _Tok_1 "), "_TOK_1");
    assert.equal(normaliseCasTokenFilerefName("A"), "A");
    assert.equal(normaliseCasTokenFilerefName("PY12345"), "PY12345");
  });

  it("reads an empty value as the default", () => {
    assert.equal(normaliseCasTokenFilerefName(""), DEFAULT_CAS_TOKEN_FILEREF);
    assert.equal(
      normaliseCasTokenFilerefName("   "),
      DEFAULT_CAS_TOKEN_FILEREF,
    );
  });

  it("refuses a value that is not a SAS fileref name", () => {
    for (const raw of ["1TOKEN", "TOOLONGNAME", "CAS-TOK", "CAS TOK", "a.b"]) {
      assert.equal(normaliseCasTokenFilerefName(raw), undefined, raw);
    }
  });

  it("refuses the names procPython.ts assigns, in any case", () => {
    // Pinned against procPython.ts's own names, which casToken.ts keeps as
    // literals because src/compute does not import src/backend.
    assert.equal(normaliseCasTokenFilerefName(STARTUP_FILEREF_NAME), undefined);
    assert.equal(normaliseCasTokenFilerefName("pyvstart"), undefined);
    for (const name of ["PY000001", "py123456"]) {
      assert.ok(FILEREF_NAME_PATTERN.test(name), name);
      assert.equal(normaliseCasTokenFilerefName(name), undefined, name);
    }
    // One digit short is outside procPython.ts's range, so it is usable.
    assert.equal(FILEREF_NAME_PATTERN.test("PY12345"), false);
  });
});

describe("isOwnTokenFileref", () => {
  const own = {
    id: "castoken",
    links: [],
    accessMethod: "DISK",
    fileName: NAME,
    filePath: `${HOME}/${NAME}`,
  };

  it("is true for a DISK file of that name directly in the session directory", () => {
    assert.equal(isOwnTokenFileref(own, NAME, HOME), true);
    assert.equal(isOwnTokenFileref(own, NAME, `${HOME}/`), true);
  });

  it("is false when any field differs or is missing (Finding 12.25)", () => {
    const cases = [
      { ...own, accessMethod: "TEMP" },
      { ...own, fileName: "castoken" },
      { ...own, filePath: `/tmp/${NAME}` },
      { ...own, filePath: `${HOME}/sub/${NAME}` },
      { id: "castoken", links: [] },
    ];
    for (const candidate of cases) {
      assert.equal(isOwnTokenFileref(candidate, NAME, HOME), false);
    }
  });

  it("is false when the session reported no home directory", () => {
    assert.equal(isOwnTokenFileref(own, NAME, undefined), false);
    assert.equal(isOwnTokenFileref(own, NAME, ""), false);
  });
});

describe("writeCasToken", () => {
  it("creates the fileref under the name on first use, then writes the token", async () => {
    const scripted = fake([
      ok(representation(), { status: 201 }),
      ok(representation(), { etag: '"e1"' }),
      ok(null, { status: 201 }),
    ]);

    const result = await writeCasToken(
      scripted.client,
      session(),
      NAME,
      "s3cr3t-token",
    );

    assert.ok(result.ok);
    assert.deepEqual(result.value, { kind: "written", filerefName: NAME });
    assert.equal(scripted.requests.length, 3);
    assert.equal(scripted.requests[0]?.link.rel, ASSIGN_REL);
    assert.deepEqual(scripted.requests[0].body, { name: NAME, path: NAME });
    assert.equal(scripted.requests[1]?.link.rel, FILEREF_SELF_REL);
    assert.equal(scripted.requests[2]?.link.rel, FILEREF_UPLOAD_REL);
  });

  it("sends the token as rawBody, never as a JSON body", async () => {
    const scripted = fake([
      ok(representation(), { status: 201 }),
      ok(representation(), { etag: '"e1"' }),
      ok(null, { status: 201 }),
    ]);

    await writeCasToken(scripted.client, session(), NAME, "s3cr3t-token");

    const put = scripted.requests[2];
    assert.ok(put !== undefined);
    // The whole point of this module: nothing it sends carries the token as
    // a JSON body a log could echo — only as `rawBody`.
    assert.equal(put.body, undefined);
    assert.deepEqual(put.rawBody, new TextEncoder().encode("s3cr3t-token"));
    for (const request of scripted.requests) {
      assert.ok(!JSON.stringify(request.body ?? null).includes("s3cr3t"));
    }
  });

  it("rewrites a held fileref it created in place (Findings 12.10, 12.23)", async () => {
    const scripted = fake(rewrite(representation()));

    const result = await writeCasToken(
      scripted.client,
      session(),
      NAME,
      "fresh-token",
    );

    assert.ok(result.ok);
    assert.deepEqual(result.value, { kind: "written", filerefName: NAME });
    assert.deepEqual(
      scripted.requests.map((request) => request.link.rel),
      [
        ASSIGN_REL,
        FILEREF_LIST_REL,
        FILEREF_SELF_REL,
        FILEREF_SELF_REL,
        FILEREF_UPLOAD_REL,
      ],
    );
    assert.deepEqual(
      scripted.requests[4]?.rawBody,
      new TextEncoder().encode("fresh-token"),
    );
  });

  it("writes nothing into a held fileref the user's SAS code assigned (Finding 12.25)", async () => {
    for (const held of [
      representation({ accessMethod: "TEMP", fileName: "#LN00006" }),
      representation({ filePath: `/tmp/${NAME}` }),
    ]) {
      const scripted = fake(rewrite(held));

      const result = await writeCasToken(
        scripted.client,
        session(),
        NAME,
        "token",
      );

      assert.ok(result.ok);
      assert.deepEqual(result.value, {
        kind: "held-elsewhere",
        filerefName: NAME,
      });
      assert.equal(scripted.requests.length, 3, "no self read, no upload");
      assert.ok(
        scripted.requests.every((request) => request.rawBody === undefined),
      );
    }
  });

  it("writes nothing into a held fileref when the session has no home directory", async () => {
    const scripted = fake(rewrite(representation()));

    const result = await writeCasToken(
      scripted.client,
      session(null),
      NAME,
      "token",
    );

    assert.ok(result.ok);
    assert.equal(result.value.kind, "held-elsewhere");
    assert.equal(scripted.requests.length, 3);
  });

  it("reports a held name the fileref list does not hold", async () => {
    const scripted = fake([taken(), ok({ items: [] })]);

    const result = await writeCasToken(
      scripted.client,
      session(),
      NAME,
      "token",
    );

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
    assert.equal(scripted.requests.length, 2);
  });

  it("propagates a failed lookup of the held fileref", async () => {
    const scripted = fake([taken(), rejected(404)]);

    const result = await writeCasToken(
      scripted.client,
      session(),
      NAME,
      "token",
    );

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });

  it("returns any other assign failure without looking the name up", async () => {
    for (const [reply, code] of [
      [rejected(400), "compute-rejected"],
      [rejected(404), "session-gone"],
    ] as const) {
      const scripted = fake([reply]);

      const result = await writeCasToken(
        scripted.client,
        session(),
        NAME,
        "token",
      );

      assert.ok(!result.ok);
      assert.equal(result.problem.code, code);
      assert.equal(scripted.requests.length, 1);
    }
  });

  it("propagates a failed content write", async () => {
    const scripted = fake([
      ok(representation(), { status: 201 }),
      ok(representation(), { etag: '"e1"' }),
      rejected(412),
    ]);

    const result = await writeCasToken(
      scripted.client,
      session(),
      NAME,
      "token",
    );

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "compute-rejected");
    assert.equal(scripted.requests.length, 3);
  });

  it("threads a caller's AbortSignal to every request it makes", async () => {
    const scripted = fake(rewrite(representation()));
    const controller = new AbortController();

    await writeCasToken(scripted.client, session(), NAME, "token", {
      signal: controller.signal,
    });

    assert.equal(scripted.requests.length, 5);
    assert.ok(scripted.requests.every((r) => r.signal === controller.signal));
  });
});
