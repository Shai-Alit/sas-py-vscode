// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { localiseCasProblem } from "../../../src/cas/messages";
import type { CasProblem } from "../../../src/cas/problems";

/**
 * Every CAS-browsing failure 8b's connect-snippet command can show the user,
 * rendered by the real `l10n` — the same suite as `content/messages.test.ts`
 * and `compute/messages.test.ts`, for the same reason: `l10n.t()` is on the
 * `vscode` module and does nothing useful outside an extension host, so the
 * unit tier cannot execute a line of the module under test.
 */

const VIYA_ERROR = {
  status: 403,
  message: "Forbidden",
  detail: "Ask your CAS administrator for read access.",
  errorCode: 9137,
  correlator: "d1e2f3a4-5678-4b90-8c12-3d4e5f6a7b8c",
};

const PROBLEMS: CasProblem[] = [
  { code: "cas-unreachable", detail: "GET /casManagement/servers — ETIMEDOUT" },
  { code: "cas-response-too-large", limitBytes: 1_048_576 },
  { code: "unauthorized", problem: { code: "state-mismatch" } },
  { code: "forbidden", error: VIYA_ERROR },
  { code: "cas-rejected", error: { status: 500, errorCode: 0 } },
  { code: "response-malformed", detail: "no usable host/port fields" },
  {
    code: "link-missing",
    rel: "connection",
    resource: 'CAS server "cas-shared-default"',
  },
  {
    code: "foreign-link",
    rel: "connection",
    href: "https://elsewhere.example/x",
  },
];

describe("CAS problem messages under the real l10n", () => {
  it("renders every problem as a sentence, with nothing left to fill in", () => {
    for (const problem of PROBLEMS) {
      const message = localiseCasProblem(problem);
      assert.ok(message.trim().length > 0, `${problem.code} rendered nothing`);
      assert.match(message, /^[A-Z]/, `${problem.code}: ${message}`);
      assert.doesNotMatch(
        message,
        /\{\d+\}/,
        `${problem.code} shipped a literal placeholder: ${message}`,
      );
    }
  });

  it("relays the deployment's own sentence on a forbidden, but not the codes", () => {
    const message = localiseCasProblem({
      code: "forbidden",
      error: VIYA_ERROR,
    });
    assert.ok(message.includes(VIYA_ERROR.detail), message);
    assert.ok(!message.includes(String(VIYA_ERROR.errorCode)), message);
    assert.ok(!message.includes(VIYA_ERROR.correlator), message);
  });

  it("delegates a 401 to the sign-in wording rather than rewording it", () => {
    const message = localiseCasProblem({
      code: "unauthorized",
      problem: { code: "client-id-required", deployment: "Viya 4 2022.05" },
    });
    assert.ok(message.includes("Viya 4 2022.05"), message);
  });

  it("says a too-large answer is a too-wide table, with the limit, and not the proxy advice", () => {
    const message = localiseCasProblem({
      code: "cas-response-too-large",
      limitBytes: 1_048_576,
    });
    assert.match(message, /limit 1 MB/);
    assert.match(message, /fewer columns/);
    assert.doesNotMatch(message, /proxy/);
  });

  it("names the HTTP status on a plain rejection", () => {
    const message = localiseCasProblem({
      code: "cas-rejected",
      error: { status: 503, detail: "the service is temporarily unavailable" },
    });
    assert.match(message, /HTTP 503/);
    assert.match(message, /temporarily unavailable/);
  });
});
