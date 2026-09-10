// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  isLibrary,
  isTable,
  readLibraryItem,
  readTableItem,
  type LibraryItem,
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
