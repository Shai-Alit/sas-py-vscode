// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { type LogLine } from "../../src/compute/job";
import {
  MAX_STARTUP_DIAGNOSTIC_LINES,
  redactCredentials,
  selectStartupDiagnostics,
} from "../../src/compute/startupLog";

/**
 * Which lines of a session log reach the user after a startup error. The
 * shape below is Finding 12.11's own: the bad autoExec statement's source
 * echo, SAS's two underline marker lines, a blank, and the `ERROR` itself,
 * with site preamble around it.
 */
const FINDING_12_11_TAIL: readonly LogLine[] = [
  { line: "NOTE: AUTOEXEC processing beginning.", type: "note" },
  { line: "1    ", type: "source" },
  { line: "NOTE: AUTOEXEC source line.", type: "note" },
  { line: "1    this is not valid sas;", type: "source" },
  { line: "     ----", type: "error" },
  { line: "     180", type: "error" },
  { line: "", type: "note" },
  {
    line: "ERROR 180-322: Statement is not valid or it is used out of proper order.",
    type: "error",
  },
  { line: "", type: "normal" },
  { line: "1    %let P12F=after;", type: "source" },
  {
    line: "NOTE: The LOCKDOWN option has been set. SAS is now in the lockdown state.",
    type: "note",
  },
];

describe("selectStartupDiagnostics", () => {
  it("keeps the ERROR line and drops SAS's underline markers", () => {
    assert.deepEqual(selectStartupDiagnostics(FINDING_12_11_TAIL), {
      lines: [
        "ERROR 180-322: Statement is not valid or it is used out of proper order.",
      ],
      omitted: 0,
    });
  });

  it("never shows the echoed source line, which can carry a profile's own secrets", () => {
    const selected = selectStartupDiagnostics([
      { line: '1    libname x odbc password="hunter2";', type: "source" },
      { line: "ERROR: Invalid option name PASSWORD.", type: "error" },
    ]);
    assert.ok(!selected.lines.some((line) => line.includes("hunter2")));
    assert.deepEqual(selected.lines, ["ERROR: Invalid option name PASSWORD."]);
  });

  it("redacts a credential an ERROR line itself quotes", () => {
    const selected = selectStartupDiagnostics([
      {
        line: 'ERROR: CLI error trying to establish connection: "DSN=db;UID=me;PWD=hunter2;"',
        type: "error",
      },
      {
        line: "ERROR: Login failed, password='s3cr et' authdomain=x",
        type: "error",
      },
    ]);
    assert.ok(!selected.lines.some((line) => /hunter2|s3cr/.test(line)));
    assert.deepEqual(selected.lines, [
      'ERROR: CLI error trying to establish connection: "DSN=db;UID=me;PWD=[redacted];"',
      "ERROR: Login failed, password=[redacted] authdomain=x",
    ]);
  });

  it("keeps a keyword with no value, and an option that is not a credential", () => {
    assert.equal(
      redactCredentials("ERROR: Invalid option name PASSWORD. user=me"),
      "ERROR: Invalid option name PASSWORD. user=me",
    );
  });

  it("redacts braced, spaced and every listed credential key", () => {
    assert.equal(
      redactCredentials(
        "pw = {SAS002}ABC  authpw=a token=b access_token=c client_secret=d apikey=e api_key=f passwd=g secret=h",
      ),
      "pw = [redacted]  authpw=[redacted] token=[redacted] access_token=[redacted] client_secret=[redacted] apikey=[redacted] api_key=[redacted] passwd=[redacted] secret=[redacted]",
    );
  });

  it("keeps a warning, and a wrapped error's unprefixed continuation line", () => {
    const selected = selectStartupDiagnostics([
      { line: "WARNING: Libref P is not assigned.", type: "warning" },
      { line: "ERROR: The first half of a long message that", type: "error" },
      { line: "       wraps onto a second line.   ", type: "error" },
    ]);
    assert.deepEqual(selected.lines, [
      "WARNING: Libref P is not assigned.",
      "ERROR: The first half of a long message that",
      "       wraps onto a second line.",
    ]);
  });

  it("finds nothing in a clean session's log", () => {
    // Finding 12.11's control: no autoExec, no error or warning lines at all.
    assert.deepEqual(
      selectStartupDiagnostics([
        { line: "NOTE: AUTOEXEC processing completed.", type: "note" },
        { line: "1    ", type: "source" },
        { line: "", type: "normal" },
        { line: "untyped line" },
      ]),
      { lines: [], omitted: 0 },
    );
  });

  it("caps the lines it returns and counts the rest", () => {
    const many: LogLine[] = Array.from(
      { length: MAX_STARTUP_DIAGNOSTIC_LINES + 3 },
      (_, index) => ({ line: `ERROR: number ${String(index)}`, type: "error" }),
    );
    const selected = selectStartupDiagnostics(many);
    assert.equal(selected.lines.length, MAX_STARTUP_DIAGNOSTIC_LINES);
    assert.equal(selected.lines[0], "ERROR: number 0");
    assert.equal(selected.omitted, 3);
  });
});
