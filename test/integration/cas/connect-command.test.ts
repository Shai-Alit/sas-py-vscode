// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `createInsertCasConnectionSnippet` (`src/cas/casConnectCommand.ts`, 8b) —
 * constructed directly with stubbed dependencies, the same pattern
 * `test/integration/data/drag-and-drop.test.ts` uses for its own controller,
 * since this file imports `vscode` and the coverage gate does not see it.
 * `writeCasToken`'s own create/rewrite/refuse contract is
 * `test/unit/compute-cas-token.test.ts`'s job; `buildCasConnectSnippet`'s own
 * escaping is `test/unit/cas-connect-snippet.test.ts`'s. This file's job is
 * the `vscode` plumbing around them: which editor gets the snippet, when the
 * command asks instead of assuming, and that every failure reaches `report`
 * rather than throwing.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  createInsertCasConnectionSnippet,
  createRefreshCasToken,
  type CasConnectCommandAdapter,
  type CasConnectCommandCas,
  type CasConnectCommandConnection,
  type CasConnectCommandProfiles,
  type CasConnectCommandSessions,
  type CasConnectCommandWithProgress,
} from "../../../src/cas/casConnectCommand";
import {
  type ComputeClient,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
} from "../../../src/compute/client";
import { type CasResult } from "../../../src/cas/client";
import { type CasServerItem } from "../../../src/cas/types";

const ENDPOINT = "https://viya.example.com";
const PROFILE = { version: 1, id: "p1", endpoint: ENDPOINT };
const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;
const HOME =
  "/opt/sas/viya/config/var/run/compsrv/default/3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34";

function server(name: string): CasServerItem {
  return { kind: "server", name, links: [] };
}

async function pythonDocument(): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({
    language: "python",
    content: "",
  });
  return await vscode.window.showTextDocument(document);
}

async function markdownDocument(): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: "",
  });
  return await vscode.window.showTextDocument(document);
}

/** A `ComputeClient` that answers `writeCasToken`'s three calls (assign,
 * self, upload) in order — the same shape `compute-cas-token.test.ts` uses,
 * kept minimal here since this file is testing the command around it, not
 * the token-delivery contract itself. */
function computeClient(): ComputeClient {
  const requests: ComputeRequest[] = [];
  const replies: ComputeResult<ComputeResponse>[] = [
    {
      ok: true,
      value: {
        status: 201,
        notModified: false,
        contentType: "application/vnd.sas.compute.fileref+json",
        text: "",
        body: {
          id: "castoken",
          links: [
            {
              method: "GET",
              rel: "self",
              href: `${SESSION_PATH}/filerefs/castoken`,
            },
            {
              method: "PUT",
              rel: "upload",
              href: `${SESSION_PATH}/filerefs/castoken/content`,
              type: "application/octet-stream",
            },
          ],
        },
      },
    },
    {
      ok: true,
      value: {
        status: 200,
        notModified: false,
        etag: '"e1"',
        contentType: "application/vnd.sas.compute.fileref+json",
        text: "",
        body: {
          id: "castoken",
          links: [
            {
              method: "PUT",
              rel: "upload",
              href: `${SESSION_PATH}/filerefs/castoken/content`,
              type: "application/octet-stream",
            },
          ],
        },
      },
    },
    {
      ok: true,
      value: {
        status: 201,
        notModified: false,
        contentType: "application/octet-stream",
        text: "",
        body: null,
      },
    },
  ];
  return {
    send: (request) => {
      const index = requests.length;
      requests.push(request);
      const reply = replies[index];
      assert.ok(
        reply !== undefined,
        "writeCasToken sent more requests than scripted",
      );
      return Promise.resolve(reply);
    },
  };
}

/** A `ComputeClient` whose every request answers with the same non-retriable
 * rejection — the same `rejected(404)` shape
 * `compute-cas-token.test.ts`'s own "does not retry a non-retriable failure"
 * case uses, which `createFileref` remaps to `session-gone` via
 * `asSessionGone`. Used to exercise this command's own `!written.ok`
 * branch without re-testing `writeCasToken`'s retry contract, which is
 * `compute-cas-token.test.ts`'s job. */
function failingComputeClient(): ComputeClient {
  return {
    send: () =>
      Promise.resolve({
        ok: false,
        reason: "the compute service answered HTTP 404",
        problem: {
          code: "compute-rejected",
          error: { status: 404, message: "" },
        },
      }),
  };
}

/** A `ComputeClient` for a session whose SAS code already assigned the
 * token's name to a file of its own: `assign` answers `400`/5402, and the
 * held fileref is a `TEMP` one (Finding 12.25), so `writeCasToken` stops
 * after reading it. */
function heldElsewhereComputeClient(): ComputeClient {
  const path = `${SESSION_PATH}/filerefs/castoken`;
  const replies: ComputeResult<ComputeResponse>[] = [
    {
      ok: false,
      reason: "The fileref already exists.",
      problem: {
        code: "compute-rejected",
        error: { status: 400, message: "", errorCode: 5402 },
      },
    },
    {
      ok: true,
      value: {
        status: 200,
        notModified: false,
        contentType: "application/vnd.sas.collection+json",
        text: "",
        body: {
          items: [
            {
              id: "castoken",
              links: [{ method: "GET", rel: "self", href: path }],
            },
          ],
        },
      },
    },
    {
      ok: true,
      value: {
        status: 200,
        notModified: false,
        contentType: "application/vnd.sas.compute.fileref+json",
        text: "",
        body: {
          id: "castoken",
          accessMethod: "TEMP",
          fileName: "#LN00006",
          filePath: "/saswork/#LN00006",
          links: [{ method: "GET", rel: "self", href: path }],
        },
      },
    },
  ];
  let index = 0;
  return {
    send: () => {
      const reply = replies[index];
      index += 1;
      assert.ok(reply !== undefined, "writeCasToken went on past the refusal");
      return Promise.resolve(reply);
    },
  };
}

function connection(): CasConnectCommandConnection {
  return {
    client: computeClient(),
    session: {
      id: SESSION_ID,
      state: "idle",
      homeDirectory: HOME,
      links: [
        {
          method: "POST",
          rel: "assign",
          href: `${SESSION_PATH}/filerefs`,
          type: "application/vnd.sas.compute.fileref.request",
        },
        {
          method: "GET",
          rel: "files",
          href: `${SESSION_PATH}/filerefs`,
          type: "application/vnd.sas.collection",
        },
      ],
    },
  };
}

interface Harness {
  readonly reports: string[];
  readonly inserted: string[];
  /** Profile ids `defaultSessions.forgetProfile` was called with (11c, B2). */
  readonly forgotten: string[];
  build(overrides?: {
    sessions?: CasConnectCommandSessions;
    cas?: CasConnectCommandCas;
    profiles?: CasConnectCommandProfiles;
    showQuickPick?: <T extends vscode.QuickPickItem>(
      items: readonly T[],
      options: vscode.QuickPickOptions,
    ) => Thenable<T | undefined>;
    getSession?: () => Thenable<vscode.AuthenticationSession | undefined>;
    withProgress?: CasConnectCommandWithProgress;
    tokenFilerefSetting?: () => unknown;
  }): () => Promise<void>;
}

function harness(): Harness {
  const reports: string[] = [];
  const inserted: string[] = [];
  const forgotten: string[] = [];

  const defaultSessions: CasConnectCommandSessions = {
    current: () => connection(),
    forgetProfile: (profileId) => forgotten.push(profileId),
  };
  const defaultCas: CasConnectCommandCas = {
    adapterFor: (): CasConnectCommandAdapter => ({
      getServers: async (): Promise<CasResult<readonly CasServerItem[]>> =>
        Promise.resolve({ ok: true, value: [server("cas-shared-default")] }),
      getConnection: async () =>
        Promise.resolve({
          ok: true,
          value: { host: "sas-cas-server-default-client", port: 5570 },
        }),
    }),
  };
  const defaultProfiles: CasConnectCommandProfiles = {
    active: () => ({ name: "default", profile: PROFILE }),
  };

  return {
    reports,
    inserted,
    forgotten,
    build: (overrides = {}) =>
      createInsertCasConnectionSnippet(
        overrides.sessions ?? defaultSessions,
        overrides.cas ?? defaultCas,
        overrides.profiles ?? defaultProfiles,
        {
          report: (message) => reports.push(message),
          listAccounts: () => Promise.resolve([]),
          getSession:
            overrides.getSession ??
            (() =>
              Promise.resolve({
                id: "s1",
                // credential-scan: allow a fake auth session for a fake provider, never sent anywhere real
                accessToken: "borrowed-token",
                account: { id: "a1", label: "a" },
                scopes: [],
              })),
          ...(overrides.showQuickPick === undefined
            ? {}
            : { showQuickPick: overrides.showQuickPick }),
          ...(overrides.withProgress === undefined
            ? {}
            : { withProgress: overrides.withProgress }),
          tokenFilerefSetting: overrides.tokenFilerefSetting ?? (() => ""),
        },
      ),
  };
}

describe("pythonOnViya.insertCasConnectionSnippet (8b)", () => {
  it("inserts the connect snippet at the cursor on the happy path", async () => {
    const editor = await pythonDocument();
    const h = harness();

    await h.build()();

    assert.deepEqual(h.reports, []);
    assert.match(
      editor.document.getText(),
      /swat\.CAS\("sas-cas-server-default-client", 5570, password=_cas_token\)/,
    );
    // An empty setting means the default name (12n).
    assert.match(editor.document.getText(), /open\("CASTOKEN"\)/);
  });

  it("opens the name the setting gives, upper-cased (12n)", async () => {
    const editor = await pythonDocument();
    const h = harness();

    await h.build({ tokenFilerefSetting: () => "teamtok" })();

    assert.deepEqual(h.reports, []);
    assert.match(editor.document.getText(), /open\("TEAMTOK"\)/);
  });

  it("reports a setting that is not a usable name, before any request", async () => {
    const editor = await pythonDocument();
    const h = harness();
    let adapterAsked = false;

    await h.build({
      tokenFilerefSetting: () => "PYVSTART",
      cas: {
        adapterFor: () => {
          adapterAsked = true;
          return undefined;
        },
      },
    })();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /pythonOnViya\.cas\.tokenFileref/);
    assert.match(h.reports[0] ?? "", /PYVSTART/);
    assert.equal(adapterAsked, false);
    assert.equal(editor.document.getText(), "");
  });

  it("reports a setting that is not a string, rather than throwing", async () => {
    // settings.json can hold any JSON value; the schema's `pattern` only
    // marks it in the settings editor.
    const editor = await pythonDocument();
    const h = harness();

    await h.build({ tokenFilerefSetting: () => 12345678 })();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /pythonOnViya\.cas\.tokenFileref/);
    assert.match(h.reports[0] ?? "", /is "12345678"/);
    assert.equal(editor.document.getText(), "");
  });

  it("reports a name the session's own SAS code holds, and inserts nothing (Finding 12.25)", async () => {
    const editor = await pythonDocument();
    const h = harness();

    await h.build({
      sessions: {
        current: () => ({
          client: heldElsewhereComputeClient(),
          session: connection().session,
        }),
        forgetProfile: (profileId) => h.forgotten.push(profileId),
      },
    })();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /already has a fileref named CASTOKEN/);
    assert.match(h.reports[0] ?? "", /filename CASTOKEN clear;/);
    assert.equal(editor.document.getText(), "");
    assert.deepEqual(h.forgotten, []);
  });

  it("inserts a host containing snippet-syntax characters literally", async () => {
    // Regression test for the escaping gap an adversarial review caught: a
    // host with `$`/`}` must land as literal text, not be reinterpreted as a
    // VS Code snippet tabstop/variable. `host` is untrusted wire data
    // (Finding 8.10) — see `connectSnippet.ts`'s doc comment.
    const editor = await pythonDocument();
    const h = harness();

    await h.build({
      cas: {
        adapterFor: (): CasConnectCommandAdapter => ({
          getServers: async (): Promise<CasResult<readonly CasServerItem[]>> =>
            Promise.resolve({
              ok: true,
              value: [server("cas-shared-default")],
            }),
          getConnection: async () =>
            Promise.resolve({
              ok: true,
              value: { host: "weird$1}host", port: 5570 },
            }),
        }),
      },
    })();

    assert.deepEqual(h.reports, []);
    assert.match(
      editor.document.getText(),
      /swat\.CAS\("weird\$1}host", 5570, password=_cas_token\)/,
    );
  });

  it("reports and does nothing when no profile is connected", async () => {
    await pythonDocument();
    const h = harness();

    await h.build({ profiles: { active: () => undefined } })();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /Connect to SAS Viya/);
  });

  it("reports when the active profile has no live Compute session", async () => {
    await pythonDocument();
    const h = harness();

    await h.build({
      sessions: { current: () => undefined, forgetProfile: () => undefined },
    })();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /Connect to SAS Viya/);
  });

  it("reports when there is no active text editor", async () => {
    // Closing every editor is not reliable across a shared test host, so this
    // instead points `activeTextEditor` at `undefined` directly — the same
    // seam the command itself reads through.
    const h = harness();
    const insertCasConnectionSnippet = createInsertCasConnectionSnippet(
      { current: () => connection(), forgetProfile: () => undefined },
      {
        adapterFor: (): CasConnectCommandAdapter => ({
          getServers: async () =>
            Promise.resolve({
              ok: true,
              value: [server("cas-shared-default")],
            }),
          getConnection: async () =>
            Promise.resolve({
              ok: true,
              value: { host: "h", port: 1 },
            }),
        }),
      },
      { active: () => ({ name: "default", profile: PROFILE }) },
      {
        activeTextEditor: () => undefined,
        report: (message) => h.reports.push(message),
      },
    );

    await insertCasConnectionSnippet();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /Open a Python file/);
  });

  it("reports and inserts nothing when the active editor is not a Python file", async () => {
    // Manual-test item 8.18 (`docs/dev/manual-tests/phase-8.md`) found the
    // command inserted into any open file — `.md` included — since the
    // original check only asked whether an editor was open at all, not what
    // kind of document it held.
    const editor = await markdownDocument();
    const h = harness();

    await h.build()();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /Open a Python file/);
    assert.equal(editor.document.getText(), "");
  });

  it("reports when no CasAdapter is available for the profile's endpoint", async () => {
    const editor = await pythonDocument();
    const h = harness();

    await h.build({ cas: { adapterFor: () => undefined } })();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /Could not reach CAS/);
    assert.equal(editor.document.getText(), "");
  });

  it("reports a CAS problem from getConnection without touching the editor", async () => {
    const editor = await pythonDocument();
    const h = harness();

    await h.build({
      cas: {
        adapterFor: (): CasConnectCommandAdapter => ({
          getServers: async () =>
            Promise.resolve({
              ok: true,
              value: [server("cas-shared-default")],
            }),
          getConnection: async () =>
            Promise.resolve({
              ok: false,
              reason: "unreachable",
              problem: { code: "cas-unreachable", detail: "ETIMEDOUT" },
            }),
        }),
      },
    })();

    assert.equal(h.reports.length, 1);
    assert.equal(editor.document.getText(), "");
  });

  it("reports a Compute problem from writeCasToken without touching the editor, and re-syncs pythonOnViya.connected (11c, B2)", async () => {
    const editor = await pythonDocument();
    const h = harness();

    await h.build({
      sessions: {
        current: () => ({
          client: failingComputeClient(),
          session: connection().session,
        }),
        forgetProfile: (profileId) => h.forgotten.push(profileId),
      },
    })();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /session is no longer available/);
    assert.equal(editor.document.getText(), "");
    // The 404 `failingComputeClient` answers with translates to
    // `session-gone` (`writeCasToken`'s own translate contract,
    // `compute-cas-token.test.ts`) — this command must tell `src/compute`
    // its own cached connection is stale, the same way a run discovering
    // `backend-gone` already does, so **Connect** reappears in the palette
    // instead of staying hidden until the user finds **Disconnect** first.
    assert.deepEqual(h.forgotten, [PROFILE.id]);
  });

  it("reports a CAS problem from getServers without touching the editor", async () => {
    const editor = await pythonDocument();
    const h = harness();

    await h.build({
      cas: {
        adapterFor: (): CasConnectCommandAdapter => ({
          getServers: async () =>
            Promise.resolve({
              ok: false,
              reason: "unreachable",
              problem: { code: "cas-unreachable", detail: "ETIMEDOUT" },
            }),
          getConnection: async () =>
            Promise.resolve({ ok: true, value: { host: "h", port: 1 } }),
        }),
      },
    })();

    assert.equal(h.reports.length, 1);
    assert.equal(editor.document.getText(), "");
  });

  it("reports when the deployment has no CAS server", async () => {
    const h = harness();
    await pythonDocument();

    await h.build({
      cas: {
        adapterFor: (): CasConnectCommandAdapter => ({
          getServers: async () => Promise.resolve({ ok: true, value: [] }),
          getConnection: async () =>
            Promise.resolve({ ok: true, value: { host: "h", port: 1 } }),
        }),
      },
    })();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /no CAS server/);
  });

  it("prompts with a QuickPick when more than one server exists, and uses the pick", async () => {
    const editor = await pythonDocument();
    const h = harness();
    const servers = [server("cas-shared-default"), server("cas-second")];

    await h.build({
      cas: {
        adapterFor: (): CasConnectCommandAdapter => ({
          getServers: async () => Promise.resolve({ ok: true, value: servers }),
          getConnection: async (picked) =>
            Promise.resolve({
              ok: true,
              value: { host: `${picked.name}.internal`, port: 5570 },
            }),
        }),
      },
      showQuickPick: async (items) => {
        const match = items.find((item) => item.label === "cas-second");
        return Promise.resolve(match);
      },
    })();

    assert.deepEqual(h.reports, []);
    assert.match(editor.document.getText(), /cas-second\.internal/);
  });

  it("does nothing when the QuickPick is cancelled", async () => {
    const editor = await pythonDocument();
    const h = harness();
    const servers = [server("cas-shared-default"), server("cas-second")];

    await h.build({
      cas: {
        adapterFor: (): CasConnectCommandAdapter => ({
          getServers: async () => Promise.resolve({ ok: true, value: servers }),
          getConnection: async () =>
            Promise.resolve({ ok: true, value: { host: "h", port: 1 } }),
        }),
      },
      showQuickPick: () => Promise.resolve(undefined),
    })();

    assert.deepEqual(h.reports, []);
    assert.equal(editor.document.getText(), "");
  });

  it("reports when the silent auth session has ended", async () => {
    await pythonDocument();
    const h = harness();

    await h.build({ getSession: () => Promise.resolve(undefined) })();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /sign-in/);
  });

  it("reports nothing when the user cancels the connect from the progress notification", async () => {
    // Mirrors `session-manager.test.ts`'s own "says nothing when the user
    // cancels" case: a token already cancelled before `getServers` resolves
    // means the resulting `CasResult` failure is the user's own Cancel
    // click, not a real problem, and must not surface as an error.
    const source = new vscode.CancellationTokenSource();
    const editor = await pythonDocument();
    const h = harness();

    await h.build({
      cas: {
        adapterFor: (): CasConnectCommandAdapter => ({
          getServers: () =>
            Promise.resolve({
              ok: false,
              reason: "aborted",
              problem: { code: "cas-unreachable", detail: "aborted" },
            }),
          getConnection: () => {
            throw new Error("must not be called once getServers is cancelled");
          },
        }),
      },
      withProgress: (_title, run) => {
        source.cancel();
        return run(source.token);
      },
    })();

    assert.deepEqual(h.reports, []);
    assert.equal(editor.document.getText(), "");
  });

  it("threads an AbortSignal into getServers, getConnection, and writeCasToken", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const editor = await pythonDocument();
    const h = harness();

    await h.build({
      cas: {
        adapterFor: (): CasConnectCommandAdapter => ({
          getServers: (signal) => {
            signals.push(signal);
            return Promise.resolve({
              ok: true,
              value: [server("cas-shared-default")],
            });
          },
          getConnection: (_picked, signal) => {
            signals.push(signal);
            return Promise.resolve({
              ok: true,
              value: { host: "sas-cas-server-default-client", port: 5570 },
            });
          },
        }),
      },
      sessions: {
        current: () => {
          const client = computeClient();
          return {
            client: {
              send: (request: ComputeRequest) => {
                signals.push(request.signal);
                return client.send(request);
              },
            },
            session: connection().session,
          };
        },
        forgetProfile: () => undefined,
      },
    })();

    assert.equal(editor.document.getText().length > 0, true);
    assert.equal(signals.length, 5); // getServers, getConnection, + writeCasToken's 3 Compute calls
    for (const signal of signals) {
      assert.ok(signal instanceof AbortSignal, "expected an AbortSignal");
    }
  });
});

describe("pythonOnViya.refreshCasToken (12n)", () => {
  interface RefreshHarness {
    readonly reports: string[];
    readonly informs: string[];
    readonly forgotten: string[];
    readonly requests: ComputeRequest[];
    run(overrides?: {
      client?: ComputeClient;
      profiles?: CasConnectCommandProfiles;
      connected?: boolean;
      getSession?: () => Thenable<vscode.AuthenticationSession | undefined>;
      withProgress?: CasConnectCommandWithProgress;
      tokenFilerefSetting?: () => unknown;
    }): Promise<void>;
  }

  function refreshHarness(): RefreshHarness {
    const reports: string[] = [];
    const informs: string[] = [];
    const forgotten: string[] = [];
    const requests: ComputeRequest[] = [];
    return {
      reports,
      informs,
      forgotten,
      requests,
      run: async (overrides = {}) => {
        const inner = overrides.client ?? computeClient();
        const client: ComputeClient = {
          send: (request) => {
            requests.push(request);
            return inner.send(request);
          },
        };
        const refresh = createRefreshCasToken(
          {
            current: () =>
              overrides.connected === false
                ? undefined
                : { client, session: connection().session },
            forgetProfile: (profileId) => forgotten.push(profileId),
          },
          overrides.profiles ?? {
            active: () => ({ name: "default", profile: PROFILE }),
          },
          {
            report: (message) => reports.push(message),
            inform: (message) => informs.push(message),
            listAccounts: () => Promise.resolve([]),
            getSession:
              overrides.getSession ??
              (() =>
                Promise.resolve({
                  id: "s1",
                  // credential-scan: allow a fake auth session for a fake provider, never sent anywhere real
                  accessToken: "borrowed-token",
                  account: { id: "a1", label: "a" },
                  scopes: [],
                })),
            tokenFilerefSetting: overrides.tokenFilerefSetting ?? (() => ""),
            ...(overrides.withProgress === undefined
              ? {}
              : { withProgress: overrides.withProgress }),
          },
        );
        await refresh();
      },
    };
  }

  it("writes the token into the named file and says so, inserting nothing", async () => {
    const editor = await pythonDocument();
    const h = refreshHarness();

    await h.run();

    assert.deepEqual(h.reports, []);
    assert.equal(h.informs.length, 1);
    assert.match(h.informs[0] ?? "", /CASTOKEN/);
    assert.equal(h.requests.length, 3);
    assert.deepEqual(
      h.requests[2]?.rawBody,
      new TextEncoder().encode("borrowed-token"),
    );
    assert.equal(editor.document.getText(), "");
  });

  it("needs no editor and no CAS lookup", async () => {
    // `createRefreshCasToken` takes no `cas` handle at all; this pins that it
    // also works with no Python file open.
    await markdownDocument();
    const h = refreshHarness();

    await h.run({ tokenFilerefSetting: () => "teamtok" });

    assert.deepEqual(h.reports, []);
    assert.match(h.informs[0] ?? "", /TEAMTOK/);
  });

  it("reports and writes nothing when no profile is connected", async () => {
    const h = refreshHarness();

    await h.run({ connected: false });

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /Connect to SAS Viya/);
    assert.equal(h.requests.length, 0);
  });

  it("reports a setting that is not a usable name, before any request", async () => {
    const h = refreshHarness();

    await h.run({ tokenFilerefSetting: () => "9lives" });

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /pythonOnViya\.cas\.tokenFileref/);
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.informs, []);
  });

  it("reports a setting that is not a string, before any request", async () => {
    const h = refreshHarness();

    await h.run({ tokenFilerefSetting: () => null });

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /is "null"/);
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.informs, []);
  });

  it("reports a name the session's own SAS code holds (Finding 12.25)", async () => {
    const h = refreshHarness();

    await h.run({ client: heldElsewhereComputeClient() });

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /already has a fileref named CASTOKEN/);
    assert.deepEqual(h.informs, []);
    assert.ok(h.requests.every((request) => request.rawBody === undefined));
  });

  it("reports a gone session and re-syncs pythonOnViya.connected (11c, B2)", async () => {
    const h = refreshHarness();

    await h.run({ client: failingComputeClient() });

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /session is no longer available/);
    assert.deepEqual(h.forgotten, [PROFILE.id]);
    assert.deepEqual(h.informs, []);
  });

  it("reports when the silent auth session has ended", async () => {
    const h = refreshHarness();

    await h.run({ getSession: () => Promise.resolve(undefined) });

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /sign-in/);
    assert.equal(h.requests.length, 0);
  });

  it("reports nothing when the user cancels", async () => {
    const source = new vscode.CancellationTokenSource();
    const h = refreshHarness();

    await h.run({
      client: failingComputeClient(),
      withProgress: (_title, run) => {
        source.cancel();
        return run(source.token);
      },
    });

    assert.deepEqual(h.reports, []);
    assert.deepEqual(h.informs, []);
  });

  it("threads an AbortSignal into every Compute call", async () => {
    const h = refreshHarness();

    await h.run();

    assert.equal(h.requests.length, 3);
    for (const request of h.requests) {
      assert.ok(request.signal instanceof AbortSignal);
    }
  });
});
