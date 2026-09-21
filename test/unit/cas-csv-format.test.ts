// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { csvField, formatCsvPage, pageRowsFor } from "../../src/cas/csvFormat";

/**
 * 11d's CAS CSV formatting — grounded in Finding 11.5 (`verde`, 2026-09-19):
 * CAS returns a numeric column as its formatted, space-padded display string
 * and a missing numeric as a bare `.`, in the JSON `cells` exactly as in the
 * server's own `text/csv`. The cell values below are that recorded shape
 * (`P_FORD.HEART`, a real loaded table).
 */

describe("cas/csvFormat", () => {
  describe("csvField", () => {
    it("passes a plain value through unquoted", () => {
      assert.equal(csvField("Alfred"), "Alfred");
    });

    it("quotes a field containing a comma, a quote, or a line break", () => {
      assert.equal(csvField("a,b"), '"a,b"');
      assert.equal(csvField('say "hi"'), '"say ""hi"""');
      assert.equal(csvField("a\nb"), '"a\nb"');
      assert.equal(csvField("a\rb"), '"a\rb"');
    });
  });

  describe("formatCsvPage", () => {
    const columns = [
      { name: "Status", type: "char" },
      { name: "AgeAtStart", type: "double" },
      { name: "Cholesterol", type: "double" },
      { name: "Note", type: "varchar" },
    ];

    it("Finding 11.5: trims a numeric column's padding and turns a missing '.' into an empty field", () => {
      const csv = formatCsvPage(
        columns,
        [
          { cells: ["Dead", "          29", "           .", ""] },
          { cells: ["Alive", "          57", "         250", "high"] },
        ],
        false,
      );
      assert.equal(csv, "Dead,29,,\nAlive,57,250,high\n");
    });

    it("never trims a character column — its spaces are data", () => {
      const csv = formatCsvPage(
        columns,
        [{ cells: ["  padded ", "1", "2", " ."] }],
        false,
      );
      assert.equal(csv, "  padded ,1,2, .\n");
    });

    it("quotes a character field that contains a comma, and doubles an embedded quote", () => {
      const csv = formatCsvPage(
        columns,
        [{ cells: ["A, B", "1", "2", 'say "x"'] }],
        false,
      );
      assert.equal(csv, '"A, B",1,2,"say ""x"""\n');
    });

    it("prepends the header row, quoted as needed, only when asked", () => {
      const withHeader = formatCsvPage(
        [
          { name: "Status", type: "char" },
          { name: "a,b", type: "double" },
        ],
        [{ cells: ["x", "1"] }],
        true,
      );
      assert.equal(withHeader, 'Status,"a,b"\nx,1\n');
    });

    it("gives a header-only page for an empty first page, and an empty string for any other empty page", () => {
      assert.equal(
        formatCsvPage(columns, [], true),
        "Status,AgeAtStart,Cholesterol,Note\n",
      );
      assert.equal(formatCsvPage(columns, [], false), "");
    });

    it("renders null, undefined, numbers, and booleans without throwing", () => {
      const csv = formatCsvPage(
        columns,
        [{ cells: [null, 5, undefined, true] }],
        false,
      );
      assert.equal(csv, ",5,,true\n");
    });

    it("treats a cell past the last column as text rather than dropping it", () => {
      const csv = formatCsvPage(
        [{ name: "a", type: "double" }],
        [{ cells: ["  1", "  extra"] }],
        false,
      );
      assert.equal(csv, "1,  extra\n");
    });

    it("matches a column type case-insensitively", () => {
      const csv = formatCsvPage(
        [{ name: "a", type: "CHAR" }],
        [{ cells: [" x "] }],
        false,
      );
      assert.equal(csv, " x \n");
    });
  });

  describe("pageRowsFor", () => {
    it("caps at 500 rows for a narrow table", () => {
      assert.equal(pageRowsFor(3), 500);
    });

    it("Finding 11.6: shrinks the page for a wide table so it stays under the 1 MiB body cap", () => {
      // 76 columns × ~12 bytes × 500 rows was ~458 KB; the target keeps a
      // wider table proportionally smaller.
      assert.equal(pageRowsFor(76), 394);
      assert.ok(pageRowsFor(400) < pageRowsFor(76));
    });

    it("never returns less than one row, and tolerates zero columns", () => {
      assert.equal(pageRowsFor(1_000_000), 1);
      assert.equal(pageRowsFor(0), 500);
    });
  });
});
