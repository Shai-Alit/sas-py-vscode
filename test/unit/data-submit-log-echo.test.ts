// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Pins Finding 7.12's own confirmed observation (`docs/phases/phase-7.md`):
 * a `LIBNAME` statement executed via `SAS.submit()` gets SAS's standard
 * password-masking (the option's value is replaced with X characters) in
 * its own log echo, the same as a top-level `LIBNAME`.
 *
 * `test/fixtures/data/submit-log-echo.txt` is not a captured wire JSON
 * envelope the way `test/fixtures/data/*.json` are — no `DataAccessApi` call
 * is involved in 7d at all (`phase-7.md`'s own Testing note) — it is a
 * verbatim transcription of the already-sanitized log text Finding 7.12's
 * write-up records (a fake host/user, matching the probe's own design). This
 * test exists so `docs/data-access.md`'s masking claim keeps a real,
 * evidence-backed pin rather than only a prose citation.
 */

import assert from "node:assert/strict";

import { readFixture } from "../helpers/fixtures";

describe("7d: SAS.submit()'s LIBNAME echo masking (Finding 7.12)", () => {
  it("masks the password value with X characters, not the literal value", () => {
    const log = readFixture("data", "submit-log-echo.txt");

    const match = /password=(\S+)/.exec(log);
    assert.ok(match, "expected a password= token in the fixture");
    const maskedValue = match[1] ?? "";
    assert.ok(maskedValue.length > 0);
    assert.match(maskedValue, /^X+$/);
  });

  it("still names the libref/engine, unmasked — only the credential is redacted", () => {
    const log = readFixture("data", "submit-log-echo.txt");

    assert.match(log, /^libname mysqllib mysql /);
    assert.match(log, /user='fakeuser'/);
  });
});
