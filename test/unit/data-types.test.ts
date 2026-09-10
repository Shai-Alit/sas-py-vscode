// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  isLibrary,
  isTable,
  readColumnItem,
  readLibraryItem,
  readRowItem,
  readTableDetail,
  readTableItem,
  type LibraryItem,
  type TableItem,
} from "../../src/data/types";
import { readJsonFixture } from "../helpers/fixtures";

/**
 * The SAS Libraries vocabulary — grounded in Findings 7.1/7.2/7.5/7.8
 * (`verde`, 2026-09-03/2026-09-09): a library's sparse list entry and its
 * rich per-item detail differ only in which optional fields are present, and
 * a table inherits `readOnly` from its owning library rather than carrying
 * one of its own.
 */

describe("data/types", () => {
  describe("readLibraryItem", () => {
    it("reads the sparse list entry — name and links, no readOnly", () => {
      const listing = readJsonFixture("data", "librefs-page1.json") as {
        items: unknown[];
      };
      const sashelp = readLibraryItem(listing.items[0]);
      assert.ok(sashelp);
      assert.equal(sashelp.name, "SASHELP");
      assert.equal(sashelp.readOnly, undefined);
      assert.equal(sashelp.concatenationCount, undefined);
      assert.ok(sashelp.links.some((l) => l.rel === "self"));
    });

    it("reads the rich per-item detail — readOnly and concatenationCount present", () => {
      const rich = readLibraryItem(
        readJsonFixture("data", "library-sashelp.json"),
      );
      assert.ok(rich);
      assert.equal(rich.kind, "library");
      assert.equal(rich.name, "SASHELP");
      assert.equal(rich.readOnly, true);
      assert.equal(rich.concatenationCount, 4);
      assert.ok(rich.links.some((l) => l.rel === "tables"));
    });

    it("reads WORK as writable with no concatenation", () => {
      const work = readLibraryItem(
        readJsonFixture("data", "library-work.json"),
      );
      assert.ok(work);
      assert.equal(work.readOnly, false);
      assert.equal(work.concatenationCount, 0);
    });

    it("omits absent optional fields rather than carrying undefined", () => {
      const parsed = readLibraryItem({ name: "WORK" });
      assert.deepEqual(parsed, { kind: "library", name: "WORK", links: [] });
    });

    it("drops an entry with no usable name", () => {
      assert.equal(readLibraryItem({ id: "x" }), undefined);
      assert.equal(readLibraryItem({ name: "" }), undefined);
      assert.equal(readLibraryItem("not an object"), undefined);
      assert.equal(readLibraryItem(null), undefined);
    });
  });

  describe("readTableItem", () => {
    const readOnlyLibrary: LibraryItem = {
      kind: "library",
      name: "SASHELP",
      readOnly: true,
      links: [],
    };
    const writableLibrary: LibraryItem = {
      kind: "library",
      name: "WORK",
      readOnly: false,
      links: [],
    };

    it("inherits readOnly from the owning library", () => {
      const table = readTableItem({ name: "CLASS" }, readOnlyLibrary);
      assert.deepEqual(table, {
        kind: "table",
        libref: "SASHELP",
        name: "CLASS",
        readOnly: true,
        links: [],
      });
    });

    it("inherits writable just as faithfully", () => {
      const table = readTableItem({ name: "SCRATCH" }, writableLibrary);
      assert.equal(table?.readOnly, false);
    });

    it("carries no readOnly when the library's own is absent", () => {
      const noOpinion: LibraryItem = { kind: "library", name: "X", links: [] };
      const table = readTableItem({ name: "T" }, noOpinion);
      assert.deepEqual(table, {
        kind: "table",
        libref: "X",
        name: "T",
        links: [],
      });
    });

    it("reads a real recorded table entry (Finding 7.8, SASHELP.AACOMP)", () => {
      const page = readJsonFixture("data", "tables-sashelp-page1.json") as {
        items: unknown[];
      };
      const table = readTableItem(page.items[0], readOnlyLibrary);
      assert.ok(table);
      assert.equal(table.name, "AACOMP");
      assert.equal(table.libref, "SASHELP");
      assert.equal(table.readOnly, true);
      assert.ok(table.links.some((l) => l.rel === "self"));
    });

    it("drops an entry with no usable name", () => {
      assert.equal(readTableItem({}, readOnlyLibrary), undefined);
      assert.equal(readTableItem({ name: "" }, readOnlyLibrary), undefined);
    });

    it("drops a non-object or null value outright", () => {
      assert.equal(readTableItem("not an object", readOnlyLibrary), undefined);
      assert.equal(readTableItem(null, readOnlyLibrary), undefined);
    });
  });

  describe("readTableDetail", () => {
    const table: TableItem = {
      kind: "table",
      libref: "SASHELP",
      name: "CLASS",
      readOnly: true,
      links: [],
    };

    it("reads name from the body and libref from the caller's table, with both counts present", () => {
      const detail = readTableDetail(
        { name: "CLASS", rowCount: 19, columnCount: 5, links: [] },
        table,
      );
      assert.deepEqual(detail, {
        kind: "tableDetail",
        libref: "SASHELP",
        name: "CLASS",
        rowCount: 19,
        columnCount: 5,
        links: [],
      });
    });

    it("omits rowCount/columnCount rather than carrying undefined when absent — caught in review: never exercised before, only ever tested with both present", () => {
      const detail = readTableDetail({ name: "CLASS" }, table);
      assert.deepEqual(detail, {
        kind: "tableDetail",
        libref: "SASHELP",
        name: "CLASS",
        links: [],
      });
    });

    it("ignores a non-number rowCount/columnCount the same way it ignores an absent one", () => {
      const detail = readTableDetail(
        { name: "CLASS", rowCount: "19", columnCount: null },
        table,
      );
      assert.deepEqual(detail, {
        kind: "tableDetail",
        libref: "SASHELP",
        name: "CLASS",
        links: [],
      });
    });

    it("drops a value with no usable name", () => {
      assert.equal(readTableDetail({}, table), undefined);
      assert.equal(readTableDetail({ name: "" }, table), undefined);
    });

    it("drops a non-object or null value outright", () => {
      assert.equal(readTableDetail("not an object", table), undefined);
      assert.equal(readTableDetail(null, table), undefined);
    });
  });

  describe("readColumnItem", () => {
    it("reads name and type, with no length/label/format/informat when the body carries none", () => {
      const column = readColumnItem({ name: "Age", type: "NUM" });
      assert.deepEqual(column, { name: "Age", type: "NUM" });
    });

    it("reads length, label, format and informat when the deployment supplied real, non-empty values — caught in review: no fixture had ever exercised this path, only the empty-string-drops-to-absent one below", () => {
      const column = readColumnItem({
        name: "Age",
        type: "NUM",
        length: 8,
        label: "Age (years)",
        format: "BEST12.",
        informat: "BEST32.",
      });
      assert.deepEqual(column, {
        name: "Age",
        type: "NUM",
        length: 8,
        label: "Age (years)",
        format: "BEST12.",
        informat: "BEST32.",
      });
    });

    it("treats an empty-string label/format/informat as absent, same as a missing one", () => {
      const column = readColumnItem({
        name: "Age",
        type: "NUM",
        label: "",
        format: "",
        informat: "",
      });
      assert.deepEqual(column, { name: "Age", type: "NUM" });
    });

    it("defaults type to an empty string when absent or not a string", () => {
      assert.equal(readColumnItem({ name: "Age" })?.type, "");
      assert.equal(readColumnItem({ name: "Age", type: 8 })?.type, "");
    });

    it("drops a value with no usable name", () => {
      assert.equal(readColumnItem({}), undefined);
      assert.equal(readColumnItem({ name: "" }), undefined);
    });

    it("drops a non-object or null value outright", () => {
      assert.equal(readColumnItem("not an object"), undefined);
      assert.equal(readColumnItem(null), undefined);
    });
  });

  describe("readRowItem", () => {
    it("reads a cells array", () => {
      assert.deepEqual(readRowItem({ cells: ["Alfred", "M", 14] }), {
        cells: ["Alfred", "M", 14],
      });
    });

    it("drops a value with no cells array", () => {
      assert.equal(readRowItem({ version: 1 }), undefined);
      assert.equal(readRowItem({ cells: "not an array" }), undefined);
    });

    it("drops a non-object or null value outright", () => {
      assert.equal(readRowItem("not an object"), undefined);
      assert.equal(readRowItem(null), undefined);
    });
  });

  describe("isLibrary / isTable", () => {
    it("discriminate on kind", () => {
      const library: LibraryItem = { kind: "library", name: "WORK", links: [] };
      const table = readTableItem({ name: "T" }, library);
      assert.ok(table);
      assert.equal(isLibrary(library), true);
      assert.equal(isTable(library), false);
      assert.equal(isLibrary(table), false);
      assert.equal(isTable(table), true);
    });
  });
});
