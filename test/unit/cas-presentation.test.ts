// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  CONTEXT_CASLIB,
  CONTEXT_COLUMN,
  CONTEXT_SERVER,
  CONTEXT_TABLE,
  nodePresentationOf,
} from "../../src/cas/presentation";
import {
  type CaslibItem,
  type CasColumnItem,
  type CasServerItem,
  type CasTableItem,
} from "../../src/cas/types";

describe("cas/presentation nodePresentationOf", () => {
  it("presents a server as an expandable server icon", () => {
    const server: CasServerItem = {
      kind: "server",
      name: "cas-shared-default",
      links: [],
    };
    assert.deepEqual(nodePresentationOf(server), {
      label: "cas-shared-default",
      expandable: true,
      icon: "server",
      contextValue: CONTEXT_SERVER,
    });
  });

  it("presents a caslib as an expandable database icon", () => {
    const caslib: CaslibItem = {
      kind: "caslib",
      serverName: "cas-shared-default",
      name: "Public",
      links: [],
    };
    assert.deepEqual(nodePresentationOf(caslib), {
      label: "Public",
      expandable: true,
      icon: "database",
      contextValue: CONTEXT_CASLIB,
    });
  });

  it("presents a loaded table as an expandable table icon", () => {
    const table: CasTableItem = {
      kind: "table",
      serverName: "cas-shared-default",
      caslibName: "Public",
      name: "LOOKUP_TABLE",
      state: "loaded",
      links: [],
    };
    assert.deepEqual(nodePresentationOf(table), {
      label: "LOOKUP_TABLE",
      expandable: true,
      icon: "table",
      contextValue: CONTEXT_TABLE,
    });
  });

  it("presents an unloaded table with a different icon, flagged 2026-09-13", () => {
    // Most operations against an unloaded table fail (Finding 8.3), so the
    // user needs a cue before expanding/running against one — the same
    // "table" icon for both states gave no such cue.
    const table: CasTableItem = {
      kind: "table",
      serverName: "cas-shared-default",
      caslibName: "Public",
      name: "LOOKUP_TABLE",
      state: "unloaded",
      links: [],
    };
    assert.deepEqual(nodePresentationOf(table), {
      label: "LOOKUP_TABLE",
      expandable: true,
      icon: "cloud",
      contextValue: CONTEXT_TABLE,
    });
  });

  it("treats a table with no observed state the same as unloaded", () => {
    const table: CasTableItem = {
      kind: "table",
      serverName: "cas-shared-default",
      caslibName: "Public",
      name: "LOOKUP_TABLE",
      links: [],
    };
    assert.equal(nodePresentationOf(table).icon, "cloud");
  });

  it("presents a column as a non-expandable leaf with its type as the description", () => {
    const column: CasColumnItem = {
      kind: "column",
      serverName: "cas-shared-default",
      caslibName: "Public",
      tableName: "LOOKUP_TABLE",
      name: "CODE",
      type: "varchar",
    };
    assert.deepEqual(nodePresentationOf(column), {
      label: "CODE",
      description: "varchar",
      expandable: false,
      icon: "symbol-field",
      contextValue: CONTEXT_COLUMN,
    });
  });
});
