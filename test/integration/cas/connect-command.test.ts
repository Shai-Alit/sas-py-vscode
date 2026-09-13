// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `createInsertCasConnectionSnippet` (`src/cas/casConnectCommand.ts`, 8b) —
 * constructed directly with stubbed dependencies, the same pattern
 * `test/integration/data/drag-and-drop.test.ts` uses for its own controller,
 * since this file imports `vscode` and the coverage gate does not see it.
 * `writeCasToken`'s own retry/escaping contract is
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
  type CasConnectCommandAdapter,
  type CasConnectCommandCas,
  type CasConnectCommandConnection,
  type CasConnectCommandProfiles,
  type CasConnectCommandSessions,
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
          id: "CT000001",
          links: [
            {
              method: "GET",
              rel: "self",
              href: `${SESSION_PATH}/filerefs/CT000001`,
            },
            {
              method: "PUT",
              rel: "upload",
              href: `${SESSION_PATH}/filerefs/CT000001/content`,
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
          id: "CT000001",
          links: [
            {
              method: "PUT",
              rel: "upload",
              href: `${SESSION_PATH}/filerefs/CT000001/content`,
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

function connection(): CasConnectCommandConnection {
  return {
    client: computeClient(),
    session: {
      id: SESSION_ID,
      state: "idle",
      links: [
        {
          method: "POST",
          rel: "assign",
          href: `${SESSION_PATH}/filerefs`,
          type: "application/vnd.sas.compute.fileref.request",
        },
      ],
    },
  };
}

interface Harness {
  readonly reports: string[];
  readonly inserted: string[];
  build(overrides?: {
    sessions?: CasConnectCommandSessions;
    cas?: CasConnectCommandCas;
    profiles?: CasConnectCommandProfiles;
    showQuickPick?: <T extends vscode.QuickPickItem>(
      items: readonly T[],
      options: vscode.QuickPickOptions,
    ) => Thenable<T | undefined>;
    getSession?: () => Thenable<vscode.AuthenticationSession | undefined>;
  }): () => Promise<void>;
}

function harness(): Harness {
  const reports: string[] = [];
  const inserted: string[] = [];

  const defaultSessions: CasConnectCommandSessions = {
    current: () => connection(),
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
    // The fileref name is random per call (`src/compute/casToken.ts`), not
    // the fixed "CT000001" `computeClient()`'s own scripted replies use —
    // the command reads it back off `writeCasToken`'s real result rather
    // than assuming a name, so only the shape is asserted here.
    assert.match(editor.document.getText(), /open\("CT\d{6}"\)/);
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

    await h.build({ sessions: { current: () => undefined } })();

    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0] ?? "", /Connect to SAS Viya/);
  });

  it("reports when there is no active text editor", async () => {
    // Closing every editor is not reliable across a shared test host, so this
    // instead points `activeTextEditor` at `undefined` directly — the same
    // seam the command itself reads through.
    const h = harness();
    const insertCasConnectionSnippet = createInsertCasConnectionSnippet(
      { current: () => connection() },
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
});
