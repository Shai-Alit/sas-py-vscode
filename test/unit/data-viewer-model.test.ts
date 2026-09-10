// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  isReadyMessage,
  isRequestRowsMessage,
  toWireColumns,
  toWireRows,
} from "../../src/data/dataViewerModel";
import type { Column, RowItem } from "../../src/data/types";

/**
 * `dataViewerModel.ts`'s own pure functions and message-shape guards — the
 * host↔webview protocol for 7b's data viewer panel (ADR-0028). This module is
 * `vscode`-free and not under `src/webview/`, so `.c8rc.json` cannot exclude
 * it (`scripts/check-coverage-scope.mjs` would reject that exclusion) — it
 * needs its own unit coverage the same way `resultPanelModel.ts` gets one in
 * `result-panel-model.test.ts`, caught in review: exercising it only through
 * `test/integration/data/data-viewer-panel.test.ts` does not count, since the
 * integration tier runs outside the unit tier's `c8` measurement.
 */
describe("data/dataViewerModel", () => {
  describe("toWireColumns", () => {
    function column(overrides: Partial<Column> = {}): Column {
      return { name: "Age", type: "NUM", ...overrides };
    }

    it("uses the column's label as headerName when the deployment supplied one", () => {
      assert.deepEqual(toWireColumns([column({ label: "Age (years)" })]), [
        { field: "Age", headerName: "Age (years)", type: "NUM" },
      ]);
    });

    it("falls back to the column's own name when there is no label", () => {
      assert.deepEqual(toWireColumns([column({ label: undefined })]), [
        { field: "Age", headerName: "Age", type: "NUM" },
      ]);
    });

    it("maps every column in order, passing the SAS type through unmodified", () => {
      const columns: readonly Column[] = [
        column({ name: "Name", type: "CHAR", label: undefined }),
        column({ name: "Sex", type: "CHAR", label: undefined }),
        column({ name: "Age", type: "NUM", label: "Age (years)" }),
      ];
      assert.deepEqual(toWireColumns(columns), [
        { field: "Name", headerName: "Name", type: "CHAR" },
        { field: "Sex", headerName: "Sex", type: "CHAR" },
        { field: "Age", headerName: "Age (years)", type: "NUM" },
      ]);
    });

    it("maps an empty column list to an empty list", () => {
      assert.deepEqual(toWireColumns([]), []);
    });
  });

  describe("toWireRows", () => {
    function row(cells: readonly unknown[]): RowItem {
      return { cells };
    }

    it("reduces a page of RowItems to plain cells arrays, in order", () => {
      assert.deepEqual(
        toWireRows([row(["Alfred", "M", 14]), row(["Alice", "F", 13])]),
        [
          ["Alfred", "M", 14],
          ["Alice", "F", 13],
        ],
      );
    });

    it("copies each row's cells rather than aliasing the source array", () => {
      const cells = ["Alfred", "M", 14];
      const [wireRow] = toWireRows([row(cells)]);
      assert.deepEqual(wireRow, cells);
      assert.notEqual(
        wireRow,
        cells,
        "must be a fresh array, not the same one",
      );
    });

    it("maps an empty page to an empty list", () => {
      assert.deepEqual(toWireRows([]), []);
    });
  });

  describe("isReadyMessage", () => {
    it("accepts a bare ready message", () => {
      assert.equal(isReadyMessage({ type: "ready" }), true);
    });

    it("rejects a non-object", () => {
      assert.equal(isReadyMessage("ready"), false);
      assert.equal(isReadyMessage(undefined), false);
      assert.equal(isReadyMessage(null), false);
    });

    it("rejects an object with the wrong type discriminant", () => {
      assert.equal(isReadyMessage({ type: "requestRows" }), false);
    });
  });

  describe("isRequestRowsMessage", () => {
    const valid = {
      type: "requestRows",
      requestId: "r1",
      start: 0,
      limit: 2,
      sort: [],
      filter: "",
    };

    it("accepts a well-formed requestRows message with no sort/filter active", () => {
      assert.equal(isRequestRowsMessage(valid), true);
    });

    it("accepts a well-formed requestRows message with sort and a filter", () => {
      assert.equal(
        isRequestRowsMessage({
          ...valid,
          sort: [{ key: "Age", direction: "descending" }],
          filter: "Sex='F'",
        }),
        true,
      );
    });

    it("rejects a non-object", () => {
      assert.equal(isRequestRowsMessage("requestRows"), false);
      assert.equal(isRequestRowsMessage(undefined), false);
    });

    it("rejects the wrong type discriminant", () => {
      assert.equal(isRequestRowsMessage({ ...valid, type: "ready" }), false);
    });

    it("rejects a non-string requestId", () => {
      assert.equal(isRequestRowsMessage({ ...valid, requestId: 1 }), false);
    });

    it("rejects a non-number start", () => {
      assert.equal(isRequestRowsMessage({ ...valid, start: "0" }), false);
    });

    it("rejects a non-number limit", () => {
      assert.equal(isRequestRowsMessage({ ...valid, limit: "2" }), false);
    });

    it("rejects a non-array sort", () => {
      assert.equal(isRequestRowsMessage({ ...valid, sort: "Age" }), false);
    });

    it("rejects a sort entry with a bad direction", () => {
      assert.equal(
        isRequestRowsMessage({
          ...valid,
          sort: [{ key: "Age", direction: "up" }],
        }),
        false,
      );
    });

    it("rejects a null sort entry", () => {
      assert.equal(isRequestRowsMessage({ ...valid, sort: [null] }), false);
    });

    it("rejects a non-object sort entry", () => {
      assert.equal(isRequestRowsMessage({ ...valid, sort: ["Age"] }), false);
    });

    it("rejects a sort entry with a non-string key", () => {
      assert.equal(
        isRequestRowsMessage({
          ...valid,
          sort: [{ key: 1, direction: "ascending" }],
        }),
        false,
      );
    });

    it("rejects a non-string filter", () => {
      assert.equal(isRequestRowsMessage({ ...valid, filter: 1 }), false);
    });

    it("rejects a requestRows message missing every field beyond type", () => {
      assert.equal(isRequestRowsMessage({ type: "requestRows" }), false);
    });
  });
});
