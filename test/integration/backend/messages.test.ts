// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { localiseBackendProblem } from "../../../src/backend/messages";
import type { BackendProblem } from "../../../src/backend/problems";

/**
 * Every seam failure the user can be shown, rendered by the real `l10n`.
 *
 * Same shape as `compute/messages.test.ts`: `l10n.t()` returns nothing useful
 * outside an extension host, so this cannot run in the unit tier. The
 * compiler guarantees `localiseBackendProblem`'s switch is exhaustive; it
 * cannot notice a placeholder left unfilled or a sentence copied from the
 * wrong case.
 */

const PROBLEMS: BackendProblem[] = [
  { code: "not-connected" },
  { code: "busy", running: "proc-python-run-3" },
  {
    code: "unsupported",
    feature: "freshNamespace",
    reason: "this backend cannot clear the interpreter",
  },
  { code: "transfer-failed", detail: "428 on the fileref write" },
  { code: "runtime-unavailable", detail: "PROC PYTHON is not licensed" },
  { code: "backend-gone", detail: "session-gone" },
  { code: "cancelled" },
  { code: "backend-failed", detail: "unexpected response shape" },
];

describe("backend problem messages under the real l10n", () => {
  it("renders every problem as a sentence, with nothing left to fill in", () => {
    for (const problem of PROBLEMS) {
      const message = localiseBackendProblem(problem);
      assert.ok(message.trim().length > 0, `${problem.code} rendered nothing`);
      assert.match(message, /^[A-Z]/, `${problem.code}: ${message}`);
      assert.doesNotMatch(
        message,
        /\{\d+\}/,
        `${problem.code} shipped a literal placeholder: ${message}`,
      );
    }
  });

  it("gives each code its own message", () => {
    assert.equal(new Set(PROBLEMS.map(localiseBackendProblem)).size, 8);
  });

  it("never echoes a raw detail fragment into the user-facing sentence", () => {
    // Unlike compute/messages.ts's compute-unreachable, `detail` here is
    // already describeComputeProblem's own log fragment — see this module's
    // own doc comment for why it stays out of the notification.
    for (const problem of PROBLEMS) {
      if (!("detail" in problem)) continue;
      const message = localiseBackendProblem(problem);
      assert.ok(
        !message.includes(problem.detail),
        `${problem.code} leaked its detail into the user-facing message: ${message}`,
      );
    }
  });
});
