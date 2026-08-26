// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type * as vscode from "vscode";

import { RunOutputChannel } from "../../../src/run/outputChannel";

/** A channel double that keeps everything written to it, in order. */
function fakeChannel(): {
  readonly channel: vscode.OutputChannel;
  readonly lines: string[];
  readonly revealed: boolean[];
  readonly disposed: boolean[];
} {
  const lines: string[] = [];
  const revealed: boolean[] = [];
  const disposed: boolean[] = [];
  const channel: vscode.OutputChannel = {
    name: "fake",
    append(value: string) {
      lines.push(value);
    },
    appendLine(value: string) {
      lines.push(`${value}\n`);
    },
    replace() {
      lines.length = 0;
    },
    clear() {
      lines.length = 0;
    },
    show(preserveFocusOrColumn?: unknown) {
      revealed.push(preserveFocusOrColumn === true);
    },
    hide() {
      // Not exercised.
    },
    dispose() {
      disposed.push(true);
    },
  };
  return { channel, lines, revealed, disposed };
}

describe("RunOutputChannel", () => {
  it("names the target as the run's first line", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.writeRunHeader("verde", "app.py");
    assert.equal(fake.lines.length, 1);
    assert.ok(fake.lines[0]?.includes("verde"), fake.lines[0]);
    assert.ok(fake.lines[0]?.includes("app.py"), fake.lines[0]);
  });

  it("names the target for a reset too", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.writeResetHeader("verde");
    assert.ok(fake.lines[0]?.includes("verde"), fake.lines[0]);
  });

  it("appends text/plain output verbatim, with no extra newline added", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.writeOutput({ mime: "text/plain", data: "hello\n" });
    assert.deepEqual(fake.lines, ["hello\n"]);
  });

  it("defers image/png and text/html to a localised placeholder line", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.writeOutput({ mime: "image/png", data: "aGVsbG8=" });
    output.writeOutput({ mime: "text/html", data: "<table></table>" });
    assert.equal(fake.lines.length, 2);
    assert.doesNotMatch(fake.lines[0] ?? "", /aGVsbG8=/);
    assert.doesNotMatch(fake.lines[1] ?? "", /<table>/);
  });

  it("writes nothing for a structured traceback — already visible as raw output", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.writeOutput({
      mime: "application/vnd.python.traceback",
      data: { message: "boom", frames: [] },
    });
    assert.deepEqual(fake.lines, []);
  });

  it("reports success plainly", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.writeOutcome({ succeeded: true, diagnostics: [] });
    assert.ok(fake.lines[0]?.length && !fake.lines[0].includes("error"));
  });

  it("reports every diagnostic on a failed outcome", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.writeOutcome({
      succeeded: false,
      diagnostics: [{ severity: "error", message: "ZeroDivisionError" }],
    });
    assert.ok(fake.lines.some((line) => line.includes("ZeroDivisionError")));
  });

  it("reports a successful reset", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.writeResetSucceeded();
    assert.ok(fake.lines[0]?.trim().length, "expected a non-empty line");
  });

  it("localises a seam failure", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.writeFailure({ code: "cancelled" });
    assert.ok(fake.lines[0]?.trim().length, "expected a non-empty line");
  });

  it("reveals without stealing focus", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.reveal();
    assert.deepEqual(fake.revealed, [true]);
  });

  it("disposes the underlying channel", () => {
    const fake = fakeChannel();
    const output = new RunOutputChannel({ createChannel: () => fake.channel });
    output.dispose();
    assert.deepEqual(fake.disposed, [true]);
  });
});
