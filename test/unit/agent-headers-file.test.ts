// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  headersFileName,
  removeHeadersFiles,
  writeHeadersFile,
} from "../../src/agent/headersFile";

/**
 * The per-start secret's file (ADR-0042). Real files in a temporary
 * directory: what is under test is what lands on disk and what is removed.
 */
describe("agent headers file", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pov-agent-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("names the file after the port", () => {
    assert.equal(headersFileName(45_123), "mcp-headers-45123.json");
  });

  it("writes the Authorization header as JSON, creating the directory", () => {
    const directory = join(root, "not", "yet");
    const file = writeHeadersFile(directory, 45_123, "abc_-123");
    assert.equal(file, join(directory, "mcp-headers-45123.json"));
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
      Authorization: "Bearer abc_-123",
    });
  });

  it("creates the file readable by its owner only on POSIX", function () {
    // Windows has no mode bits to check; the file inherits the storage
    // directory's ACL ("13l built").
    if (process.platform === "win32") this.skip();
    const file = writeHeadersFile(root, 1, "x");
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  it("replaces files left by an earlier start, for any port, and nothing else", () => {
    writeFileSync(join(root, "mcp-headers-1111.json"), "stale");
    writeFileSync(join(root, "mcp-headers-2222.json"), "stale");
    writeFileSync(join(root, "mcp-headers-x.json"), "kept");
    writeFileSync(join(root, "other.json"), "kept");

    writeHeadersFile(root, 3333, "new");

    assert.deepEqual(readdirSync(root).sort(), [
      "mcp-headers-3333.json",
      "mcp-headers-x.json",
      "other.json",
    ]);
  });

  it("rewrites the same port with the new secret", () => {
    writeHeadersFile(root, 1, "old");
    const file = writeHeadersFile(root, 1, "new");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
      Authorization: "Bearer new",
    });
  });

  it("removes every headers file and leaves the rest", () => {
    writeHeadersFile(root, 1, "x");
    writeFileSync(join(root, "state.vscdb"), "kept");
    removeHeadersFiles(root);
    assert.deepEqual(readdirSync(root), ["state.vscdb"]);
  });

  it("treats a missing directory as having none", () => {
    assert.doesNotThrow(() => {
      removeHeadersFiles(join(root, "missing"));
    });
  });

  it("rethrows any other failure to read the directory", () => {
    const file = join(root, "a-file");
    writeFileSync(file, "");
    assert.throws(
      () => {
        removeHeadersFiles(file);
      },
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "ENOTDIR",
    );
    assert.ok(existsSync(file));
  });
});
