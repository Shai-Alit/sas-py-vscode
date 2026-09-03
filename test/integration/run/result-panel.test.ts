// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import type { ProgramOrigin, RichOutput } from "../../../src/backend/backend";
import {
  ResultPanel,
  type ResultWebviewPanel,
} from "../../../src/run/resultPanel";
import {
  isResultPanelMessage,
  type RenderItem,
  type ResultPanelMessage,
} from "../../../src/run/resultPanelModel";

function isOutputMessage(
  message: ResultPanelMessage,
): message is Extract<ResultPanelMessage, { type: "output" }> {
  return message.type === "output";
}

function isImageItem(
  item: RenderItem,
): item is Extract<RenderItem, { kind: "image" }> {
  return item.kind === "image";
}

function isOutcomeMessage(
  message: ResultPanelMessage,
): message is Extract<ResultPanelMessage, { type: "outcome" }> {
  return message.type === "outcome";
}

/** The `runToken` on the most recent traceback output the panel posted — what
 * the real webview would echo back in a `revealFrame` message, since its
 * activation closure is built from that item (Phase 5d-iv). `undefined` if no
 * traceback has been posted yet. */
function lastTracebackToken(posted: readonly unknown[]): number | undefined {
  for (const message of [...posted].reverse()) {
    if (!isResultPanelMessage(message) || !isOutputMessage(message)) continue;
    if (message.item.kind === "traceback") return message.item.runToken;
  }
  return undefined;
}

/** A `ResultWebviewPanel` double that records everything asked of it and lets
 * a test drive the `"ready"` handshake and disposal by hand — the same shape
 * `output-channel.test.ts`'s `fakeChannel()` takes for `vscode.OutputChannel`. */
function fakePanel(): {
  readonly panel: ResultWebviewPanel;
  readonly posted: unknown[];
  readonly revealed: { column: vscode.ViewColumn; preserveFocus: boolean }[];
  readonly disposed: boolean[];
  /** Simulates the webview's own bootstrap script sending its handshake. */
  sendReady(): void;
  /** Simulates the webview posting a clicked-frame message back to the host
   * (Phase 4d). `runToken` defaults to the last traceback output's own token
   * — what the real webview echoes (Phase 5d-iv) — so a caller that just
   * wants "click frame N of the current run" need not pass one; a stale-run
   * test passes an explicit older token. */
  sendRevealFrame(frameIndex: number, runToken?: number): void;
} {
  const posted: unknown[] = [];
  const revealed: { column: vscode.ViewColumn; preserveFocus: boolean }[] = [];
  const disposed: boolean[] = [];
  let messageListener: ((message: unknown) => void) | undefined;
  const disposeListeners: (() => void)[] = [];

  const panel: ResultWebviewPanel = {
    // A plain mutable field, not an accessor — `ResultPanel` writes
    // `panel.webview.html = …` directly, which mutates this same object, so
    // a test reading `fake.panel.webview.html` back sees it with no
    // get/set indirection needed.
    webview: {
      html: "",
      cspSource: "vscode-webview://fake",
      asWebviewUri: (uri) => uri,
      postMessage: (message) => {
        posted.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener) => {
        messageListener = listener;
        return { dispose: () => undefined };
      },
    },
    reveal: (column, preserveFocus) => {
      revealed.push({
        column: column ?? vscode.ViewColumn.Active,
        preserveFocus: preserveFocus ?? false,
      });
    },
    onDidDispose: (listener) => {
      disposeListeners.push(listener);
      return { dispose: () => undefined };
    },
    dispose: () => {
      disposed.push(true);
      for (const listener of disposeListeners) listener();
    },
  };

  return {
    panel,
    posted,
    revealed,
    disposed,
    sendReady: () => messageListener?.({ type: "ready" }),
    sendRevealFrame: (frameIndex, runToken) =>
      messageListener?.({
        type: "revealFrame",
        frameIndex,
        runToken: runToken ?? lastTracebackToken(posted) ?? 0,
      }),
  };
}

const extensionUri = vscode.Uri.file("/fake-extension");

/** A stand-in origin for the tests that only care that a run started, not
 * where from — `startRun` now requires one. */
const runOrigin: ProgramOrigin = {
  uri: vscode.Uri.file("/workspace/run.py"),
  lineOffset: 0,
};

describe("ResultPanel", () => {
  it("creates no panel for a run that produces only text/plain output", () => {
    let created = 0;
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => {
        created += 1;
        return fakePanel().panel;
      },
    });
    panel.startRun(runOrigin);
    panel.writeOutput({ mime: "text/plain", data: "hello\n" });
    panel.writeOutput({ mime: "text/plain", data: "world\n" });
    assert.equal(created, 0);
  });

  it("creates and reveals the panel, preserving focus, the first time a run produces image/png", () => {
    const fake = fakePanel();
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => fake.panel,
    });
    panel.startRun(runOrigin);
    panel.writeOutput({ mime: "image/png", data: "aGVsbG8=" });
    assert.deepEqual(fake.revealed, [
      { column: vscode.ViewColumn.Beside, preserveFocus: true },
    ]);
  });

  it("reveals again on a second run's first qualifying output, even though the panel already exists", () => {
    // Caught on review: the first version of this class only ever revealed
    // the run that happened to create the panel, so a panel left open but
    // unfocused from an earlier run never came back to front for a later
    // one — this is the regression test for that fix.
    const fake = fakePanel();
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => fake.panel,
    });
    panel.startRun(runOrigin);
    panel.writeOutput({ mime: "image/png", data: "AA==" });
    assert.equal(fake.revealed.length, 1);

    panel.startRun(runOrigin);
    panel.writeOutput({ mime: "text/plain", data: "no reveal yet\n" });
    assert.equal(fake.revealed.length, 1, "text/plain alone reveals nothing");
    panel.writeOutput({ mime: "image/png", data: "BB==" });
    assert.equal(fake.revealed.length, 2, "the second run's own rich output");
  });

  it("does the same for text/html and for a traceback", () => {
    const htmlFake = fakePanel();
    const htmlPanel = new ResultPanel(extensionUri, {
      createPanel: () => htmlFake.panel,
    });
    htmlPanel.writeOutput({ mime: "text/html", data: "<table></table>" });
    assert.equal(htmlFake.revealed.length, 1);

    const tracebackFake = fakePanel();
    const tracebackPanel = new ResultPanel(extensionUri, {
      createPanel: () => tracebackFake.panel,
    });
    tracebackPanel.writeOutput({
      mime: "application/vnd.python.traceback",
      data: { message: "boom", frames: [] },
    });
    assert.equal(tracebackFake.revealed.length, 1);
  });

  it("never opens the panel for an outcome or a failure alone", () => {
    let created = 0;
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => {
        created += 1;
        return fakePanel().panel;
      },
    });
    panel.startRun(runOrigin);
    panel.writeOutcome({ succeeded: true, diagnostics: [] });
    panel.writeFailure({ code: "cancelled" });
    assert.equal(created, 0);
  });

  it("builds an HTML shell whose CSP nonce matches the script tag's own nonce", () => {
    const fake = fakePanel();
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => fake.panel,
    });
    panel.writeOutput({ mime: "image/png", data: "AA==" });

    const html = fake.panel.webview.html;
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /script-src 'nonce-[^']+'/);
    const cspNonce = /nonce-([^']+)'/.exec(html)?.[1];
    const scriptNonce = /<script nonce="([^"]+)"/.exec(html)?.[1];
    assert.ok(cspNonce !== undefined && cspNonce.length > 0);
    assert.equal(scriptNonce, cspNonce);

    // The guarantee that actually matters: script-src carries no inline
    // allowance, so an injected <script> or onerror= in a text/html payload
    // stays inert.
    const scriptSrcDirective = /script-src[^;]*/.exec(html)?.[0] ?? "";
    assert.doesNotMatch(scriptSrcDirective, /unsafe-inline/);

    // style-src carries 'unsafe-inline' *on purpose* — pandas' to_html() and
    // Styler output both need inline CSS, and the residual CSS-only exposure
    // is bounded by default-src 'none' + a data:-only img-src (no exfil
    // sink). This is a deliberate, recorded exception — ADR-0021's
    // "Content-security policy" section and SECURITY.md both carry the
    // analysis. Asserted here so that dropping it to satisfy a scanner trips
    // a red test that points back at that decision rather than silently
    // regressing pandas rendering.
    const styleSrcDirective = /style-src[^;]*/.exec(html)?.[0] ?? "";
    assert.match(styleSrcDirective, /unsafe-inline/);
    assert.match(html, /default-src 'none'/);
  });

  it("buffers every message until the webview's ready handshake, then replays them in order", () => {
    const fake = fakePanel();
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => fake.panel,
    });
    panel.startRun(runOrigin);
    panel.writeOutput({ mime: "image/png", data: "AA==" });
    // Nothing posted yet — the panel exists (it was just created), but has
    // not sent "ready".
    assert.deepEqual(fake.posted, []);

    fake.sendReady();
    assert.equal(fake.posted.length, 2, "the reset, then the one output");
    assert.deepEqual(fake.posted[0], { type: "reset" });
  });

  it("posts immediately, without buffering, once the panel is already ready", () => {
    const fake = fakePanel();
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => fake.panel,
    });
    panel.writeOutput({ mime: "image/png", data: "AA==" });
    fake.sendReady();
    fake.posted.length = 0;

    panel.writeOutput({ mime: "image/png", data: "BB==" });
    assert.equal(fake.posted.length, 1);
  });

  it("numbers images by image index, not by position among every output", () => {
    const fake = fakePanel();
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => fake.panel,
    });
    panel.writeOutput({ mime: "image/png", data: "AA==" });
    fake.sendReady();
    panel.writeOutput({ mime: "text/plain", data: "hi\n" });
    panel.writeOutput({ mime: "image/png", data: "BB==" });

    const images = fake.posted
      .filter(isResultPanelMessage)
      .filter(isOutputMessage)
      .map((message) => message.item)
      .filter(isImageItem);
    assert.equal(images[0]?.alt, "Output image 1");
    assert.equal(images[1]?.alt, "Output image 2");
  });

  it("localises a failed outcome's summary distinctly from a successful one", () => {
    const fake = fakePanel();
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => fake.panel,
    });
    panel.writeOutput({ mime: "image/png", data: "AA==" });
    fake.sendReady();
    fake.posted.length = 0;

    panel.writeOutcome({ succeeded: false, diagnostics: [] });
    // `.find()`, not `.filter(...)[0]` — `@typescript-eslint/prefer-find`
    // requires it, and it returns the same `T | undefined` that makes the
    // `assert.ok` below a real check rather than one
    // `@typescript-eslint/no-unnecessary-condition` would flag as always
    // true: `const [message] = arr` (destructuring) or `arr.filter(...)[0]`
    // both type `message` as definite in ways this codebase's lint
    // configuration treats inconsistently, but `.find()`'s own declared
    // return type is unambiguously `T | undefined`.
    const message = fake.posted
      .filter(isResultPanelMessage)
      .find(isOutcomeMessage);
    assert.ok(message !== undefined);
    assert.equal(message.succeeded, false);
    assert.notEqual(message.summary, "Finished.");
  });

  it("drops an outcome diagnostic that repeats the streamed traceback's message (Finding 74, 5d-iii)", () => {
    const fake = fakePanel();
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => fake.panel,
    });
    panel.writeOutput({ mime: "image/png", data: "AA==" });
    fake.sendReady();
    fake.posted.length = 0;

    const tracebackMessage = "RecursionError: maximum recursion depth exceeded";
    panel.writeOutcome(
      {
        succeeded: false,
        diagnostics: [{ severity: "error", message: tracebackMessage }],
      },
      { message: tracebackMessage, frames: [] },
    );

    const message = fake.posted
      .filter(isResultPanelMessage)
      .find(isOutcomeMessage);
    assert.ok(message !== undefined);
    assert.equal(message.succeeded, false);
    // The panel already holds this text as the raw log items and the
    // structured traceback item — the outcome must not carry it a third time.
    assert.deepEqual(message.diagnostics, []);
  });

  it("keeps an outcome diagnostic that never streamed (a SAS-side error)", () => {
    const fake = fakePanel();
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => fake.panel,
    });
    panel.writeOutput({ mime: "image/png", data: "AA==" });
    fake.sendReady();
    fake.posted.length = 0;

    panel.writeOutcome({
      succeeded: false,
      diagnostics: [
        { severity: "error", message: "ERROR: The SAS System stopped." },
      ],
    });

    const message = fake.posted
      .filter(isResultPanelMessage)
      .find(isOutcomeMessage);
    assert.ok(message !== undefined);
    assert.deepEqual(message.diagnostics, ["ERROR: The SAS System stopped."]);
  });

  it("disposes the underlying panel, and a run after disposal opens a new one", () => {
    const first = fakePanel();
    const second = fakePanel();
    let call = 0;
    const panel = new ResultPanel(extensionUri, {
      createPanel: () => (call++ === 0 ? first.panel : second.panel),
    });
    panel.writeOutput({ mime: "image/png", data: "AA==" });
    panel.dispose();
    assert.deepEqual(first.disposed, [true]);

    panel.writeOutput({ mime: "image/png", data: "BB==" });
    assert.equal(second.revealed.length, 1);
  });

  describe("click-to-jump (Phase 4d)", () => {
    const origin: ProgramOrigin = {
      uri: vscode.Uri.file("/workspace/app.py"),
      lineOffset: 0,
    };
    const tracebackOutput: RichOutput = {
      mime: "application/vnd.python.traceback",
      data: {
        message: "ZeroDivisionError: division by zero",
        frames: [
          { file: "<string>", line: 3, name: "<module>" },
          { file: "/x/lib/helpers.py", line: 9, name: "divide" },
        ],
      },
    };

    function panelWithRevealSpy(fake: ReturnType<typeof fakePanel>): {
      panel: ResultPanel;
      revealed: {
        uri: vscode.Uri;
        position: { line: number; character: number };
      }[];
    } {
      const revealed: {
        uri: vscode.Uri;
        position: { line: number; character: number };
      }[] = [];
      const panel = new ResultPanel(extensionUri, {
        createPanel: () => fake.panel,
        revealPosition: (uri, position) => {
          revealed.push({ uri, position });
        },
      });
      return { panel, revealed };
    }

    it("maps a clicked <string> frame through the run origin and reveals it", () => {
      const fake = fakePanel();
      const { panel, revealed } = panelWithRevealSpy(fake);
      panel.startRun(origin);
      panel.writeOutput(tracebackOutput);
      fake.sendReady();

      fake.sendRevealFrame(0);
      assert.equal(revealed.length, 1);
      const jump = revealed[0];
      assert.ok(jump);
      assert.equal(jump.uri.toString(), origin.uri.toString());
      // frame line 3 (one-based) + lineOffset 0, less 1 => editor line 2.
      assert.deepEqual(jump.position, { line: 2, character: 0 });
    });

    it("adds the run's lineOffset, for a Run Selection origin", () => {
      const fake = fakePanel();
      const { panel, revealed } = panelWithRevealSpy(fake);
      panel.startRun({ uri: origin.uri, lineOffset: 10 });
      panel.writeOutput(tracebackOutput);
      fake.sendReady();

      fake.sendRevealFrame(0);
      const jump = revealed[0];
      assert.ok(jump);
      assert.deepEqual(jump.position, { line: 12, character: 0 });
    });

    it("does nothing for an out-of-range index, a non-<string> frame, or before any traceback", () => {
      const fake = fakePanel();
      const { panel, revealed } = panelWithRevealSpy(fake);
      panel.startRun(origin);
      // An image opens the panel (wiring the inbound listener) before any
      // traceback has streamed, so there are no frames retained yet. The run
      // token matches (this run's), so it is the empty-frames guard that
      // stops it, not the 5d-iv token check.
      panel.writeOutput({ mime: "image/png", data: "AA==" });
      fake.sendRevealFrame(0, 1);
      assert.equal(revealed.length, 0, "no frames retained yet");

      panel.writeOutput(tracebackOutput);
      fake.sendRevealFrame(99, 1);
      assert.equal(revealed.length, 0, "index past the end of the stack");
      fake.sendRevealFrame(1, 1);
      assert.equal(
        revealed.length,
        0,
        "frame 1 is a library frame — mapFrameToOrigin returns undefined",
      );
    });

    it("does nothing when a revealFrame arrives before any run has started", () => {
      // `commands.ts` always calls `startRun` before `writeOutput`, but the
      // guard on `currentOrigin` is still load-bearing: drive `writeOutput`
      // straight, with no `startRun`, and the inbound message is a no-op. The
      // token passed here (0) matches the untouched counter, so it is the
      // `currentOrigin` guard being tested, not the 5d-iv token check.
      const fake = fakePanel();
      const { panel, revealed } = panelWithRevealSpy(fake);
      panel.writeOutput(tracebackOutput);

      fake.sendRevealFrame(0, 0);
      assert.equal(revealed.length, 0);
    });

    it("drops a revealFrame carrying a superseded run's token, but honours the current run's (Phase 5d-iv)", () => {
      const fake = fakePanel();
      const { panel, revealed } = panelWithRevealSpy(fake);

      panel.startRun(origin);
      panel.writeOutput(tracebackOutput);
      fake.sendReady();
      const firstToken = lastTracebackToken(fake.posted);
      assert.ok(firstToken !== undefined);

      // A second run begins and streams its own traceback — the panel resets
      // and re-stamps a fresh token.
      panel.startRun(origin);
      panel.writeOutput(tracebackOutput);
      const secondToken = lastTracebackToken(fake.posted);
      assert.ok(secondToken !== undefined);
      assert.notEqual(secondToken, firstToken);

      // A click queued during the first run, arriving now: dropped.
      fake.sendRevealFrame(0, firstToken);
      assert.equal(revealed.length, 0, "stale run token — no jump");

      // The current run's own click still resolves.
      fake.sendRevealFrame(0, secondToken);
      assert.equal(revealed.length, 1);
    });
  });
});
