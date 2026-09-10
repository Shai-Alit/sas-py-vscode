// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { localiseDataProblem } from "../../../src/data/messages";
import type { DataProblem } from "../../../src/data/problems";

/**
 * Every data-browsing failure the user can be shown in the data viewer
 * panel, rendered by the real `l10n`.
 *
 * The same suite shape as `content/messages.test.ts` / `compute/messages.test.ts`
 * / `backend/messages.test.ts`, for the same reason: `l10n.t()` exists on the
 * `vscode` module and returns nothing useful outside an extension host, so the
 * unit tier cannot execute a single line of the module under test.
 *
 * Added 2026-09-10, alongside the fix: `dataViewerPanel.ts` had been passing
 * `describeDataProblem`'s own lower-case log fragment straight into the
 * webview's `FailureMessage`/`RowsErrorMessage`, with no `l10n.t()` anywhere
 * in the path — the one gap this project's own localisation-boundary
 * convention (a `describe...Problem` for the log, a `localise...Problem` for
 * the one place a failure reaches the user directly) had in this module.
 */

const PROBLEMS: DataProblem[] = [
  { code: "not-connected" },
  { code: "session-busy" },
  {
    code: "compute",
    problem: {
      code: "link-missing",
      rel: "columns",
      resource: 'table "SASHELP.CLASS"',
    },
  },
];

describe("data problem messages under the real l10n", () => {
  it("renders every problem as a sentence, with nothing left to fill in", () => {
    for (const problem of PROBLEMS) {
      const message = localiseDataProblem(problem);
      assert.ok(message.trim().length > 0, `${problem.code} rendered nothing`);
      // Capitalised, unlike the lower-case fragments `describeDataProblem`
      // writes to the log. The two switches look alike and are easy to mix
      // up — that mix-up is exactly what this file exists to catch.
      assert.match(message, /^[A-Z]/, `${problem.code}: ${message}`);
      assert.doesNotMatch(
        message,
        /\{\d+\}/,
        `${problem.code} shipped a literal placeholder: ${message}`,
      );
    }
  });

  it("gives each code its own message", () => {
    assert.equal(new Set(PROBLEMS.map(localiseDataProblem)).size, 3);
  });

  it("delegates a wrapped compute problem to compute/messages.ts rather than rewording it", () => {
    // The whole reason `DataProblem`'s `compute` variant carries a
    // `ComputeProblem`: `src/compute/messages.ts` already words every
    // reading of a link-missing/session-gone/etc. failure, and a second
    // wording here is how the panel and the log end up disagreeing about
    // what went wrong.
    const message = localiseDataProblem({
      code: "compute",
      problem: {
        code: "link-missing",
        rel: "columns",
        resource: 'table "SASHELP.CLASS"',
      },
    });
    assert.match(message, /did not offer that operation/);
  });

  it("tells the user to connect when there is no session at all", () => {
    const message = localiseDataProblem({ code: "not-connected" });
    assert.match(message, /connect/i);
  });

  it("tells the user to wait or cancel when the session is busy", () => {
    const message = localiseDataProblem({ code: "session-busy" });
    assert.match(message, /running/i);
    assert.match(message, /wait|cancel/i);
  });
});
