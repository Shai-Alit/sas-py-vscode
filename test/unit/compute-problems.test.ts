// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  MAX_DETAIL_LENGTH,
  type ComputeProblem,
  type ViyaError,
  describeComputeProblem,
  describeViyaError,
  readViyaError,
} from "../../src/compute/problems";

/**
 * Two claims are worth testing here and the rest is wording.
 *
 * The first is that {@link describeComputeProblem} is total — the `switch` has no
 * `default`, so a missing case is a compile error, but only the runtime half
 * proves none of them returns nothing.
 *
 * The second is that {@link readViyaError} cannot throw. It runs on the failure
 * path, frequently on the failure path of a teardown, and a parser that throws
 * there turns a diagnosable problem into an opaque one — so it is fed a
 * deliberately hostile range of bodies below.
 */

/** One of every member of the union, so the exhaustiveness claim is exercised. */
const every: ComputeProblem[] = [
  { code: "compute-unreachable", detail: "ECONNREFUSED" },
  { code: "unauthorized", problem: { code: "session-expired" } },
  {
    code: "unauthorized",
    problem: { code: "not-authenticated" },
  },
  { code: "forbidden", error: { status: 403 } },
  { code: "session-gone", error: { status: 404, errorCode: 5837 } },
  { code: "no-such-context", name: "SAS Job Execution compute context" },
  { code: "compute-rejected", error: { status: 500 } },
  { code: "response-malformed", detail: "no id field in the session response" },
  { code: "link-missing", rel: "execute", resource: "compute session" },
  {
    code: "foreign-link",
    rel: "self",
    href: "https://elsewhere.example/collect",
  },
];

describe("describeComputeProblem", () => {
  it("answers for every member of the union", () => {
    for (const problem of every) {
      const described = describeComputeProblem(problem);
      assert.equal(typeof described, "string");
      assert.ok(described.length > 0, `empty description for ${problem.code}`);
    }
  });

  it("writes lower-case fragments with no trailing full stop", () => {
    // The convention `describeProblem` in src/profile/model.ts set and
    // `describeAuthProblem` follows: the caller embeds these in a longer line.
    for (const problem of every) {
      const described = describeComputeProblem(problem);
      assert.ok(
        !described.endsWith("."),
        `"${described}" should not end in a full stop`,
      );
      assert.equal(described[0], described[0]?.toLowerCase());
    }
  });

  it("delegates a 401 to the auth module rather than re-diagnosing it", () => {
    // The runbook item this satisfies: 1c already tells a dead token apart from
    // a request that carried no credentials, and that verdict is what travels.
    // If these two ever read the same, the delegation has been lost.
    const expired = describeComputeProblem({
      code: "unauthorized",
      problem: { code: "session-expired", description: "Access token expired" },
    });
    const missing = describeComputeProblem({
      code: "unauthorized",
      problem: { code: "not-authenticated" },
    });

    assert.match(expired, /no longer active/);
    assert.match(expired, /Access token expired/);
    assert.match(missing, /without credentials/);
    assert.notEqual(expired, missing);
  });

  it("names the context that could not be found", () => {
    assert.match(
      describeComputeProblem({ code: "no-such-context", name: "Data Mining" }),
      /"Data Mining"/,
    );
  });

  it("names the status on an unclassified rejection", () => {
    assert.match(
      describeComputeProblem({
        code: "compute-rejected",
        error: { status: 503 },
      }),
      /HTTP 503/,
    );
  });

  it("reports a refused link with the href the server actually sent", () => {
    // Whoever reads this log needs to see where the deployment tried to send a
    // request carrying their bearer token.
    assert.match(
      describeComputeProblem({
        code: "foreign-link",
        rel: "next",
        href: "//elsewhere.example/collect",
      }),
      /elsewhere\.example/,
    );
  });
});

describe("describeViyaError", () => {
  it("says nothing when there is nothing to say", () => {
    // A status-only error is already described by the variant that carries it,
    // so the tail must not become an empty pair of brackets.
    assert.equal(describeViyaError({ status: 404 }), "");
  });

  it("prefers the human sentence over the generic message", () => {
    const error: ViyaError = {
      status: 404,
      message: "Not Found",
      detail: 'A session with the ID "S" could not be found',
    };
    const described = describeViyaError(error);
    assert.match(described, /could not be found/);
    assert.ok(!described.includes("Not Found"), described);
  });

  it("falls back to the message when there is no detail", () => {
    assert.match(
      describeViyaError({ status: 404, message: "Not Found" }),
      /Not Found/,
    );
  });

  it("carries the correlator, because that is what support asks for", () => {
    assert.match(
      describeViyaError({ status: 404, correlator: "cca95fbe-0000-4000" }),
      /correlator cca95fbe-0000-4000/,
    );
  });

  it("carries the error code as text", () => {
    assert.match(
      describeViyaError({ status: 404, errorCode: 5837 }),
      /error code 5837/,
    );
  });
});

describe("readViyaError", () => {
  /** Finding 17's envelope, verbatim in shape, with the identifiers synthesised. */
  const ENVELOPE = JSON.stringify({
    message: "Not Found",
    errorCode: 5837,
    httpStatusCode: 404,
    details: [
      'A session with the ID "SESSION-ID" could not be found.',
      "path: /compute/sessions/SESSION-ID",
      "correlator: cca95fbe-0000-4000-8000-000000000000",
    ],
  });

  it("reads the envelope a live deployment returns", () => {
    assert.deepEqual(readViyaError(404, ENVELOPE), {
      status: 404,
      message: "Not Found",
      errorCode: 5837,
      detail: 'A session with the ID "SESSION-ID" could not be found.',
      correlator: "cca95fbe-0000-4000-8000-000000000000",
    });
  });

  it("drops the path entry", () => {
    // Deliberate, per finding 17 and the note on readViyaError: the path is the
    // one field that reflects our own request back at us, and not repeating
    // request-derived text is the cheapest way to keep this file free of
    // anything that could ever become a credential.
    const error = readViyaError(404, ENVELOPE);
    assert.ok(!JSON.stringify(error).includes("/compute/sessions"));
  });

  it("trusts the HTTP status over the one in the body", () => {
    // They agreed in every response observed. If they ever disagree, the status
    // that governs what happened is the one on the wire.
    const error = readViyaError(
      502,
      JSON.stringify({ message: "Not Found", httpStatusCode: 404 }),
    );
    assert.equal(error.status, 502);
  });

  it("never throws, whatever the body is", () => {
    // A gateway in front of the deployment can answer with HTML, nothing at
    // all, or JSON of an entirely unrelated shape.
    const bodies = [
      "",
      "   ",
      "<html><body>502 Bad Gateway</body></html>",
      "null",
      "[]",
      '"a string"',
      "42",
      "{",
      '{"details": "not an array"}',
      '{"details": [1, 2, 3]}',
      '{"message": 7, "errorCode": "5837"}',
      '{"errorCode": null}',
    ];

    for (const body of bodies) {
      const error = readViyaError(500, body);
      assert.equal(error.status, 500, body);
      assert.equal(typeof error, "object", body);
    }
  });

  it("keeps only the status when the body is not an envelope", () => {
    assert.deepEqual(readViyaError(502, "<html>502</html>"), { status: 502 });
    assert.deepEqual(readViyaError(500, ""), { status: 500 });
    assert.deepEqual(readViyaError(500, "null"), { status: 500 });
    assert.deepEqual(readViyaError(500, '"a string"'), { status: 500 });
  });

  it("omits a field rather than carrying it as undefined", () => {
    // `exactOptionalPropertyTypes` is on, and a key holding `undefined` would
    // make `describeViyaError`'s checks read as present-but-empty.
    assert.deepEqual(readViyaError(403, JSON.stringify({ message: "" })), {
      status: 403,
    });
    assert.deepEqual(
      readViyaError(403, JSON.stringify({ errorCode: Number.NaN })),
      { status: 403 },
    );
  });

  it("ignores an errorCode that is not a finite number", () => {
    for (const body of [
      '{"errorCode": "5837"}',
      '{"errorCode": null}',
      '{"errorCode": []}',
    ]) {
      assert.deepEqual(readViyaError(400, body), { status: 400 }, body);
    }
  });

  it("takes the first human entry and the first correlator", () => {
    const error = readViyaError(
      404,
      JSON.stringify({
        details: [
          "path: /compute/sessions/S",
          "the first sentence",
          "the second sentence",
          "correlator: first",
          "correlator: second",
        ],
      }),
    );
    assert.deepEqual(error, {
      status: 404,
      detail: "the first sentence",
      correlator: "first",
    });
  });

  it("skips details entries that are not strings", () => {
    assert.deepEqual(
      readViyaError(404, JSON.stringify({ details: [null, 7, ["x"], "real"] })),
      { status: 404, detail: "real" },
    );
  });

  it("flattens whitespace so one field cannot break the log line", () => {
    // A deployment is free to put a stack trace in `message`.
    assert.deepEqual(
      readViyaError(
        500,
        JSON.stringify({ message: "  first line\n\tsecond line  " }),
      ),
      { status: 500, message: "first line second line" },
    );
  });

  it("clips a pathological field and says that it did", () => {
    const long = "x".repeat(MAX_DETAIL_LENGTH * 3);
    const { message } = readViyaError(500, JSON.stringify({ message: long }));

    // Narrowed once, up front. An `assert.equal` on `message?.length` would
    // prove `message` non-nullish and turn every later `?.` into a lint error —
    // see the note in test/unit/auth-identity.test.ts.
    assert.ok(message !== undefined);
    // The ellipsis is one character, so the clipped value is one longer than
    // the bound — visible truncation is the point.
    assert.equal(message.length, MAX_DETAIL_LENGTH + 1);
    assert.ok(message.endsWith("…"));
  });

  it("leaves a field exactly at the bound alone", () => {
    const exact = "x".repeat(MAX_DETAIL_LENGTH);
    const error = readViyaError(500, JSON.stringify({ message: exact }));
    assert.deepEqual(error, { status: 500, message: exact });
  });

  it("does not cut a character in half at the boundary", () => {
    // Raised in review of 2a-i. The character that lands exactly on the bound is
    // one code point but two UTF-16 code units, so a `String.slice` cut here
    // keeps its leading surrogate and drops its trailing one. That is not a
    // theoretical unit: the message is a *diagnostic*, and a diagnostic ending
    // in a replacement character reads as though the extension corrupted it.
    const straddling = `${"x".repeat(MAX_DETAIL_LENGTH - 1)}😀 and then some more`;
    const { message } = readViyaError(
      500,
      JSON.stringify({ message: straddling }),
    );

    assert.ok(message !== undefined);
    assert.ok(message.endsWith("😀…"), `clipped to ${JSON.stringify(message)}`);
    assert.ok(
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(message),
      "a lone leading surrogate survived the clip",
    );
  });

  it("measures the bound in code points, not code units", () => {
    // The consequence of the fix above: a string of astral characters is twice
    // as long in code units as it is in points, and the bound follows what a
    // reader sees rather than how it happens to be stored.
    const astral = "😀".repeat(MAX_DETAIL_LENGTH + 1);
    const { message } = readViyaError(500, JSON.stringify({ message: astral }));

    assert.ok(message !== undefined);
    assert.equal(Array.from(message).length, MAX_DETAIL_LENGTH + 1);
    assert.ok(message.endsWith("…"));
  });
});
