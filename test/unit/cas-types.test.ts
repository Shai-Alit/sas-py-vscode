// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  isCasColumn,
  isCaslib,
  isCasServer,
  isCasTable,
  readCaslibItem,
  readCasColumnItem,
  readCasServerItem,
  readCasTableItem,
  type CasServerItem,
  type CaslibItem,
  type CasTableItem,
} from "../../src/cas/types";
import { readJsonFixture } from "../helpers/fixtures";

/**
 * The CAS browsing vocabulary — grounded in Findings 8.1–8.3/8.7/8.8
 * (`verde`): every level's own listing entry already carries what this tree
 * needs, with no per-item follow-up the way Phase 7's sparse `librefs`
 * listing needed one.
 */

describe("cas/types", () => {
  describe("readCasServerItem", () => {
    it("reads a server's name, rest port/protocol, and links", () => {
      const listing = readJsonFixture("cas", "servers.json") as {
        items: unknown[];
      };
      const server = readCasServerItem(listing.items[0]);
      assert.ok(server);
      assert.equal(server.kind, "server");
      assert.equal(server.name, "cas-shared-default");
      assert.equal(server.restPort, 8777);
      assert.equal(server.restProtocol, "https");
      assert.ok(server.links.some((l) => l.rel === "caslibs"));
    });

    it("drops an entry with no usable name", () => {
      assert.equal(readCasServerItem({ links: [] }), undefined);
      assert.equal(readCasServerItem(null), undefined);
    });

    it("omits restPort/restProtocol rather than defaulting them when absent", () => {
      const server = readCasServerItem({ name: "cas-shared-default" });
      assert.ok(server);
      assert.equal(server.restPort, undefined);
      assert.equal(server.restProtocol, undefined);
    });
  });

  describe("readCaslibItem", () => {
    const server: CasServerItem = {
      kind: "server",
      name: "cas-shared-default",
      links: [],
    };

    it("reads a caslib's name and carries the owning server's name", () => {
      const listing = readJsonFixture("cas", "caslibs-page1.json") as {
        items: unknown[];
      };
      const caslib = readCaslibItem(listing.items[0], server);
      assert.ok(caslib);
      assert.equal(caslib.kind, "caslib");
      assert.equal(caslib.serverName, "cas-shared-default");
      assert.equal(caslib.name, "Public");
      assert.ok(caslib.links.some((l) => l.rel === "tables"));
    });

    it("drops an entry with no usable name", () => {
      assert.equal(readCaslibItem({ links: [] }, server), undefined);
    });

    it("drops a non-object entry", () => {
      assert.equal(readCaslibItem(null, server), undefined);
      assert.equal(readCaslibItem("Public", server), undefined);
    });
  });

  describe("readCasTableItem", () => {
    const caslib: CaslibItem = {
      kind: "caslib",
      serverName: "cas-shared-default",
      name: "Public",
      links: [],
    };

    it("reads an unloaded table's state and zeroed counts", () => {
      const listing = readJsonFixture("cas", "tables.json") as {
        items: unknown[];
      };
      const table = readCasTableItem(listing.items[0], caslib);
      assert.ok(table);
      assert.equal(table.kind, "table");
      assert.equal(table.serverName, "cas-shared-default");
      assert.equal(table.caslibName, "Public");
      assert.equal(table.name, "REFERENCE_DATA");
      assert.equal(table.state, "unloaded");
      assert.equal(table.rowCount, 0);
      assert.equal(table.columnCount, 0);
      assert.ok(table.links.some((l) => l.rel === "updateState"));
    });

    it("reads a loaded table's real row/column counts", () => {
      const listing = readJsonFixture("cas", "tables.json") as {
        items: unknown[];
      };
      const table = readCasTableItem(listing.items[1], caslib);
      assert.ok(table);
      assert.equal(table.state, "loaded");
      assert.equal(table.rowCount, 12);
      assert.equal(table.columnCount, 2);
    });

    it("drops an entry with no usable name", () => {
      assert.equal(readCasTableItem({ links: [] }, caslib), undefined);
    });

    it("drops a non-object entry", () => {
      assert.equal(readCasTableItem(null, caslib), undefined);
    });

    it("omits state/rowCount/columnCount rather than defaulting them when absent", () => {
      const table = readCasTableItem({ name: "X", links: [] }, caslib);
      assert.ok(table);
      assert.equal(table.state, undefined);
      assert.equal(table.rowCount, undefined);
      assert.equal(table.columnCount, undefined);
    });
  });

  describe("readCasColumnItem", () => {
    const table: CasTableItem = {
      kind: "table",
      serverName: "cas-shared-default",
      caslibName: "Public",
      name: "LOOKUP_TABLE",
      links: [],
    };

    it("reads a column's name, type, and formattedLength, carrying its parent identity", () => {
      const listing = readJsonFixture("cas", "columns.json") as {
        items: unknown[];
      };
      const column = readCasColumnItem(listing.items[0], table);
      assert.ok(column);
      assert.equal(column.kind, "column");
      assert.equal(column.serverName, "cas-shared-default");
      assert.equal(column.caslibName, "Public");
      assert.equal(column.tableName, "LOOKUP_TABLE");
      assert.equal(column.name, "CODE");
      assert.equal(column.type, "varchar");
      assert.equal(column.formattedLength, 8);
    });

    it("falls back to an empty type when the field is missing or not a string", () => {
      const column = readCasColumnItem({ name: "X" }, table);
      assert.ok(column);
      assert.equal(column.type, "");
    });

    it("drops an entry with no usable name", () => {
      assert.equal(readCasColumnItem({ type: "varchar" }, table), undefined);
    });

    it("drops a non-object entry", () => {
      assert.equal(readCasColumnItem(null, table), undefined);
    });
  });

  describe("kind guards", () => {
    const server: CasServerItem = {
      kind: "server",
      name: "cas-shared-default",
      links: [],
    };
    const caslib: CaslibItem = {
      kind: "caslib",
      serverName: "cas-shared-default",
      name: "Public",
      links: [],
    };
    const table: CasTableItem = {
      kind: "table",
      serverName: "cas-shared-default",
      caslibName: "Public",
      name: "LOOKUP_TABLE",
      links: [],
    };
    const column = {
      kind: "column" as const,
      serverName: "cas-shared-default",
      caslibName: "Public",
      tableName: "LOOKUP_TABLE",
      name: "CODE",
      type: "varchar",
    };

    it("distinguish every kind from every other kind", () => {
      assert.ok(isCasServer(server));
      assert.ok(
        !isCasServer(caslib) && !isCasServer(table) && !isCasServer(column),
      );

      assert.ok(isCaslib(caslib));
      assert.ok(!isCaslib(server) && !isCaslib(table) && !isCaslib(column));

      assert.ok(isCasTable(table));
      assert.ok(
        !isCasTable(server) && !isCasTable(caslib) && !isCasTable(column),
      );

      assert.ok(isCasColumn(column));
      assert.ok(
        !isCasColumn(server) && !isCasColumn(caslib) && !isCasColumn(table),
      );
    });
  });
});
