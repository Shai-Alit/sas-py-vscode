// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `src/data/csvFormulaGuard.ts` — 12e's shared CSV formula-injection guard
 * (`docs/phases/phase-12.md`). Pure functions, no fixtures needed; the
 * per-surface wiring (which cells actually get guarded, on a real page) is
 * covered where each surface formats its own CSV
 * (`test/unit/cas-csv-format.test.ts`, `test/integration/data/library-csv-source.test.ts`).
 */

import assert from "node:assert/strict";

import {
  escapeCsvFormula,
  isTextColumnType,
} from "../../src/data/csvFormulaGuard";

describe("data/csvFormulaGuard", () => {
  describe("isTextColumnType", () => {
    it("is true for char/varchar, either case, from either API", () => {
      assert.equal(isTextColumnType("char"), true);
      assert.equal(isTextColumnType("varchar"), true);
      assert.equal(isTextColumnType("CHAR"), true);
      assert.equal(isTextColumnType("VARCHAR"), true);
    });

    it("is false for every numeric or unrecognised type", () => {
      assert.equal(isTextColumnType("double"), false);
      assert.equal(isTextColumnType("FLOAT"), false);
      assert.equal(isTextColumnType("int32"), false);
      assert.equal(isTextColumnType("date"), false);
      assert.equal(isTextColumnType(""), false);
    });
  });

  describe("escapeCsvFormula", () => {
    it("prefixes a value beginning with =, +, -, or @ with a leading apostrophe", () => {
      assert.equal(escapeCsvFormula("=SUM(A1:A9)"), "'=SUM(A1:A9)");
      assert.equal(escapeCsvFormula("+1 (555) 0100"), "'+1 (555) 0100");
      assert.equal(escapeCsvFormula("-drwxr-xr-x"), "'-drwxr-xr-x");
      assert.equal(escapeCsvFormula("@handle"), "'@handle");
    });

    it("leaves an ordinary value unchanged", () => {
      assert.equal(escapeCsvFormula("Alfred"), "Alfred");
      assert.equal(escapeCsvFormula(""), "");
      assert.equal(escapeCsvFormula("a=b"), "a=b");
    });

    it("only ever inspects the leading character, not every occurrence", () => {
      assert.equal(escapeCsvFormula("x - y = z"), "x - y = z");
    });
  });
});
