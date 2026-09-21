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
  readCasConnectionInfo,
  readCasServerItem,
  readCasTableItem,
  readCasTableProperties,
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

  describe("readCasConnectionInfo", () => {
    it("reads host and port, Finding 8.10's flat, un-nested shape", () => {
      const info = readCasConnectionInfo({
        version: 2,
        serverName: "cas-shared-default",
        host: "sas-cas-server-default-client",
        port: 5570,
        links: [],
      });
      assert.deepEqual(info, {
        host: "sas-cas-server-default-client",
        port: 5570,
      });
    });

    it("drops a body with no usable host", () => {
      assert.equal(readCasConnectionInfo({ port: 5570 }), undefined);
      assert.equal(readCasConnectionInfo({ host: "", port: 5570 }), undefined);
      assert.equal(readCasConnectionInfo(null), undefined);
    });

    it("drops a body whose port is not a number", () => {
      assert.equal(
        readCasConnectionInfo({ host: "h", port: "5570" }),
        undefined,
      );
    });
  });
});

describe("cas/types 11d additions", () => {
  const table: CasTableItem = {
    kind: "table",
    serverName: "cas-shared-default",
    caslibName: "Public",
    name: "LOOKUP_TABLE",
    links: [],
  };

  describe("readCasColumnItem", () => {
    it("Finding 11.5: reads rawLength and label when present", () => {
      const column = readCasColumnItem(
        {
          name: "AgeAtStart",
          type: "double",
          rawLength: 8,
          label: "Age at Start",
        },
        table,
      );
      assert.ok(column);
      assert.equal(column.rawLength, 8);
      assert.equal(column.label, "Age at Start");
    });

    it("omits both when absent, or when the label is empty", () => {
      const column = readCasColumnItem(
        { name: "Scannable", type: "varchar", label: "" },
        table,
      );
      assert.ok(column);
      assert.equal(column.rawLength, undefined);
      assert.equal(column.label, undefined);
    });
  });

  describe("readCasTableProperties", () => {
    it("reads every field it knows, taking identity from the table it was asked for", () => {
      const properties = readCasTableProperties(
        {
          name: "SOMETHING_ELSE",
          state: "loaded",
          scope: "global",
          rowCount: 177,
          columnCount: 8,
          created: "2026-09-19T11:59:27.317Z",
          createdBy: "someone",
          lastModified: "2026-09-19T11:59:27.336Z",
          lastAccessed: "2026-09-19T11:59:27.780Z",
          encoding: "utf-8",
          characterSet: "UTF8",
          repeated: false,
        },
        table,
      );
      assert.equal(properties.name, "LOOKUP_TABLE");
      assert.equal(properties.caslibName, "Public");
      assert.equal(properties.serverName, "cas-shared-default");
      assert.equal(properties.rowCount, 177);
      assert.equal(properties.columnCount, 8);
      assert.equal(properties.createdBy, "someone");
      assert.equal(properties.repeated, false);
    });

    it("drops absent, empty, and wrong-typed fields rather than defaulting them", () => {
      const properties = readCasTableProperties(
        { state: "", rowCount: "12", repeated: "no" },
        table,
      );
      assert.equal(properties.state, undefined);
      assert.equal(properties.rowCount, undefined);
      assert.equal(properties.repeated, undefined);
    });

    it("reads a non-object body as a table with no optional fields", () => {
      const properties = readCasTableProperties(undefined, table);
      assert.equal(properties.name, "LOOKUP_TABLE");
      assert.equal(properties.created, undefined);
    });
  });
});
