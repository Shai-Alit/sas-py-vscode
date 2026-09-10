// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import type {
  ContentAdapter,
  FileContent,
  FileStat,
  WritePrecondition,
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
 * The wire behaviour underneath — the ETag round trip — is
 * `test/unit/content-adapter.test.ts`.
 */

const HREF = "/files/files/dddddddd-0000-4000-8000-000000000001";
const ENDPOINT = "https://viya.example.com";
const A_CONTENT_URI = vscode.Uri.parse(
  `sasContent:/analysis.py?id=${HREF}&r=${encodeURIComponent(ENDPOINT)}`,
);

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

function providerWith(
  adapter: AdapterStub | undefined,
  forEndpoint?: (endpoint: string) => AdapterStub | undefined,
): {
  provider: SasContentFileSystemProvider;
  errors: string[];
} {
  const { channel, errors } = fakeLog();
  const resolve = forEndpoint ?? (() => adapter);
  const provider = new SasContentFileSystemProvider(
    (endpoint) => resolve(endpoint) as ContentAdapter | undefined,
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

  it("writeFile sends the ETag readFile opened with — not a fresh one — as If-Match", async () => {
    let sentHref: string | undefined;
    let precond: WritePrecondition | undefined;
    let sentBytes: Uint8Array | undefined;
    const { provider } = providerWith({
      readFileContent: () =>
        Promise.resolve(
          ok<FileContent>({
            bytes: new Uint8Array(),
            etag: '"opened-with"',
            contentType: "application/x-python",
          }),
        ),
      writeFileContent: (href, bytes, p) => {
        sentHref = href;
        precond = p;
        sentBytes = bytes;
        return Promise.resolve(ok({ etag: '"after-save"' }));
      },
    });
    await provider.readFile(A_CONTENT_URI);
    const payload = new TextEncoder().encode("edited\n");
    await provider.writeFile(A_CONTENT_URI, payload);
    assert.equal(sentHref, HREF);
    assert.deepEqual(sentBytes, payload);
    assert.ok(precond !== undefined);
    assert.equal(precond.etag, '"opened-with"');
    assert.equal(precond.contentType, "application/x-python");
  });

  it("a second save in the same session carries the ETag the first PUT returned", async () => {
    const seen: string[] = [];
    const { provider } = providerWith({
      readFileContent: () =>
        Promise.resolve(
          ok<FileContent>({
            bytes: new Uint8Array(),
            etag: '"v1"',
            contentType: undefined,
          }),
        ),
      writeFileContent: (_href, _bytes, p) => {
        seen.push(p.etag);
        return Promise.resolve(ok({ etag: `"${String(seen.length + 1)}"` }));
      },
    });
    await provider.readFile(A_CONTENT_URI);
    await provider.writeFile(A_CONTENT_URI, new Uint8Array());
    await provider.writeFile(A_CONTENT_URI, new Uint8Array());
    assert.deepEqual(seen, ['"v1"', '"2"']);
  });

  it("invalidates the guard when a successful save returns no ETag, so the next save refuses distinctly", async () => {
    let puts = 0;
    const { provider } = providerWith({
      readFileContent: () =>
        Promise.resolve(
          ok<FileContent>({
            bytes: new Uint8Array(),
            etag: '"v1"',
            contentType: "application/x-python",
          }),
        ),
      writeFileContent: () => {
        puts += 1;
        // Finding 6.2: a 200 always carries a fresh tag on the probed
        // deployment — this is the stripping-proxy / other-release case.
        return Promise.resolve(ok({ etag: undefined }));
      },
    });
    await provider.readFile(A_CONTENT_URI);
    await provider.writeFile(A_CONTENT_URI, new Uint8Array());
    const error = await rejectionOf(
      provider.writeFile(A_CONTENT_URI, new Uint8Array()),
    );
    // The consumed tag is gone, not left to draw a spurious 412 the user would
    // read as someone else's edit — they get the truthful "no version tag" refusal.
    assert.match(error.message, /did not return a version tag/);
    assert.doesNotMatch(error.message, /changed on the server/);
    assert.equal(
      puts,
      1,
      "the second save is refused, not sent with a stale tag",
    );
  });

  it("rejects a save with nothing to be conditional against (no prior read)", async () => {
    let called = false;
    const { provider } = providerWith({
      writeFileContent: () => {
        called = true;
        return Promise.resolve(ok({ etag: undefined }));
      },
    });
    const error = await rejectionOf(
      provider.writeFile(A_CONTENT_URI, new Uint8Array()),
    );
    assert.match(error.message, /Open this file from the SAS Content view/);
    assert.equal(called, false, "no PUT is attempted without a precondition");
  });

  it("refuses a save distinctly when readFile succeeded but carried no ETag", async () => {
    let called = false;
    const { provider } = providerWith({
      readFileContent: () =>
        Promise.resolve(
          ok<FileContent>({
            bytes: new Uint8Array(),
            etag: undefined,
            contentType: "application/x-python",
          }),
        ),
      writeFileContent: () => {
        called = true;
        return Promise.resolve(ok({ etag: undefined }));
      },
    });
    await provider.readFile(A_CONTENT_URI);
    const error = await rejectionOf(
      provider.writeFile(A_CONTENT_URI, new Uint8Array()),
    );
    assert.match(error.message, /did not return a version tag/);
    // Not the "you never opened it" wording — the user did open it.
    assert.doesNotMatch(error.message, /Open this file from the SAS Content/);
    assert.equal(called, false, "no blind PUT without a tag");
  });

  it("maps a 404 content-rejected to FileNotFound with the localised message", async () => {
    const { provider, errors } = providerWith({
      statFile: () =>
        Promise.resolve(
          fail({ code: "content-rejected", error: { status: 404 } }),
        ),
    });
    const error = await rejectionOf(provider.stat(A_CONTENT_URI));
    assert.equal(error.code, "FileNotFound");
    assert.match(error.message, /no longer exists/);
    assert.equal(errors.length, 1, "the technical sentence is logged");
  });

  it("maps a 412 conflict to the reopen wording, and a retry gets the same (never a blind overwrite)", async () => {
    const sentTags: string[] = [];
    const { provider } = providerWith({
      readFileContent: () =>
        Promise.resolve(
          ok<FileContent>({
            bytes: new Uint8Array(),
            etag: '"e1"',
            contentType: undefined,
          }),
        ),
      writeFileContent: (_href, _bytes, p) => {
        sentTags.push(p.etag);
        return Promise.resolve(
          fail({ code: "content-rejected", error: { status: 412 } }),
        );
      },
    });
    await provider.readFile(A_CONTENT_URI);
    const conflict = await rejectionOf(
      provider.writeFile(A_CONTENT_URI, new Uint8Array()),
    );
    assert.match(conflict.message, /changed on the server/);
    assert.match(conflict.message, /open it again/);
    // The buffer is still the pre-conflict version, so its tag stays the right
    // thing to send: the retry is another conditional PUT that 412s the same
    // way — the truthful message — not a blind overwrite and not a misleading
    // "you never opened this".
    const retry = await rejectionOf(
      provider.writeFile(A_CONTENT_URI, new Uint8Array()),
    );
    assert.match(retry.message, /changed on the server/);
    assert.deepEqual(sentTags, ['"e1"', '"e1"']);
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

  it("maps a no-session unauthorized to the sign-in prompt, not the raw auth reading", async () => {
    // With an adapter now built for any endpoint a URI names, "signed out"
    // surfaces as an `unauthorized` problem the wire tags `noSession` (the
    // token was never obtained) rather than a missing adapter — it must still
    // read as "sign in", not the "please report this" wording
    // `localiseAuthProblem` uses for a surprise.
    const { provider } = providerWith({
      readFileContent: () =>
        Promise.resolve(
          fail({
            code: "unauthorized",
            problem: { code: "not-authenticated" },
            noSession: true,
          }),
        ),
    });
    const error = await rejectionOf(provider.readFile(A_CONTENT_URI));
    assert.equal(error.code, "Unavailable");
    assert.match(
      error.message,
      /Sign in to SAS Viya to open SAS Content files/,
    );
    assert.doesNotMatch(error.message, /report this/);
  });

  it("keeps the auth layer's wording for a deployment-answered not-authenticated", async () => {
    // A 401 the deployment actually answered with a bare challenge — no
    // `noSession` tag. The auth layer defines this as a dropped Authorization
    // header (our bug), so the message must stay "please report this"; a
    // sign-in prompt here sends the user round a loop that cannot fix it.
    const { provider } = providerWith({
      readFileContent: () =>
        Promise.resolve(
          fail({
            code: "unauthorized",
            problem: { code: "not-authenticated" },
          }),
        ),
    });
    const error = await rejectionOf(provider.readFile(A_CONTENT_URI));
    assert.equal(error.code, "Unavailable");
    assert.match(error.message, /report this/);
    assert.doesNotMatch(error.message, /Sign in to SAS Viya/);
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

  it("rejects a sasContent: URI missing either the id or the deployment root", async () => {
    const { provider } = providerWith({
      statFile: () => Promise.reject(new Error("must not be called")),
    });
    for (const bad of [
      "sasContent:/x.py?name=x",
      `sasContent:/x.py?id=${HREF}`, // no r=
      `sasContent:/x.py?r=${encodeURIComponent(ENDPOINT)}`, // no id=
    ]) {
      const error = await rejectionOf(provider.stat(vscode.Uri.parse(bad)));
      assert.equal(error.code, "FileNotFound", bad);
    }
  });

  it("keeps the ETag guard per deployment — the same file id on two roots does not share a tag", async () => {
    const rootA = "https://a.example.com";
    const rootB = "https://b.example.com";
    const uriA = vscode.Uri.parse(
      `sasContent:/x.py?id=${HREF}&r=${encodeURIComponent(rootA)}`,
    );
    const uriB = vscode.Uri.parse(
      `sasContent:/x.py?id=${HREF}&r=${encodeURIComponent(rootB)}`,
    );
    const sentFrom: Record<string, string> = {};
    const adapterFor = (endpoint: string): AdapterStub => ({
      readFileContent: () =>
        Promise.resolve(
          ok<FileContent>({
            bytes: new Uint8Array(),
            etag: endpoint === rootA ? '"tag-a"' : '"tag-b"',
            contentType: "application/x-python",
          }),
        ),
      writeFileContent: (_href, _bytes, p) => {
        sentFrom[endpoint] = p.etag;
        return Promise.resolve(ok({ etag: undefined }));
      },
    });
    const { provider } = providerWith(undefined, adapterFor);
    // Open the same Files service id on both deployments, B last…
    await provider.readFile(uriA);
    await provider.readFile(uriB);
    // …then save on A: it must still send A's tag, not the one B just recorded.
    await provider.writeFile(uriA, new Uint8Array());
    await provider.writeFile(uriB, new Uint8Array());
    assert.equal(sentFrom[rootA], '"tag-a"');
    assert.equal(sentFrom[rootB], '"tag-b"');
  });

  it("resolves the adapter for the deployment the URI names, not the active one", async () => {
    const seenEndpoints: string[] = [];
    const other = "https://other.example.com";
    const otherUri = vscode.Uri.parse(
      `sasContent:/a.py?id=${HREF}&r=${encodeURIComponent(other)}`,
    );
    const { provider } = providerWith(undefined, (endpoint) => {
      seenEndpoints.push(endpoint);
      return endpoint === other
        ? {
            statFile: () =>
              Promise.resolve(
                ok<FileStat>({
                  size: 1,
                  createdAt: undefined,
                  modifiedAt: undefined,
                }),
              ),
          }
        : undefined;
    });
    const result = await provider.stat(otherUri);
    assert.equal(result.size, 1);
    assert.deepEqual(seenEndpoints, [other]);
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
