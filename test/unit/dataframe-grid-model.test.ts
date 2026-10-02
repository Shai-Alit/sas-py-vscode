// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type { DataFrameCell } from "../../src/backend/dataFrameGrid";
import {
  compareCells,
  fitsWithoutScrolling,
  formatCell,
  GRID_VISIBLE_ROWS,
  gridColumns,
  gridRows,
} from "../../src/notebook/dataFrameGridModel";

describe("notebook/dataFrameGridModel", () => {
  describe("gridColumns and gridRows", () => {
    it("keys columns by position, so repeated labels stay apart", () => {
      const fields = [
        { name: "", kind: "number", index: true },
        { name: "a", kind: "text", index: false },
        { name: "a", kind: "number", index: false },
      ] as const;

      assert.deepEqual(gridColumns(fields), [
        { key: "c0", header: "", kind: "number", index: true },
        { key: "c1", header: "a", kind: "text", index: false },
        { key: "c2", header: "a", kind: "number", index: false },
      ]);
      assert.deepEqual(
        gridRows({
          rows: 2,
          columns: 2,
          fields,
          data: [
            [0, "x", 1],
            [1, null, 2],
          ],
        }),
        [
          { c0: 0, c1: "x", c2: 1 },
          { c0: 1, c1: null, c2: 2 },
        ],
      );
    });
  });

  describe("formatCell", () => {
    it("reads a missing value as pandas prints it for the column's kind", () => {
      assert.equal(formatCell(null, "number"), "NaN");
      assert.equal(formatCell(null, "datetime"), "NaT");
      assert.equal(formatCell(null, "text"), "None");
      assert.equal(formatCell(undefined, "text"), "None");
    });

    it("reads a number as JavaScript writes it, and a string as itself", () => {
      assert.equal(formatCell(1.5, "number"), "1.5");
      assert.equal(formatCell(-0.25, "number"), "-0.25");
      assert.equal(formatCell("inf", "number"), "inf");
      assert.equal(formatCell("<b>x</b>", "text"), "<b>x</b>");
    });
  });

  describe("compareCells", () => {
    function sorted(
      cells: readonly DataFrameCell[],
      kind: "number" | "datetime" | "text",
    ): DataFrameCell[] {
      return [...cells].sort((a, b) => compareCells(a, b, kind));
    }

    it("sorts a missing value first", () => {
      assert.deepEqual(sorted([2, null, 1], "number"), [null, 1, 2]);
      assert.deepEqual(sorted(["b", null, "a"], "text"), [null, "a", "b"]);
      assert.equal(compareCells(null, undefined, "text"), 0);
    });

    it("sorts infinities and integers past 2^53 by value in a number column", () => {
      assert.deepEqual(
        sorted(
          ["inf", "9007199254740993", 1.5, "-inf", "-9007199254740993", 2],
          "number",
        ),
        ["-inf", "-9007199254740993", 1.5, 2, "9007199254740993", "inf"],
      );
      // 2^53 + 1 and 2^53 + 2 would round to the same number.
      assert.equal(
        compareCells("9007199254740993", "9007199254740994", "number"),
        -1,
      );
      assert.equal(compareCells("inf", "inf", "number"), 0);
    });

    it("sorts any other string in a number column after every number, as text", () => {
      assert.equal(compareCells("n/a", 1, "number"), 1);
      assert.equal(compareCells(1, "n/a", "number"), -1);
      assert.equal(compareCells("0", "n/a", "number"), -1);
      assert.deepEqual(sorted(["b", 10, "a", "9", "inf"], "number"), [
        "9",
        10,
        "inf",
        "a",
        "b",
      ]);
    });

    it("compares text by code unit, as Python compares str", () => {
      assert.deepEqual(sorted(["b", "B", "a", "é"], "text"), [
        "B",
        "a",
        "b",
        "é",
      ]);
      assert.deepEqual(sorted(["10", "9"], "text"), ["10", "9"]);
      assert.equal(compareCells("x", "x", "text"), 0);
    });

    it("compares dates as their ISO text", () => {
      assert.deepEqual(
        sorted(["2026-10-01 00:00:00", "2025-12-31 23:59:59"], "datetime"),
        ["2025-12-31 23:59:59", "2026-10-01 00:00:00"],
      );
    });
  });

  describe("fitsWithoutScrolling", () => {
    it("fits up to GRID_VISIBLE_ROWS rows", () => {
      assert.equal(fitsWithoutScrolling(GRID_VISIBLE_ROWS), true);
      assert.equal(fitsWithoutScrolling(GRID_VISIBLE_ROWS + 1), false);
    });
  });
});
