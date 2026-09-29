// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as vscode from "vscode";

import {
  AgentServerController,
  SET_UP_CLAUDE_CODE_COMMAND,
  setUpClaudeCode,
  type AgentServerDeps,
} from "../../../src/agent/agentServer";
import { extensionId } from "../../helpers/manifest";
import { memoryMemento } from "../../helpers/auth-host";

/**
 * The agent server's VS Code shell (ADR-0042): when it runs, where its port
 * and secret live, and what the setup command copies. Trust and the setting
 * are injected where a case needs the closed side of the gate — the test
 * host's empty window is always trusted and has no folder — and a temporary
 * directory stands in for `storageUri`. The server itself is real, so each
 * running case also proves a request carrying the file's secret is answered.
 */

const PORT_KEY = "pythonOnViya.agentServer.port";

interface RecordedLog {
  readonly debug: string[];
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
  readonly log: AgentServerDeps["log"];
}

function recordingLog(): RecordedLog {
  const debug: string[] = [];
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  return {
    debug,
    info,
    warn,
    error,
    log: {
      debug: (message: string) => {
        debug.push(message);
      },
      info: (message: string) => {
        info.push(message);
      },
      warn: (message: string) => {
        warn.push(message);
      },
      error: (message: string | Error) => {
        error.push(String(message));
      },
    },
  };
}

function secretIn(file: string): string {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(
    typeof parsed === "object" &&
      parsed !== null &&
      "Authorization" in parsed &&
      typeof parsed.Authorization === "string",
  );
  return parsed.Authorization.replace(/^Bearer /, "");
}

function ping(port: number, secret: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/mcp",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        agent: false,
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          resolve(res.statusCode ?? 0);
        });
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
  });
}

function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const blocker = createServer();
    blocker.once("error", reject);
    blocker.listen({ host: "127.0.0.1", port }, () => {
      resolve(blocker);
    });
  });
}

function release(blocker: Server): Promise<void> {
  return new Promise((resolve) => {
    blocker.close(() => {
      resolve();
    });
  });
}

describe("agent server controller", () => {
  let storage: string;
  const controllers: AgentServerController[] = [];

  function controller(
    overrides: Partial<AgentServerDeps> = {},
  ): AgentServerController & { readonly recorded: RecordedLog } {
    const recorded = recordingLog();
    const created = new AgentServerController({
      workspaceState: memoryMemento(),
      storageDirectory: storage,
      version: "9.9.9",
      log: recorded.log,
      isTrusted: () => true,
      isEnabled: () => true,
      ...overrides,
    });
    controllers.push(created);
    return Object.assign(created, { recorded });
  }

  beforeEach(() => {
    storage = mkdtempSync(join(tmpdir(), "pov-agent-int-"));
  });

  afterEach(() => {
    for (const created of controllers.splice(0)) created.dispose();
    rmSync(storage, { recursive: true, force: true });
  });

  it("stays off, and writes nothing, while the setting is off", async () => {
    const subject = controller({ isEnabled: () => false });
    await subject.refresh();
    assert.deepEqual(subject.status(), { kind: "off", reason: "disabled" });
    assert.deepEqual(readdirSync(storage), []);
  });

  it("clears a file a crash left behind while it stays off", async () => {
    writeFileSync(join(storage, "mcp-headers-1234.json"), "{}");
    const subject = controller({ isEnabled: () => false });
    await subject.refresh();
    assert.deepEqual(readdirSync(storage), []);
  });

  it("stays off in a window with no folder", async () => {
    const subject = controller({ storageDirectory: undefined });
    await subject.refresh();
    assert.deepEqual(subject.status(), { kind: "off", reason: "no-folder" });
  });

  it("stays off in an untrusted workspace, and starts once trust is granted", async () => {
    let trusted = false;
    const subject = controller({ isTrusted: () => trusted });
    await subject.refresh();
    assert.deepEqual(subject.status(), { kind: "off", reason: "untrusted" });
    assert.deepEqual(readdirSync(storage), []);

    trusted = true;
    await subject.refresh();
    assert.equal(subject.status().kind, "running");
  });

  it("serves the secret it wrote to the headers file, and keeps the port", async () => {
    const workspaceState = memoryMemento();
    const subject = controller({ workspaceState });
    await subject.refresh();

    const status = subject.status();
    assert.equal(status.kind, "running");
    assert.equal(
      status.headersFile,
      join(storage, `mcp-headers-${String(status.port)}.json`),
    );
    assert.equal(workspaceState.get(PORT_KEY), status.port);
    assert.equal(await ping(status.port, secretIn(status.headersFile)), 200);
    assert.equal(await ping(status.port, "not-the-secret"), 401);
    assert.ok(
      subject.recorded.info.some((line) =>
        line.includes(`127.0.0.1:${String(status.port)}/mcp`),
      ),
    );
    assert.ok(subject.recorded.debug.some((line) => line.includes("401")));
    assert.deepEqual(subject.recorded.warn, []);
    const everything = [
      ...subject.recorded.debug,
      ...subject.recorded.info,
      ...subject.recorded.warn,
      ...subject.recorded.error,
    ].join("\n");
    assert.ok(!everything.includes(secretIn(status.headersFile)));
  });

  it("stops, and removes the file, when the setting is turned off", async () => {
    let enabled = true;
    const subject = controller({ isEnabled: () => enabled });
    await subject.refresh();
    const running = subject.status();
    assert.equal(running.kind, "running");

    enabled = false;
    await subject.refresh();
    assert.deepEqual(subject.status(), { kind: "off", reason: "disabled" });
    assert.equal(existsSync(running.headersFile), false);
    await assert.rejects(ping(running.port, "anything"));
  });

  it("reuses the stored port on the next start, with a new secret", async () => {
    const workspaceState = memoryMemento();
    const first = controller({ workspaceState });
    await first.refresh();
    const before = first.status();
    assert.equal(before.kind, "running");
    const oldSecret = secretIn(before.headersFile);
    first.dispose();

    const onPortChanged: [number, number][] = [];
    const second = controller({
      workspaceState,
      onPortChanged: (previous, port) => onPortChanged.push([previous, port]),
    });
    await second.refresh();
    const after = second.status();
    assert.equal(after.kind, "running");
    assert.equal(after.port, before.port);
    assert.notEqual(secretIn(after.headersFile), oldSecret);
    assert.equal(await ping(after.port, oldSecret), 401);
    assert.deepEqual(onPortChanged, []);
  });

  it("moves to a new port when the stored one is taken, and says so", async () => {
    const workspaceState = memoryMemento();
    const blocker = await occupy(0);
    const address = blocker.address();
    assert.ok(typeof address === "object" && address !== null);
    await workspaceState.update(PORT_KEY, address.port);

    const changes: [number, number][] = [];
    try {
      const subject = controller({
        workspaceState,
        onPortChanged: (previous, port) => changes.push([previous, port]),
      });
      await subject.refresh();
      const status = subject.status();
      assert.equal(status.kind, "running");
      assert.notEqual(status.port, address.port);
      assert.deepEqual(changes, [[address.port, status.port]]);
      assert.equal(workspaceState.get(PORT_KEY), status.port);
      assert.ok(
        subject.recorded.warn.some((line) =>
          line.includes(String(address.port)),
        ),
      );
      assert.deepEqual(readdirSync(storage), [
        `mcp-headers-${String(status.port)}.json`,
      ]);
    } finally {
      await release(blocker);
    }
  });

  it("reports a failed start when the headers file cannot be written, and closes the server", async () => {
    const notADirectory = join(storage, "file");
    writeFileSync(notADirectory, "");
    const subject = controller({ storageDirectory: notADirectory });
    await subject.refresh();
    assert.deepEqual(subject.status(), { kind: "off", reason: "failed" });
    assert.equal(subject.recorded.error.length, 1);
  });

  it("clears a stale file on start and removes its own on dispose", async () => {
    writeFileSync(join(storage, "mcp-headers-1234.json"), "{}");
    const subject = controller();
    await subject.refresh();
    const status = subject.status();
    assert.equal(status.kind, "running");
    assert.deepEqual(readdirSync(storage), [
      `mcp-headers-${String(status.port)}.json`,
    ]);

    subject.dispose();
    assert.deepEqual(readdirSync(storage), []);
    await assert.rejects(ping(status.port, "anything"));
  });

  it("starts nothing when disposed before its queued start runs", async () => {
    const subject = controller();
    const refreshing = subject.refresh();
    subject.dispose();
    await refreshing;
    assert.deepEqual(readdirSync(storage), []);
  });

  it("closes the server, and writes no file, when disposed while it is binding", async () => {
    // `start` reads the stored port and then awaits the bind. A memento whose
    // read disposes the controller puts the dispose exactly in that gap.
    const state = memoryMemento();
    const holder: { subject?: AgentServerController } = {};
    const disposingState: vscode.Memento = {
      keys: () => state.keys(),
      get: <T>(key: string, fallback?: T) => {
        holder.subject?.dispose();
        return state.get<T>(key, fallback as T);
      },
      update: (key, value) => state.update(key, value),
    };
    holder.subject = controller({ workspaceState: disposingState });
    await holder.subject.refresh();
    assert.deepEqual(readdirSync(storage), []);
    assert.equal(state.get(PORT_KEY), undefined);
  });

  it("keeps running when its port cannot be stored, and still stops", async () => {
    let enabled = true;
    const state = memoryMemento();
    const refusingState: vscode.Memento = {
      keys: () => state.keys(),
      get: <T>(key: string, fallback?: T) => state.get<T>(key, fallback as T),
      update: () => Promise.reject(new Error("storage is read-only")),
    };
    const subject = controller({
      workspaceState: refusingState,
      isEnabled: () => enabled,
    });
    await subject.refresh();
    const status = subject.status();
    assert.equal(status.kind, "running");
    assert.equal(await ping(status.port, secretIn(status.headersFile)), 200);
    assert.ok(
      subject.recorded.warn.some((line) =>
        line.includes("storage is read-only"),
      ),
    );

    enabled = false;
    await subject.refresh();
    assert.deepEqual(subject.status(), { kind: "off", reason: "disabled" });
  });

  it("logs a start that throws, and the next refresh still runs", async () => {
    let calls = 0;
    const subject = controller({
      isEnabled: () => {
        calls += 1;
        if (calls === 1) throw new Error("settings unreadable");
        return true;
      },
    });
    await subject.refresh();
    assert.ok(
      subject.recorded.error.some((line) =>
        line.includes("settings unreadable"),
      ),
    );

    await subject.refresh();
    assert.equal(subject.status().kind, "running");
  });

  it("runs overlapping refreshes in order, so one server starts", async () => {
    const subject = controller();
    await Promise.all([
      subject.refresh(),
      subject.refresh(),
      subject.refresh(),
    ]);
    assert.equal(subject.status().kind, "running");
    assert.equal(readdirSync(storage).length, 1);
  });

  describe("Set Up Claude Code Access", () => {
    interface Shown {
      readonly info: string[];
      readonly warn: string[];
      readonly error: string[];
    }

    /** Stubs the three message functions and `createTerminal`, which are
     * process-global, for one body; `answer` picks the button pressed. */
    async function withWindowStubs(
      answer: (message: string, items: readonly unknown[]) => unknown,
      body: (shown: Shown, terminals: string[]) => Promise<void>,
    ): Promise<void> {
      const shown: Shown = { info: [], warn: [], error: [] };
      const terminals: string[] = [];
      const window = vscode.window as {
        showInformationMessage: unknown;
        showWarningMessage: unknown;
        showErrorMessage: unknown;
        createTerminal: unknown;
      };
      const originals = {
        showInformationMessage: window.showInformationMessage,
        showWarningMessage: window.showWarningMessage,
        showErrorMessage: window.showErrorMessage,
        createTerminal: window.createTerminal,
      };
      const buttons = (rest: unknown[]): unknown[] =>
        rest.filter((item) => typeof item === "string");
      window.showInformationMessage = (message: string, ...rest: unknown[]) => {
        shown.info.push(message);
        return Promise.resolve(answer(message, buttons(rest)));
      };
      window.showWarningMessage = (message: string, ...rest: unknown[]) => {
        shown.warn.push(message);
        return Promise.resolve(answer(message, buttons(rest)));
      };
      window.showErrorMessage = (message: string) => {
        shown.error.push(message);
        return Promise.resolve(undefined);
      };
      window.createTerminal = () => ({
        show: () => undefined,
        sendText: (text: string, execute: boolean) => {
          assert.equal(execute, false);
          terminals.push(text);
        },
      });
      try {
        await body(shown, terminals);
      } finally {
        window.showInformationMessage = originals.showInformationMessage;
        window.showWarningMessage = originals.showWarningMessage;
        window.showErrorMessage = originals.showErrorMessage;
        window.createTerminal = originals.createTerminal;
      }
    }

    it("copies the line for the default shell and pastes it, unexecuted, on request", async () => {
      const subject = controller();
      const copied: string[] = [];
      await withWindowStubs(
        (_message, items) => items[0],
        async (shown, terminals) => {
          const result = await setUpClaudeCode(subject, subject.recorded.log, {
            writeClipboard: (text) => {
              copied.push(text);
              return Promise.resolve();
            },
            shellPath: "C:\\Windows\\System32\\cmd.exe",
            platform: "win32",
            folder: vscode.Uri.file(storage),
          });
          assert.equal(result.kind, "copied");
          assert.equal(result.shell, "cmd");
          const status = subject.status();
          assert.equal(status.kind, "running");
          assert.ok(
            result.line.includes(`127.0.0.1:${String(status.port)}/mcp`),
          );
          assert.ok(
            result.line.startsWith(
              "claude mcp remove --scope local python-on-viya 2>nul & ",
            ),
          );
          assert.ok(!result.line.includes(secretIn(status.headersFile)));
          assert.deepEqual(copied, [result.line]);
          assert.equal(shown.info.length, 1);
          await new Promise((resolve) => setTimeout(resolve, 0));
          assert.deepEqual(terminals, [result.line]);
        },
      );
    });

    it("treats an unresolved shell on Windows as PowerShell", async () => {
      const subject = controller();
      await withWindowStubs(
        () => undefined,
        async () => {
          const result = await setUpClaudeCode(subject, subject.recorded.log, {
            writeClipboard: () => Promise.resolve(),
            shellPath: "",
            platform: "win32",
          });
          assert.equal(result.kind, "copied");
          assert.equal(result.shell, "powershell");
          assert.ok(result.line.startsWith("cmd /c '"));
        },
      );
    });

    it("refuses a storage path the helper's shell would change", async () => {
      const percent = join(storage, "100%");
      const subject = controller({ storageDirectory: percent });
      await withWindowStubs(
        () => undefined,
        async (shown) => {
          const result = await setUpClaudeCode(subject, subject.recorded.log, {
            writeClipboard: () => assert.fail("nothing should be copied"),
            shellPath: "cmd.exe",
            platform: "win32",
          });
          assert.deepEqual(result, { kind: "unquotable-path" });
          assert.equal(shown.error.length, 1);
        },
      );
    });

    it("explains a missing folder, and an untrusted one", async () => {
      await withWindowStubs(
        () => undefined,
        async (shown) => {
          const noFolder = controller({ storageDirectory: undefined });
          assert.deepEqual(
            await setUpClaudeCode(noFolder, noFolder.recorded.log),
            {
              kind: "not-running",
              reason: "no-folder",
            },
          );
          const untrusted = controller({ isTrusted: () => false });
          assert.deepEqual(
            await setUpClaudeCode(untrusted, untrusted.recorded.log),
            {
              kind: "not-running",
              reason: "untrusted",
            },
          );
          assert.equal(shown.warn.length, 2);
        },
      );
    });

    it("asks before turning the server on, and does nothing when declined", async () => {
      const subject = controller({ isEnabled: () => false });
      await withWindowStubs(
        () => undefined,
        async (shown) => {
          assert.deepEqual(
            await setUpClaudeCode(subject, subject.recorded.log),
            {
              kind: "declined",
            },
          );
          assert.equal(shown.warn.length, 1);
          assert.deepEqual(readdirSync(storage), []);
        },
      );
    });

    it("turns the setting on for the user when accepted, and starts", async () => {
      const configuration = vscode.workspace.getConfiguration("pythonOnViya");
      const subject = controller({ isEnabled: undefined });
      try {
        await withWindowStubs(
          (message, items) =>
            message.startsWith("Turn on") ? items[0] : undefined,
          async () => {
            const result = await setUpClaudeCode(
              subject,
              subject.recorded.log,
              {
                writeClipboard: () => Promise.resolve(),
                shellPath: "/bin/bash",
                platform: "other",
              },
            );
            assert.equal(result.kind, "copied");
            assert.equal(
              vscode.workspace
                .getConfiguration("pythonOnViya")
                .inspect<boolean>("agentServer.enabled")?.globalValue,
              true,
            );
          },
        );
      } finally {
        await configuration.update(
          "agentServer.enabled",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }
    });

    it("reports a failed start rather than copying a line", async () => {
      const notADirectory = join(storage, "file");
      writeFileSync(notADirectory, "");
      const subject = controller({ storageDirectory: notADirectory });
      await withWindowStubs(
        () => undefined,
        async (shown) => {
          assert.deepEqual(
            await setUpClaudeCode(subject, subject.recorded.log),
            {
              kind: "not-running",
              reason: "failed",
            },
          );
          assert.equal(shown.warn.length, 1);
        },
      );
    });
  });
});

describe("agent server manifest", () => {
  it("is off by default, and an untrusted workspace cannot turn it on", () => {
    assert.equal(
      vscode.workspace
        .getConfiguration("pythonOnViya")
        .inspect<boolean>("agentServer.enabled")?.defaultValue,
      false,
    );
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);
    const manifest: unknown = extension.packageJSON;
    const restricted =
      typeof manifest === "object" &&
      manifest !== null &&
      "capabilities" in manifest &&
      typeof manifest.capabilities === "object" &&
      manifest.capabilities !== null &&
      "untrustedWorkspaces" in manifest.capabilities &&
      typeof manifest.capabilities.untrustedWorkspaces === "object" &&
      manifest.capabilities.untrustedWorkspaces !== null &&
      "restrictedConfigurations" in manifest.capabilities.untrustedWorkspaces
        ? manifest.capabilities.untrustedWorkspaces.restrictedConfigurations
        : undefined;
    assert.ok(Array.isArray(restricted));
    assert.ok(restricted.includes("pythonOnViya.agentServer.enabled"));
  });

  it("registers the setup command", async () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(SET_UP_CLAUDE_CODE_COMMAND));
  });
});
