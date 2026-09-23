// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `src/data/csvParse.ts` — 12e's RFC-4180 page parser, the half of the
 * SAS-library CSV formula-injection guard that reads an already-quoted
 * server page back into fields (`csvField`, the re-encoding half, is
 * exercised via `cas/csvFormat.ts`'s own tests, which import the identical
 * re-export). Round-trips every shape `formatCsvPage`
 * (`test/unit/cas-csv-format.test.ts`) is already known to produce, since
 * that is exactly what a SAS library table's `rowsAsCSV` response looks
 * like (Finding 7.20, `docs/phases/phase-7.md`).
 */

import assert from "node:assert/strict";

import { csvField, parseCsvPage } from "../../src/data/csvParse";

describe("data/csvParse", () => {
  describe("csvField", () => {
    it("passes a plain value through unquoted", () => {
      assert.equal(csvField("Alfred"), "Alfred");
    });

    it("quotes a field containing a comma, a quote, or a line break", () => {
      assert.equal(csvField("a,b"), '"a,b"');
      assert.equal(csvField('say "hi"'), '"say ""hi"""');
      assert.equal(csvField("a\nb"), '"a\nb"');
    });
  });

  describe("parseCsvPage", () => {
    it("parses an empty page to no rows", () => {
      assert.deepEqual(parseCsvPage(""), []);
    });

    it("splits plain comma-separated rows", () => {
      assert.deepEqual(parseCsvPage("a,b,c\nd,e,f\n"), [
        ["a", "b", "c"],
        ["d", "e", "f"],
      ]);
    });

    it("reads a quoted field containing a comma", () => {
      assert.deepEqual(parseCsvPage('"a,b",c\n'), [["a,b", "c"]]);
    });

    it("un-doubles an embedded quote inside a quoted field", () => {
      assert.deepEqual(parseCsvPage('"say ""hi""",c\n'), [['say "hi"', "c"]]);
    });

    it("reads a literal newline inside a quoted field without ending the row", () => {
      assert.deepEqual(parseCsvPage('"line1\nline2",c\n'), [
        ["line1\nline2", "c"],
      ]);
    });

    it("reads an empty field as an empty string, quoted or not", () => {
      assert.deepEqual(parseCsvPage(',b,""\n'), [["", "b", ""]]);
    });

    it("round-trips every field formatCsvPage/csvField can produce", () => {
      const fields = ["plain", "a,b", 'say "hi"', "a\nb", "", "  padded "];
      const encoded = `${fields.map(csvField).join(",")}\n`;
      assert.deepEqual(parseCsvPage(encoded), [fields]);
    });

    it("tolerates a page missing its final newline, keeping the trailing row", () => {
      assert.deepEqual(parseCsvPage("a,b\nc,d"), [
        ["a", "b"],
        ["c", "d"],
      ]);
    });

    it("drops a stray carriage return rather than folding it into a field", () => {
      assert.deepEqual(parseCsvPage("a,b\r\nc,d\r\n"), [
        ["a", "b"],
        ["c", "d"],
      ]);
    });
  });
});
