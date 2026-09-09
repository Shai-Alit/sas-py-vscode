// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import type {
  ContentAdapter,
  FileContent,
  FileStat,
} from "../../../src/content/adapter";
import type { ContentResult } from "../../../src/content/client";
import { SasContentFileSystemProvider } from "../../../src/content/contentFileSystem";
import type { ContentProblem } from "../../../src/content/problems";
import { extensionId } from "../../helpers/manifest";

/**
 * The `sasContent:` filesystem provider. Two tiers here:
 *
 * - **Registration**, proven through full extension activation — the scheme is
 *   registered and the `onFileSystem:sasContent` activation event is declared,
 *   so a `sasContent:` URI reaches *our* provider rather than an unknown-scheme
 *   error.
 * - **The shell's own mapping**, proven by constructing
 *   `SasContentFileSystemProvider` directly with a fake `ContentAdapter` — the
 *   same pattern `content/tree.test.ts` uses for the tree provider. This is
 *   what covers `stat`/`readFile`/`writeFile` success, the
 *   `ContentProblem` → `vscode.FileSystemError` mapping, and the
 *   not-supported-yet structural operations, none of which the coverage gate
 *   sees (the file imports `vscode`, so it is out of the unit denominator).
 *
 * The wire behaviour underneath — the ETag round trip, `HEAD`-before-`PUT` —
 * is `test/unit/content-adapter.test.ts`.
 */

const A_CONTENT_URI = vscode.Uri.parse(
  "sasContent:/analysis.py?id=/files/files/dddddddd-0000-4000-8000-000000000001",
);
const HREF = "/files/files/dddddddd-0000-4000-8000-000000000001";

function fakeLog(): { channel: vscode.LogOutputChannel; errors: string[] } {
  const errors: string[] = [];
  const channel = {
    error: (message: string) => errors.push(message),
    info: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    append: () => undefined,
    appendLine: () => undefined,
  } as unknown as vscode.LogOutputChannel;
  return { channel, errors };
}

type AdapterStub = Partial<
  Pick<ContentAdapter, "statFile" | "readFileContent" | "writeFileContent">
>;

function providerWith(adapter: AdapterStub | undefined): {
  provider: SasContentFileSystemProvider;
  errors: string[];
} {
  const { channel, errors } = fakeLog();
  const provider = new SasContentFileSystemProvider(
    () => adapter as ContentAdapter | undefined,
    channel,
  );
  return { provider, errors };
}

function ok<T>(value: T): ContentResult<T> {
  return { ok: true, value };
}
function fail(problem: ContentProblem): ContentResult<never> {
  return { ok: false, reason: "recorded failure", problem };
}

async function rejectionOf(
  run: Promise<unknown>,
): Promise<vscode.FileSystemError> {
  try {
    await run;
  } catch (error) {
    assert.ok(
      error instanceof vscode.FileSystemError,
      `not a FileSystemError: ${String(error)}`,
    );
    return error;
  }
  throw new assert.AssertionError({ message: "expected a rejection" });
}

describe("SAS Content filesystem provider — registration", () => {
  before(async () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension, `${extensionId()} is not loaded`);
    await extension.activate();
  });

  it("declares the onFileSystem:sasContent activation event", () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);
    const manifest = extension.packageJSON as { activationEvents?: string[] };
    assert.ok(
      (manifest.activationEvents ?? []).includes("onFileSystem:sasContent"),
      "onFileSystem:sasContent is not an activation event",
    );
  });

  it("routes a sasContent: URI to our provider (not an unknown-scheme error)", async () => {
    // No profile is active in the test host, so resolve() throws our own
    // sign-in message — which only happens if the provider is registered.
    const error = await rejectionOf(
      Promise.resolve(vscode.workspace.fs.stat(A_CONTENT_URI)),
    );
    assert.match(error.message, /Sign in to SAS Viya/);
  });
});

describe("SasContentFileSystemProvider — shell mapping", () => {
  it("stat maps statFile onto a File FileStat", async () => {
    const stat: FileStat = { size: 42, createdAt: 1000, modifiedAt: 2000 };
    const { provider } = providerWith({
      statFile: () => Promise.resolve(ok(stat)),
    });
    const result = await provider.stat(A_CONTENT_URI);
    assert.equal(result.type, vscode.FileType.File);
    assert.equal(result.size, 42);
    assert.equal(result.ctime, 1000);
    assert.equal(result.mtime, 2000);
  });

  it("stat substitutes 0 for absent timestamps", async () => {
    const stat: FileStat = {
      size: 0,
      createdAt: undefined,
      modifiedAt: undefined,
    };
    const { provider } = providerWith({
      statFile: () => Promise.resolve(ok(stat)),
    });
    const result = await provider.stat(A_CONTENT_URI);
    assert.equal(result.ctime, 0);
    assert.equal(result.mtime, 0);
  });

  it("readFile returns the adapter's bytes verbatim", async () => {
    const bytes = new TextEncoder().encode("print('hi')\n");
    const content: FileContent = {
      bytes,
      etag: '"e1"',
      contentType: "application/x-python",
    };
    const { provider } = providerWith({
      readFileContent: () => Promise.resolve(ok(content)),
    });
    const result = await provider.readFile(A_CONTENT_URI);
    assert.deepEqual(result, bytes);
  });

  it("writeFile resolves when the adapter accepts the write", async () => {
    let seenHref: string | undefined;
    let seenBytes: Uint8Array | undefined;
    const { provider } = providerWith({
      writeFileContent: (href, bytes) => {
        seenHref = href;
        seenBytes = bytes;
        return Promise.resolve(ok(undefined));
      },
    });
    const payload = new TextEncoder().encode("new\n");
    await provider.writeFile(A_CONTENT_URI, payload);
    assert.equal(seenHref, HREF);
    assert.deepEqual(seenBytes, payload);
  });

  it("maps a 404 content-rejected to FileNotFound", async () => {
    const { provider, errors } = providerWith({
      statFile: () =>
        Promise.resolve(
          fail({ code: "content-rejected", error: { status: 404 } }),
        ),
    });
    const error = await rejectionOf(provider.stat(A_CONTENT_URI));
    assert.equal(error.code, "FileNotFound");
    assert.equal(errors.length, 1, "the technical sentence is logged");
  });

  it("maps a 412 conflict to a FileSystemError carrying the reopen wording", async () => {
    const { provider } = providerWith({
      writeFileContent: () =>
        Promise.resolve(
          fail({ code: "content-rejected", error: { status: 412 } }),
        ),
    });
    const error = await rejectionOf(
      provider.writeFile(A_CONTENT_URI, new Uint8Array()),
    );
    assert.match(error.message, /changed on the server/);
    assert.match(error.message, /open it again/);
  });

  it("maps forbidden to NoPermissions and unauthorized/unreachable to Unavailable", async () => {
    const cases: { problem: ContentProblem; code: string }[] = [
      {
        problem: { code: "forbidden", error: { status: 403 } },
        code: "NoPermissions",
      },
      {
        problem: { code: "unauthorized", problem: { code: "session-expired" } },
        code: "Unavailable",
      },
      {
        problem: { code: "content-unreachable", detail: "GET … ETIMEDOUT" },
        code: "Unavailable",
      },
      {
        problem: { code: "link-missing", rel: "content", resource: "file" },
        code: "Unknown",
      },
    ];
    for (const { problem, code } of cases) {
      const { provider } = providerWith({
        readFileContent: () => Promise.resolve(fail(problem)),
      });
      const error = await rejectionOf(provider.readFile(A_CONTENT_URI));
      assert.equal(error.code, code, `${problem.code} → ${error.code}`);
    }
  });

  it("fails every operation with a sign-in hint when there is no adapter", async () => {
    const { provider } = providerWith(undefined);
    for (const run of [
      provider.stat(A_CONTENT_URI),
      provider.readFile(A_CONTENT_URI),
      provider.writeFile(A_CONTENT_URI, new Uint8Array()),
    ]) {
      const error = await rejectionOf(run);
      assert.equal(error.code, "Unavailable");
      assert.match(error.message, /Sign in to SAS Viya/);
    }
  });

  it("rejects a sasContent: URI whose query carries no id", async () => {
    const { provider } = providerWith({
      statFile: () => Promise.reject(new Error("must not be called")),
    });
    const error = await rejectionOf(
      provider.stat(vscode.Uri.parse("sasContent:/x.py?name=x")),
    );
    assert.equal(error.code, "FileNotFound");
  });

  it("refuses structural operations as not supported yet", () => {
    const { provider } = providerWith({});
    const isNoPermissions = (error: unknown): true => {
      assert.ok(error instanceof vscode.FileSystemError);
      assert.equal(error.code, "NoPermissions");
      return true;
    };
    assert.throws(() => provider.readDirectory(), isNoPermissions);
    assert.throws(() => {
      provider.createDirectory();
    }, isNoPermissions);
    assert.throws(() => {
      provider.delete();
    }, isNoPermissions);
    assert.throws(() => {
      provider.rename();
    }, isNoPermissions);
  });

  it("watch returns a disposable and never fires", () => {
    const { provider } = providerWith({});
    const watcher = provider.watch();
    assert.equal(typeof watcher.dispose, "function");
    watcher.dispose();
    provider.dispose();
  });
});
