// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { type FileContent, type ServerResult } from "../../src/server/adapter";
import {
  ServerEditorFiles,
  type EditorFileAdapter,
} from "../../src/server/editorFiles";

/**
 * The lost-update guard an editor's save goes through. A save must send the
 * `ETag` of the version the editor read, never a fresh one and never an
 * empty one, which would turn the server's check off (Finding 13.26).
 */

const FILE = { profileId: "profile-1", path: "/tmp/x.py" };

/** An adapter whose next read and write answers are set by the test, and
 * which records the tag each write was sent. */
class FakeAdapter implements EditorFileAdapter {
  readonly writes: string[] = [];
  readResult: ServerResult<FileContent> = {
    ok: true,
    value: { bytes: new Uint8Array([1]), etag: '"read"' },
  };
  writeResult: ServerResult<string | undefined> = {
    ok: true,
    value: '"saved"',
  };

  readFile(): Promise<ServerResult<FileContent>> {
    return Promise.resolve(this.readResult);
  }

  writeFile(
    _path: string,
    _bytes: Uint8Array,
    etag: string,
  ): Promise<ServerResult<string | undefined>> {
    this.writes.push(etag);
    return Promise.resolve(this.writeResult);
  }
}

function setUp(): { adapter: FakeAdapter; files: ServerEditorFiles } {
  const adapter = new FakeAdapter();
  return { adapter, files: new ServerEditorFiles(() => adapter) };
}

describe("ServerEditorFiles", () => {
  it("refuses to save a file never read here, without a request", async () => {
    const { adapter, files } = setUp();
    const result = await files.write(FILE, new Uint8Array());
    assert.deepEqual(result.ok ? undefined : result.problem, {
      code: "no-version",
      path: "/tmp/x.py",
    });
    assert.deepEqual(adapter.writes, []);
  });

  it("refuses to save a file whose read carried no ETag", async () => {
    const { adapter, files } = setUp();
    adapter.readResult = {
      ok: true,
      value: { bytes: new Uint8Array(), etag: undefined },
    };
    assert.ok((await files.read(FILE)).ok);
    const result = await files.write(FILE, new Uint8Array());
    assert.equal(result.ok ? undefined : result.problem.code, "no-version");
    assert.deepEqual(adapter.writes, []);
  });

  it("returns the bytes it read", async () => {
    const { files } = setUp();
    assert.deepEqual(await files.read(FILE), {
      ok: true,
      value: new Uint8Array([1]),
    });
  });

  it("sends the read's ETag, then each save's own into the next", async () => {
    const { adapter, files } = setUp();
    await files.read(FILE);
    assert.ok((await files.write(FILE, new Uint8Array())).ok);
    adapter.writeResult = { ok: true, value: '"saved-again"' };
    assert.ok((await files.write(FILE, new Uint8Array())).ok);
    assert.ok((await files.write(FILE, new Uint8Array())).ok);
    assert.deepEqual(adapter.writes, ['"read"', '"saved"', '"saved-again"']);
  });

  it("refuses the save after one that returned no ETag, rather than reuse a tag", async () => {
    const { adapter, files } = setUp();
    await files.read(FILE);
    adapter.writeResult = { ok: true, value: undefined };
    assert.ok((await files.write(FILE, new Uint8Array())).ok);
    const next = await files.write(FILE, new Uint8Array());
    assert.equal(next.ok ? undefined : next.problem.code, "no-version");
    assert.deepEqual(adapter.writes, ['"read"']);
  });

  it("keeps the tag after a failed save, so a retry sends the same one", async () => {
    const { adapter, files } = setUp();
    await files.read(FILE);
    adapter.writeResult = {
      ok: false,
      reason: "changed",
      problem: {
        code: "changed-on-server",
        path: FILE.path,
        error: { status: 412 },
      },
    };
    const first = await files.write(FILE, new Uint8Array());
    assert.equal(
      first.ok ? undefined : first.problem.code,
      "changed-on-server",
    );
    await files.write(FILE, new Uint8Array());
    assert.deepEqual(adapter.writes, ['"read"', '"read"']);
  });

  it("records nothing for a failed read", async () => {
    const { adapter, files } = setUp();
    adapter.readResult = {
      ok: false,
      reason: "gone",
      problem: { code: "not-connected" },
    };
    assert.equal((await files.read(FILE)).ok, false);
    const result = await files.write(FILE, new Uint8Array());
    assert.equal(result.ok ? undefined : result.problem.code, "no-version");
  });

  it("keeps one tag per profile and path", async () => {
    const { adapter, files } = setUp();
    await files.read(FILE);
    const other = await files.write(
      { profileId: "profile-2", path: FILE.path },
      new Uint8Array(),
    );
    assert.equal(other.ok ? undefined : other.problem.code, "no-version");
    const sibling = await files.write(
      { profileId: FILE.profileId, path: "/tmp/y.py" },
      new Uint8Array(),
    );
    assert.equal(sibling.ok ? undefined : sibling.problem.code, "no-version");
    assert.deepEqual(adapter.writes, []);
  });
});
