// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { type RichOutput } from "../../src/backend/backend";
import {
  droppedLinesOutput,
  isNoiseLine,
  logLineOutput,
} from "../../src/backend/logFilter";
import { type LogLine } from "../../src/compute/job";

/** One log item, the shape `job.ts`'s reader hands to this module. */
function line(text: string, type?: string): LogLine {
  return type === undefined ? { line: text } : { line: text, type };
}

/** Runs the whole filter over a log the way `procPython.ts` does: drop noise,
 * map everything else to a `text/plain` output, in order. */
function filter(lines: readonly LogLine[]): readonly RichOutput[] {
  const outputs: RichOutput[] = [];
  for (const item of lines) {
    if (isNoiseLine(item.type)) continue;
    outputs.push(logLineOutput(item));
  }
  return outputs;
}

function texts(outputs: readonly RichOutput[]): readonly string[] {
  return outputs.map((output) => {
    assert.equal(output.mime, "text/plain");
    return output.data;
  });
}

describe("logFilter", () => {
  describe("isNoiseLine", () => {
    it("treats note, source and title as noise", () => {
      assert.equal(isNoiseLine("note"), true);
      assert.equal(isNoiseLine("source"), true);
      // The page-break banner (finding 63) — added 2026-08-28 (Phase 3's 3f
      // slice) after the 2026-08-27 manual test pass caught it bleeding into
      // stdout, both as a stray line in 4 of the 14 submission-corpus runs
      // and roughly every 58 lines in a 5000-line run.
      assert.equal(isNoiseLine("title"), true);
    });

    it("treats normal and error as not noise", () => {
      assert.equal(isNoiseLine("normal"), false);
      assert.equal(isNoiseLine("error"), false);
    });

    it("treats an unrecognised type as not noise", () => {
      // `job.ts`'s own doc calls the vocabulary "a floor, not a closed set" —
      // an unrecognised type must be shown, not hidden, the day the
      // deployment sends one this codebase has never seen.
      assert.equal(isNoiseLine("warning"), false);
      assert.equal(isNoiseLine("mystery"), false);
    });

    it("treats a missing type as not noise", () => {
      // `LogLine.type` is optional — "an item that arrives without one is
      // still a line worth showing."
      assert.equal(isNoiseLine(undefined), false);
    });
  });

  describe("logLineOutput", () => {
    it("wraps the line's text as text/plain with a trailing newline", () => {
      assert.deepEqual(logLineOutput(line("real output", "normal")), {
        mime: "text/plain",
        data: "real output\n",
      });
    });

    it("keeps an empty line's text empty rather than dropping it", () => {
      // Finding 52 measured genuine log content that is the empty string —
      // this module's job is to decide whether a line is shown, not to
      // second-guess what showing it means once it is.
      assert.deepEqual(logLineOutput(line("", "normal")), {
        mime: "text/plain",
        data: "\n",
      });
    });
  });

  describe("droppedLinesOutput", () => {
    it("formats the count into the marker text procPython.ts already shipped", () => {
      assert.deepEqual(droppedLinesOutput(2), {
        mime: "text/plain",
        data: "[2 log line(s) dropped]\n",
      });
    });
  });

  describe("filtering a real recorded log", () => {
    // Finding 52's 21-line log, verbatim (`docs/phases/phase-2b.md`'s probe
    // findings section, and `CHANGELOG.md`'s 2c entry) — a job that printed
    // one line and then failed. Four types appear: `source` (6), `note` (13),
    // `normal` (1), `error` (1), including four blank `note` lines and two
    // whitespace-only ones.
    const recordedLog: readonly LogLine[] = [
      line("1    data _null_;", "source"),
      line('2      put "PROBE NORMAL LINE";', "source"),
      line("3    run;", "source"),
      line("", "note"),
      line("PROBE NORMAL LINE", "normal"),
      line("NOTE: DATA statement used (Total process time):", "note"),
      line("      real time           0.00 seconds", "note"),
      line("      cpu time            0.00 seconds", "note"),
      line("      ", "note"),
      line("", "note"),
      line("4    data _null_;", "source"),
      line("5      set nosuchlib.nosuchtable;", "source"),
      line("ERROR: Libref 'nosuchlib' exceeds 8 characters.", "error"),
      line("6    run;", "source"),
      line("", "note"),
      line(
        "NOTE: The SAS System stopped processing this step because of errors.",
        "note",
      ),
      line("NOTE: DATA statement used (Total process time):", "note"),
      line("      real time           0.00 seconds", "note"),
      line("      cpu time            0.00 seconds", "note"),
      line("      ", "note"),
      line("", "note"),
    ];

    it("keeps only the normal and error lines, in order", () => {
      assert.deepEqual(texts(filter(recordedLog)), [
        "PROBE NORMAL LINE\n",
        "ERROR: Libref 'nosuchlib' exceeds 8 characters.\n",
      ]);
    });

    it("drops every source and note line, blank and whitespace-only included", () => {
      const kept = filter(recordedLog).length;
      assert.equal(kept, 2, "expected exactly the normal and error lines");
    });
  });

  describe("a log with no source lines, as a real 3a run is predicted to produce", () => {
    // ADR-0014's `infile=` submission echoes no source at all (finding 35), so
    // a real run's log is predicted to carry only `normal`, `error` and `note`
    // — this is not a measurement (see this module's own doc comment), but the
    // filter must behave identically either way, since it switches on `type`
    // and never on a line's position in the log.
    it("forwards normal output and an unrecognised type, drops note", () => {
      const log: readonly LogLine[] = [
        line(
          "NOTE: Resuming Python state from previous PROC PYTHON invocation.",
          "note",
        ),
        line("real output", "normal"),
        line("something unrecognised", "mystery"),
      ];

      assert.deepEqual(texts(filter(log)), [
        "real output\n",
        "something unrecognised\n",
      ]);
    });
  });
});
