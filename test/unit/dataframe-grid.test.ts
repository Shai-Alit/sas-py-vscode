// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  dataFrameGridLimits,
  DEFAULT_DATAFRAME_GRID_LIMITS,
  MAX_DATAFRAME_GRID_COLUMNS,
  MAX_DATAFRAME_GRID_ROWS,
  parseDataFrameGrid,
  parseDataFrameGridFile,
  parseDataFrameGridOutput,
} from "../../src/backend/dataFrameGrid";

/** A valid payload's grid part: one unnamed index level and two columns. */
function grid(): Record<string, unknown> {
  return {
    format: 1,
    rows: 3,
    columns: 2,
    fields: [
      { name: "", kind: "number", index: true },
      { name: "when", kind: "datetime", index: false },
      { name: "what", kind: "text", index: false },
    ],
    data: [
      [0, "2026-10-01 00:00:00", "a"],
      [1, null, "9007199254740993"],
    ],
  };
}

function refusal(value: unknown): string | undefined {
  const parsed = parseDataFrameGrid(value);
  return parsed.ok ? undefined : parsed.reason;
}

describe("backend/dataFrameGrid", () => {
  describe("dataFrameGridLimits", () => {
    it("keeps whole numbers from 0 to each maximum", () => {
      assert.deepEqual(dataFrameGridLimits(0, 0), {
        maxRows: 0,
        maxColumns: 0,
      });
      assert.deepEqual(
        dataFrameGridLimits(
          MAX_DATAFRAME_GRID_ROWS,
          MAX_DATAFRAME_GRID_COLUMNS,
        ),
        {
          maxRows: MAX_DATAFRAME_GRID_ROWS,
          maxColumns: MAX_DATAFRAME_GRID_COLUMNS,
        },
      );
    });

    it("falls back to the default for anything else a settings.json can hold", () => {
      for (const value of [
        undefined,
        null,
        "100",
        -1,
        1.5,
        Number.NaN,
        Infinity,
      ]) {
        assert.deepEqual(
          dataFrameGridLimits(value, value),
          DEFAULT_DATAFRAME_GRID_LIMITS,
          String(value),
        );
      }
      assert.deepEqual(
        dataFrameGridLimits(
          MAX_DATAFRAME_GRID_ROWS + 1,
          MAX_DATAFRAME_GRID_COLUMNS + 1,
        ),
        DEFAULT_DATAFRAME_GRID_LIMITS,
      );
    });
  });

  describe("parseDataFrameGrid", () => {
    it("accepts a valid grid, keeping only the grid's own fields", () => {
      const parsed = parseDataFrameGrid({ ...grid(), extra: "<script>" });
      assert.deepEqual(parsed, {
        ok: true,
        value: {
          rows: 3,
          columns: 2,
          fields: (grid().fields as unknown[]).slice(),
          data: (grid().data as unknown[]).slice(),
        },
      });
    });

    it("drops a field's unknown properties", () => {
      const value = grid();
      value.fields = [
        { name: "", kind: "number", index: true, style: "x" },
        { name: "when", kind: "datetime", index: false },
        { name: "what", kind: "text", index: false },
      ];
      const parsed = parseDataFrameGrid(value);
      assert.ok(parsed.ok);
      assert.deepEqual(parsed.value.fields[0], {
        name: "",
        kind: "number",
        index: true,
      });
    });

    it("accepts an empty DataFrame", () => {
      const parsed = parseDataFrameGrid({
        format: 1,
        rows: 0,
        columns: 0,
        fields: [{ name: "", kind: "number", index: true }],
        data: [],
      });
      assert.ok(parsed.ok);
    });

    it("refuses anything but an object", () => {
      for (const value of [null, [], "grid", 1]) {
        assert.equal(refusal(value), "it is not an object");
      }
    });

    it("refuses a format other than 1", () => {
      assert.equal(refusal({ ...grid(), format: 2 }), "its format is not 1");
      assert.equal(refusal({ ...grid(), format: "1" }), "its format is not 1");
      const unformatted = grid();
      delete unformatted.format;
      assert.equal(refusal(unformatted), "its format is not 1");
    });

    it("refuses counts that are not whole numbers of zero or more", () => {
      for (const rows of [-1, 1.5, "3", 2 ** 53]) {
        assert.equal(
          refusal({ ...grid(), rows }),
          "its row count is not a whole number",
        );
      }
      assert.equal(
        refusal({ ...grid(), columns: -1 }),
        "its column count is not a whole number",
      );
    });

    it("refuses fields that are not a list of valid fields", () => {
      assert.equal(
        refusal({ ...grid(), fields: {} }),
        "its fields are not a list",
      );
      for (const field of [
        null,
        { name: 1, kind: "text", index: false },
        { name: "x".repeat(2003), kind: "text", index: false },
        { name: "x", kind: "html", index: false },
        { name: "x", kind: "text", index: "no" },
      ]) {
        assert.equal(
          refusal({ ...grid(), fields: [field] }),
          "a field is not valid",
        );
      }
    });

    it("refuses more shown columns than the DataFrame has, or than the maximum", () => {
      assert.equal(
        refusal({ ...grid(), columns: 1 }),
        "it has more fields than it says",
      );
      const many = Array.from(
        { length: MAX_DATAFRAME_GRID_COLUMNS + 1 },
        () => ({ name: "c", kind: "text", index: false }),
      );
      assert.equal(
        refusal({ ...grid(), columns: 1000, fields: many, data: [] }),
        "it has more fields than it says",
      );
    });

    it("refuses more than 32 index levels", () => {
      const levels = Array.from({ length: 33 }, () => ({
        name: "",
        kind: "text",
        index: true,
      }));
      assert.equal(
        refusal({ ...grid(), fields: levels, data: [] }),
        "it has more fields than it says",
      );
    });

    it("refuses more rows than the DataFrame has, or than the maximum", () => {
      assert.equal(refusal({ ...grid(), data: {} }), "its data is not a list");
      assert.equal(
        refusal({ ...grid(), rows: 1 }),
        "it has more rows than it says",
      );
      const many = Array.from({ length: MAX_DATAFRAME_GRID_ROWS + 1 }, () => [
        0,
        null,
        null,
      ]);
      assert.equal(
        refusal({ ...grid(), rows: 10 ** 6, data: many }),
        "it has more rows than it says",
      );
    });

    it("refuses a row without one cell per field", () => {
      for (const row of [[0, null], [0, null, "a", "b"], "row"]) {
        assert.equal(
          refusal({ ...grid(), data: [row] }),
          "a row does not have one cell per field",
        );
      }
    });

    it("refuses a cell that is not null, a finite number or a short string", () => {
      for (const cell of [
        Number.NaN,
        Infinity,
        true,
        {},
        [],
        "x".repeat(2003),
      ]) {
        assert.equal(
          refusal({ ...grid(), data: [[0, null, cell]] }),
          "a cell is not valid",
          JSON.stringify(cell),
        );
      }
      assert.equal(
        refusal({ ...grid(), data: [[0, null, "x".repeat(2002)]] }),
        undefined,
      );
    });
  });

  describe("parseDataFrameGridFile", () => {
    it("keeps the HTML", () => {
      const parsed = parseDataFrameGridFile({ ...grid(), html: "<table/>" });
      assert.ok(parsed.ok);
      assert.equal(parsed.value.html, "<table/>");
    });

    it("refuses a file without string HTML, or with an invalid grid", () => {
      assert.deepEqual(parseDataFrameGridFile(grid()), {
        ok: false,
        reason: "its html is not a string",
      });
      assert.deepEqual(parseDataFrameGridFile({ html: "" }), {
        ok: false,
        reason: "its format is not 1",
      });
    });
  });

  describe("parseDataFrameGridOutput", () => {
    it("keeps the summary", () => {
      const parsed = parseDataFrameGridOutput({
        ...grid(),
        summary: "Rows: 3",
      });
      assert.ok(parsed.ok);
      assert.equal(parsed.value.summary, "Rows: 3");
    });

    it("refuses an output without a string summary", () => {
      assert.deepEqual(parseDataFrameGridOutput({ ...grid(), summary: 3 }), {
        ok: false,
        reason: "its summary is not a string",
      });
    });
  });
});
