// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type {
  HttpTransport,
  TransportRequest,
  TransportResponse,
} from "../../src/auth/transport";
import { createComputeClient } from "../../src/compute/client";
import { createFileref, writeFilerefContent } from "../../src/compute/fileref";
import { type Link } from "../../src/compute/links";
import { type ComputeSession } from "../../src/compute/session";
import { listFixtureFiles, readFixtureBytes } from "../helpers/fixtures";

/**
 * The submission-fidelity corpus — `RUNBOOK.md`'s "Before 3a" item — driven
 * through a real {@link createComputeClient} over a recording transport.
 *
 * ## What this proves, and what it cannot
 *
 * It proves that every byte of every corpus file reaches `HttpTransport` — the
 * last point this codebase controls before the socket — unchanged: no JSON
 * escaping, no decode-and-re-encode, no byte added or dropped at either end.
 * The comparison is against a **second, independent read of the fixture**, not
 * against the array that was handed in; passing the same reference back and
 * forth would compare a value with itself and pass no matter what the code did.
 *
 * It proves nothing at all about the interpreter. That the deployment *stores*
 * what it was sent is `test/live/submission-corpus.test.ts`'s job, on a curated
 * subset against a real Viya 4; and that `proc python` *runs* what was stored,
 * with the same bytes reaching the interpreter, is not proved anywhere yet —
 * that half arrives with slice 3a, which is the slice that first composes
 * `infile=<fileref>;` and reads a log back.
 *
 * ## Why these particular files
 *
 * The corpus's job **changed** on 2026-08-16 (findings 31–36): before that,
 * these files existed to choose a submission mechanism; upload plus `infile=`
 * is now chosen, so the same hostile cases instead stand as evidence that
 * nothing on this path tokenises, re-encodes, or otherwise interprets the file.
 * The first case to start failing would be saying that something does.
 */

const ROOT = "https://viya.example.com";
const TOKEN = "test-token";
const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;
const ETAG = '"fileref-etag-1"';

function session(): ComputeSession {
  return {
    id: SESSION_ID,
    state: "idle",
    links: [
      {
        method: "POST",
        rel: "assign",
        href: `${SESSION_PATH}/filerefs`,
        type: "application/vnd.sas.compute.fileref.request",
        responseType: "application/vnd.sas.compute.fileref",
      },
    ],
  };
}

/**
 * The two relations this module follows, with the types finding 57 measured.
 *
 * `upload` advertising `application/octet-stream` is load-bearing: it is what
 * makes the client send that `Content-Type` by following the link, rather than
 * falling back to its own default for a raw body. A link set written with no
 * types would exercise the fallback and prove the opposite of what the
 * deployment does.
 */
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

interface Call {
  readonly url: string;
  readonly init: TransportRequest;
}

interface Recorder {
  readonly calls: Call[];
  readonly transport: HttpTransport;
}

function json(
  body: unknown,
  init?: { status?: number; etag?: string },
): TransportResponse {
  const status = init?.status ?? 200;
  const headers: Record<string, string> = {
    "content-type": "application/vnd.sas.compute.fileref+json",
  };
  if (init?.etag !== undefined) headers.etag = init.etag;
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    text: () => Promise.resolve(text),
  };
}

function empty(status: number): TransportResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    text: () => Promise.resolve(""),
  };
}

/** Scripts exactly the three replies one create-then-write round needs. */
function record(id: string): Recorder {
  const links = filerefLinks(id);
  const replies: readonly TransportResponse[] = [
    json({ id, links }, { status: 201 }),
    json({ id, links }, { etag: ETAG }),
    empty(201),
  ];
  const calls: Call[] = [];
  const transport: HttpTransport = (url, init) => {
    const index = calls.length;
    calls.push({ url, init });
    const reply = replies[index];
    assert.ok(
      reply !== undefined,
      "the corpus round trip made an unscripted request",
    );
    return Promise.resolve(reply);
  };
  return { calls, transport };
}

const CORPUS_DIR = "submission-corpus";

/**
 * Names the plan's own list (`PRODUCTION_PLAN.md` §4) commits this corpus to
 * having. A test over "whatever files happen to be in the directory" would
 * pass the day a case was accidentally deleted; this pins the membership the
 * same way `compute-job.test.ts` pins `TERMINAL_STATES`.
 */
const EXPECTED_CASES: readonly string[] = [
  "ampersand-percent-in-literals.py",
  "apostrophe-in-docstring.py",
  "crlf-line-endings.py",
  "empty.py",
  "endsubmit-in-comment.py",
  "endsubmit-in-string.py",
  "fstring-nested-quotes-braces.py",
  "no-trailing-newline.py",
  "non-ascii.py",
  "odd-quote-count.py",
  "raw-and-byte-strings.py",
  "semicolon-heavy-oneliner.py",
  "tab-indented.py",
  "triple-quote-mixed-styles.py",
  "utf8-bom.py",
];

describe("submission-fidelity corpus", () => {
  describe("the fixtures themselves", () => {
    it("has exactly the cases the plan commits to, and no others", () => {
      assert.deepEqual(
        listFixtureFiles(CORPUS_DIR),
        [...EXPECTED_CASES].sort(),
      );
    });

    it("has a genuinely empty file for the empty-file case", () => {
      // The easiest way for this specific case to go stale silently: someone's
      // editor adds a trailing newline on save, and "empty" becomes one byte.
      // `.editorconfig` exempts the directory from `insert_final_newline` for
      // exactly this reason; this is the assertion that notices if it stops
      // working.
      assert.equal(readFixtureBytes(CORPUS_DIR, "empty.py").length, 0);
    });

    it("has no trailing newline in the no-trailing-newline case", () => {
      const bytes = readFixtureBytes(CORPUS_DIR, "no-trailing-newline.py");
      assert.notEqual(bytes.at(-1), 0x0a);
    });

    it("has a real tab in the tab-indented case", () => {
      // The base `[*]` rule in `.editorconfig` is `indent_style = space`, which
      // an editor that reindents on save will happily apply to a fixture whose
      // only property is that it is indented with tabs. The corpus section
      // unsets it; this is what notices if that unset is dropped.
      const bytes = readFixtureBytes(CORPUS_DIR, "tab-indented.py");
      assert.ok(bytes.includes(0x09), "expected at least one tab byte");
    });

    it("has multi-byte UTF-8 in the non-ascii case", () => {
      // Distinct from the CRLF case: nothing rewrites these bytes on save, but
      // a well-meaning "make the fixtures readable" edit that replaces the
      // accented and dashed characters with ASCII would leave the file looking
      // fine and testing nothing.
      const bytes = readFixtureBytes(CORPUS_DIR, "non-ascii.py");
      assert.ok(
        bytes.some((byte) => byte > 0x7f),
        "expected at least one byte outside ASCII",
      );
    });

    it("starts with a UTF-8 BOM, and carries no other, in the bom case", () => {
      // The one property this fixture has. `.gitattributes` marks the corpus
      // `-text` so nothing rewrites it on the way into a commit, and
      // `.editorconfig` unsets `charset` for the directory so an editor
      // honouring the repo-wide `charset = utf-8` ("no BOM", per the spec)
      // does not strip the leading bytes on save. A "these look like mojibake,
      // let me clean them up" edit would leave a file that reads like every
      // other case and proves nothing. Finding 77 (phase-5.md) put exactly
      // these three bytes through the live upload + `infile=` path.
      const bytes = readFixtureBytes(CORPUS_DIR, "utf8-bom.py");
      assert.deepEqual(
        [...bytes.slice(0, 3)],
        [0xef, 0xbb, 0xbf],
        "expected a leading UTF-8 BOM (EF BB BF)",
      );
      // A BOM anywhere but byte 0 is a different case Finding 77 explicitly did
      // not settle; keep this fixture to the one it did.
      assert.equal(
        Buffer.from(bytes.slice(3)).includes(Buffer.from([0xef, 0xbb, 0xbf])),
        false,
        "found a second BOM sequence past byte 0",
      );
    });

    it("has CRLF, not LF, in the crlf case", () => {
      // `.gitattributes` marks the directory `-text` so `text=auto eol=lf` does
      // not rewrite this file on the way into a commit. Measured: the filtered
      // blob would be 51 bytes against the raw 56. Without that exemption this
      // assertion fails on a fresh clone, including in CI, and only there.
      const bytes = readFixtureBytes(CORPUS_DIR, "crlf-line-endings.py");
      const text = Buffer.from(bytes).toString("latin1");
      assert.ok(text.includes("\r\n"), "expected at least one CRLF pair");
      assert.equal(
        text.replaceAll("\r\n", "").includes("\n"),
        false,
        "found a bare LF alongside the CRLF pairs",
      );
    });
  });

  describe("what reaches the transport", () => {
    for (const name of EXPECTED_CASES) {
      it(`sends ${name} byte for byte`, async () => {
        const recorder = record(name);
        const client = createComputeClient({
          root: ROOT,
          token: () => TOKEN,
          transport: recorder.transport,
        });

        const created = await createFileref(client, session(), name);
        assert.ok(created.ok, `createFileref failed for ${name}`);

        const written = await writeFilerefContent(
          client,
          created.value,
          readFixtureBytes(CORPUS_DIR, name),
        );
        assert.ok(written.ok, `writeFilerefContent failed for ${name}`);

        // Three calls: assign, the self GET for a fresh ETag, and the content
        // PUT. Anything else means a retry or an extra round trip crept in,
        // which a recorder that only kept the last call would hide.
        assert.equal(recorder.calls.length, 3);
        const put = recorder.calls[2];
        assert.ok(put !== undefined);
        assert.equal(put.init.method, "PUT");
        assert.equal(
          put.url,
          `${ROOT}${SESSION_PATH}/filerefs/${name}/content`,
        );

        // A string here is the whole failure mode this corpus exists to catch:
        // it means the bytes went out through `body` and `JSON.stringify`
        // rather than through `rawBody`, and every case with a quote, a
        // backslash or a newline in it would arrive escaped.
        const sent = put.init.body;
        assert.ok(
          sent instanceof Uint8Array,
          "the content went out as a string, not as bytes",
        );

        // The fidelity claim, against a second read of the file rather than
        // against the array that was passed in. Comparing `sent` with the value
        // handed to `writeFilerefContent` would be comparing a reference with
        // itself: it passes even if this code re-encodes everything.
        const expected = readFixtureBytes(CORPUS_DIR, name);
        assert.equal(
          sent.length,
          expected.length,
          `${name} changed length on the way to the transport`,
        );
        assert.deepEqual(sent, expected);

        // Two headers, neither of them chosen by this path: the type finding 57
        // measured on `upload`, and the ETag from the self read that finding 36
        // showed a `PUT` is refused without (`428`). The `content-type`
        // assertion on its own does not discriminate — `client.ts`'s default for
        // a raw body is the same string — so it is checking the value that goes
        // out, not that the link was followed to get it. The test that
        // separates those two is `compute-client.test.ts`'s "prefers the link's
        // own type over the octet-stream default", which uses a link type the
        // default could never produce.
        assert.equal(
          put.init.headers["content-type"],
          "application/octet-stream",
        );
        assert.equal(put.init.headers["if-match"], ETAG);
      });
    }
  });
});
