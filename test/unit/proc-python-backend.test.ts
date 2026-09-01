// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type ExecutionHandle,
  type RichOutput,
} from "../../src/backend/backend";
import {
  ENVIRONMENT_PROBE_FILENAME,
  environmentProbeStatements,
} from "../../src/backend/environment";
import {
  ProcPythonBackend,
  type SubmissionGuard,
} from "../../src/backend/procPython";
import { type BackendResult } from "../../src/backend/problems";
import {
  type ComputeClient,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
} from "../../src/compute/client";
import { type ComputeSession } from "../../src/compute/session";
import { type Dialect } from "../../src/dialects/dialect";
import { fakeProgram } from "../helpers/fake-backend";
import { readFixtureBytes } from "../helpers/fixtures";

/**
 * `ProcPythonBackend` — ADR-0014's mechanism wired to ADR-0015's seam.
 *
 * The fake `ComputeClient` here routes by `link.rel` (and, for `variables`, by
 * the filter in the href) rather than by request order: `streamJobLog`'s own
 * internal cadence — how many empty log polls it sends before asking the job's
 * state — is `logStream.ts`'s to test, not this module's, and a router keyed
 * on content is indifferent to it. Every scripted reply resolves immediately,
 * so every empty poll looks "fast" to the pump and the state is asked after
 * the first one; nothing here relies on that beyond it being quick.
 */

const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;
const JOB_ID = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b-job0000";
const JOB_PATH = `${SESSION_PATH}/jobs/${JOB_ID}`;

function session(): ComputeSession {
  return {
    id: SESSION_ID,
    state: "idle",
    links: [
      { method: "POST", rel: "assign", href: `${SESSION_PATH}/filerefs` },
      { method: "POST", rel: "execute", href: `${SESSION_PATH}/jobs` },
      {
        method: "GET",
        rel: "variables",
        href: `${SESSION_PATH}/variables`,
        responseType: "application/vnd.sas.collection",
      },
      {
        method: "GET",
        rel: "getFiles",
        href: `${SESSION_PATH}/files/cwd`,
        type: "application/vnd.sas.compute.file.properties",
      },
    ],
  };
}

/** {@link session} plus the `files` relation the fileref-collection `GET`
 * follows — a session shaped like one an earlier extension host already used,
 * so `seedFilerefCounter` has something to read (Finding 72). The plain
 * {@link session} deliberately omits it, so every other test skips seeding
 * with no extra scripted reply. */
function sessionWithFilerefList(): ComputeSession {
  const base = session();
  return {
    ...base,
    links: [
      ...base.links,
      {
        method: "GET",
        rel: "files",
        href: `${SESSION_PATH}/filerefs`,
        type: "application/vnd.sas.collection",
      },
    ],
  };
}

function dialect(): Dialect {
  return {
    id: "viya4",
    deployment: { kind: "viya4", release: "2026.03" },
    contract: "viya4",
    hasBuiltInClient: () => true,
    describe: () => "Viya 4 (test fixture)",
  };
}

function guard(initiallyBusy = false): SubmissionGuard & {
  readonly calls: readonly string[];
} {
  let busy = initiallyBusy;
  const calls: string[] = [];
  return {
    calls,
    isBusy: () => busy,
    startSubmission: () => {
      calls.push("start");
      if (busy) return false;
      busy = true;
      return true;
    },
    endSubmission: () => {
      calls.push("end");
      busy = false;
    },
  };
}

/**
 * A guard where `isBusy()` always reads clear, yet `startSubmission()` still
 * fails — the genuine cross-window race `procPython.ts`'s own doc comment
 * describes and the plain {@link guard} fixture above cannot represent, since
 * that one backs both methods with the same boolean and so can only ever
 * agree with itself. This models another window's `startSubmission()` winning
 * in the gap between this backend's own `isBusy()` check and its call.
 */
function racingGuard(): SubmissionGuard & {
  readonly calls: readonly string[];
} {
  const calls: string[] = [];
  return {
    calls,
    isBusy: () => false,
    startSubmission: () => {
      calls.push("start");
      return false;
    },
    endSubmission: () => {
      calls.push("end");
    },
  };
}

type Reply = ComputeResult<ComputeResponse>;

function ok(body: unknown, init?: Partial<ComputeResponse>): Reply {
  return {
    ok: true,
    value: {
      status: 200,
      notModified: false,
      contentType: "application/json",
      text: "",
      body,
      ...init,
    },
  };
}

function rejected(code: string, detail: string, status = 500): Reply {
  return {
    ok: false,
    reason: detail,
    problem: { code, detail, error: { status } } as never,
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** One log item, the shape `job.ts`'s reader expects. */
function line(text: string, type = "normal"): unknown {
  return { line: text, type };
}

interface RouterOptions {
  syscc: string;
  syserrortext?: string;
  logLines?: readonly unknown[];
  assignReply?: Reply;
  /** The first N `assign` requests answer HTTP 400 "already exists" — the
   * shape Finding 72's reattached session produces — and the rest behave
   * normally. Models `seedFilerefCounter` having under-counted (or been
   * skipped) so `createRunFileref`'s bounded retry walks past a few held
   * names. */
  assignConflicts?: number;
  /** The `PYnnnnnn` (and other) fileref names the session's `files`
   * collection reports, for `seedFilerefCounter`. Only consulted when the
   * session actually carries a `files` link — see
   * {@link sessionWithFilerefList}. */
  filerefList?: readonly string[];
  /** Overrides the `files` collection `GET` outright — a failed listing,
   * exercising `seedFilerefCounter`'s best-effort "leave the counter alone"
   * arm. */
  filerefListReply?: Reply;
  /** The first N `files` collection `GET`s fail (HTTP 500); later ones behave
   * normally, returning {@link RouterOptions.filerefList}. Models a transient
   * listing failure that must not disable seeding for the whole connection —
   * the next run has to retry the `GET`. */
  filerefListFailFirst?: number;
  selfReply?: Reply;
  uploadReply?: Reply;
  executeReply?: Reply;
  /** Held instead of answered on the first `log` request, if given. */
  logGate?: Promise<Reply>;
  /** Held instead of answered on the `assign` request, if given. */
  assignGate?: Promise<Reply>;
  /** Held instead of answered on the first `execute` (job-creation) request,
   * if given — this is `createJob`, not `ExecutionBackend.execute`. */
  executeGate?: Promise<Reply>;
  /** Held instead of answered on the first `variables` (`SYSCC`) request, if
   * given — simulates cancelling after the job is already terminal. */
  variablesGate?: Promise<Reply>;
  /** Held instead of answered on the first `SYSERRORTEXT` read, if given —
   * simulates cancelling in the second race window, after `SYSCC` has already
   * confirmed a failure but before the SAS-side message has been read. */
  syserrortextGate?: Promise<Reply>;
  /** When `true`, the `SYSCC` filter matches nothing — `readVariable` resolves
   * `{ ok: true, value: undefined }`, the "every session has one" guarantee
   * finding 37 relies on turning out false for this one. */
  sysccMissing?: boolean;
  /** Overrides the `SYSERRORTEXT` reply outright (rather than gating it) — a
   * genuine, non-cancellation failure here exercises `readSyscc`'s
   * best-effort fallback: the run is still reported failed on `SYSCC` alone,
   * just without the SAS-side message. */
  syserrortextReply?: Reply;
  /** Overrides the job's `cancel` `PUT` reply — a failure here exercises
   * `cancelActive`'s own `backend-failed` mapping of `LogStream.cancel()`
   * failing, distinct from the run itself failing. */
  cancelReply?: Reply;
  /** The session working directory's contents `runProgram`'s pre-job listing
   * sees (ADR-0019 point 1). Defaults to empty. */
  filesBefore?: readonly { name: string; size: number }[];
  /** The directory's contents the post-job listing sees (ADR-0019 point 3).
   * Defaults to `filesBefore` unchanged, i.e. no candidates. */
  filesAfter?: readonly { name: string; size: number }[];
  /** A `getFile` fetch answers with these bytes, keyed by file name. Absent
   * names answer with an empty body. */
  fileContent?: Record<string, Uint8Array>;
  /** Overrides a `getFile` reply outright for a given name — a genuine fetch
   * failure, distinct from the cap simply excluding it beforehand. */
  fileContentReply?: Record<string, Reply>;
  /** Names for which `deleteFile` answers with a rejection instead of `204`. */
  deleteFails?: readonly string[];
  /** Overrides a `getDirectoryMembers` reply outright, keyed by the call's
   * 1-based ordinal — `1` is `runProgram`'s pre-job listing (ADR-0019 point
   * 1), `2` is `captureRichOutput`'s post-job listing (point 3). A rejection
   * here, rather than a gate, exercises `captureRichOutput`'s own "no
   * baseline to diff, so skip the whole step" and "after-listing failed"
   * branches — distinct from anything `compute-files.test.ts` already covers
   * at `listSessionFiles`'s own level, since these are `procPython.ts`'s
   * branches around that call, not `files.ts`'s. */
  directoryMembersCallReply?: Record<number, Reply>;
  /** Held instead of answered on the first `getFile` request, if given —
   * simulates cancelling in the race window `captureRichOutput` itself opens:
   * after `SYSCC` has already confirmed the run's outcome, but before a
   * candidate's content fetch (and everything after it) has resolved. */
  fileContentGate?: Promise<Reply>;
}

/** The file name a `getFileProperties`/`getFile`/`deleteFile` href names —
 * the last path segment, `/content` stripped, percent-decoded. Mirrors how
 * `fileLinksFor` below builds those hrefs in the first place. */
function fileNameFromHref(href: string): string {
  const base = href.endsWith("/content")
    ? href.slice(0, -"/content".length)
    : href;
  const segment = base.split("/").pop() ?? "";
  return decodeURIComponent(segment);
}

/** One listing item's own link set, shaped like finding 68's confirmed
 * relations: `getFileProperties` and `getFile` as `GET`s, `deleteFile` as a
 * `DELETE` — never `self`/`delete`. */
function fileLinksFor(name: string): unknown[] {
  const path = `${SESSION_PATH}/files/cwd/${encodeURIComponent(name)}`;
  return [
    {
      rel: "getFileProperties",
      method: "GET",
      href: path,
      type: "application/vnd.sas.compute.file.properties",
    },
    {
      rel: "getFile",
      method: "GET",
      href: `${path}/content`,
    },
    { rel: "deleteFile", method: "DELETE", href: path },
  ];
}

/** A `ComputeClient` that answers every request `ProcPythonBackend` makes,
 * keyed on what the request is for rather than on when it arrives. */
function router(opts: RouterOptions): {
  readonly client: ComputeClient;
  readonly requests: ComputeRequest[];
  readonly deletedNames: readonly string[];
} {
  let filerefName = "unknown";
  let logCalls = 0;
  let filesCalls = 0;
  let assignCalls = 0;
  let executeCalls = 0;
  let sysccCalls = 0;
  let syserrortextCalls = 0;
  let directoryMemberCalls = 0;
  let getFileCalls = 0;
  const deletedNames: string[] = [];

  const requests: ComputeRequest[] = [];
  const client: ComputeClient = {
    send: async (request) => {
      requests.push(request);
      switch (request.link.rel) {
        case "files": {
          if (opts.filerefListReply !== undefined) {
            return opts.filerefListReply;
          }
          filesCalls += 1;
          if (
            opts.filerefListFailFirst !== undefined &&
            filesCalls <= opts.filerefListFailFirst
          ) {
            return rejected("compute-rejected", "500 Internal Server Error");
          }
          return ok(
            {
              count: opts.filerefList?.length ?? 0,
              items: (opts.filerefList ?? []).map((id) => ({ id })),
            },
            { contentType: "application/vnd.sas.collection+json" },
          );
        }
        case "assign": {
          if (opts.assignGate !== undefined) return await opts.assignGate;
          if (opts.assignReply !== undefined) return opts.assignReply;
          assignCalls += 1;
          const body = request.body as { name: string };
          if (
            opts.assignConflicts !== undefined &&
            assignCalls <= opts.assignConflicts
          ) {
            return rejected(
              "compute-rejected",
              `The fileref "${body.name}" already exists.`,
              400,
            );
          }
          filerefName = body.name;
          return ok(
            {
              id: filerefName,
              links: [
                {
                  rel: "self",
                  method: "GET",
                  href: `${SESSION_PATH}/filerefs/${filerefName}`,
                },
                {
                  rel: "upload",
                  method: "PUT",
                  href: `${SESSION_PATH}/filerefs/${filerefName}/content`,
                  type: "application/octet-stream",
                },
              ],
            },
            { status: 201 },
          );
        }
        case "self":
          if (opts.selfReply !== undefined) return opts.selfReply;
          return ok({ id: filerefName }, { etag: '"v1"' });
        case "upload":
          if (opts.uploadReply !== undefined) return opts.uploadReply;
          return ok(undefined, { status: 201 });
        case "execute":
          executeCalls += 1;
          if (executeCalls === 1 && opts.executeGate !== undefined) {
            return await opts.executeGate;
          }
          if (opts.executeReply !== undefined) return opts.executeReply;
          return ok(
            {
              id: JOB_ID,
              state: "pending",
              links: [
                // Finding 75: `cancelJob` now reads this relation for a fresh
                // ETag immediately before its `PUT`, routing through the
                // same generic `case "self"` below (keyed on `rel` alone,
                // same as the fileref's own self link) — hence the shared
                // `'"v1"'` ETag rather than a job-specific one.
                { rel: "self", method: "GET", href: JOB_PATH },
                { rel: "state", method: "GET", href: `${JOB_PATH}/state` },
                {
                  rel: "log",
                  method: "GET",
                  href: `${JOB_PATH}/log`,
                  type: "application/vnd.sas.collection",
                },
                {
                  rel: "cancel",
                  method: "PUT",
                  href: `${JOB_PATH}/state?value=canceled`,
                },
              ],
            },
            { status: 201 },
          );
        case "log": {
          logCalls += 1;
          if (logCalls === 1 && opts.logGate !== undefined) {
            return await opts.logGate;
          }
          const items =
            logCalls === 1 && opts.logLines !== undefined ? opts.logLines : [];
          return ok(
            {
              count: 99,
              items,
              links: [{ rel: "self", method: "GET", href: `${JOB_PATH}/log` }],
            },
            { contentType: "application/vnd.sas.collection+json" },
          );
        }
        case "state":
          return ok(undefined, {
            status: 200,
            contentType: "text/plain",
            text: "completed",
            body: undefined,
          });
        case "cancel":
          if (opts.cancelReply !== undefined) return opts.cancelReply;
          return ok(undefined, { status: 204 });
        case "variables": {
          const name = variableName(request.link.href);
          if (name === "SYSCC") {
            sysccCalls += 1;
            if (sysccCalls === 1 && opts.variablesGate !== undefined) {
              return await opts.variablesGate;
            }
            if (opts.sysccMissing === true) {
              return ok({ count: 0, items: [] });
            }
            return ok({ count: 1, items: [{ name, value: opts.syscc }] });
          }
          if (name === "SYSERRORTEXT") {
            syserrortextCalls += 1;
            if (
              syserrortextCalls === 1 &&
              opts.syserrortextGate !== undefined
            ) {
              return await opts.syserrortextGate;
            }
            if (opts.syserrortextReply !== undefined) {
              return opts.syserrortextReply;
            }
            return opts.syserrortext === undefined
              ? ok({ count: 0, items: [] })
              : ok({ count: 1, items: [{ name, value: opts.syserrortext }] });
          }
          return ok({ count: 0, items: [] });
        }
        case "getFiles":
          return ok({
            isDirectory: true,
            links: [
              {
                rel: "getDirectoryMembers",
                method: "GET",
                href: `${SESSION_PATH}/files/cwd/members`,
                type: "application/vnd.sas.collection",
              },
            ],
          });
        case "getDirectoryMembers": {
          directoryMemberCalls += 1;
          const override =
            opts.directoryMembersCallReply?.[directoryMemberCalls];
          if (override !== undefined) return override;
          const listing =
            directoryMemberCalls === 1
              ? (opts.filesBefore ?? [])
              : (opts.filesAfter ?? opts.filesBefore ?? []);
          return ok({
            count: listing.length,
            items: listing.map((file) => ({
              name: file.name,
              size: file.size,
              links: fileLinksFor(file.name),
            })),
          });
        }
        case "getFileProperties": {
          const name = fileNameFromHref(request.link.href);
          return ok({ name }, { etag: `"etag-${name}"` });
        }
        case "getFile": {
          getFileCalls += 1;
          if (getFileCalls === 1 && opts.fileContentGate !== undefined) {
            return await opts.fileContentGate;
          }
          const name = fileNameFromHref(request.link.href);
          if (opts.fileContentReply?.[name] !== undefined) {
            return opts.fileContentReply[name];
          }
          return ok(null, {
            rawBody: opts.fileContent?.[name] ?? new Uint8Array(),
          });
        }
        case "deleteFile": {
          const name = fileNameFromHref(request.link.href);
          if (opts.deleteFails?.includes(name)) {
            return rejected("compute-rejected", "500 Internal Server Error");
          }
          deletedNames.push(name);
          return ok(undefined, { status: 204 });
        }
        default:
          throw new Error(`unscripted request rel: ${request.link.rel}`);
      }
    },
  };
  return { client, requests, deletedNames };
}

/** The `name` a filtered `variables` read was asking for. */
function variableName(href: string): string | undefined {
  const query = href.split("?")[1];
  if (query === undefined) return undefined;
  const filter = new URLSearchParams(query).get("filter");
  if (filter === null) return undefined;
  const match = /eq\(name,'(.*)'\)/.exec(filter);
  return match?.[1];
}

async function collect(
  outputs: AsyncIterable<RichOutput>,
): Promise<RichOutput[]> {
  const out: RichOutput[] = [];
  for await (const output of outputs) out.push(output);
  return out;
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function texts(outputs: readonly RichOutput[]): string[] {
  return outputs
    .filter(
      (output): output is Extract<RichOutput, { mime: "text/plain" }> =>
        output.mime === "text/plain",
    )
    .map((output) => output.data);
}

function accept(result: BackendResult<ExecutionHandle>): ExecutionHandle {
  assert.ok(result.ok, "execute() did not accept the run");
  return result.value;
}

describe("ProcPythonBackend", () => {
  describe("capabilities", () => {
    it("reports the dialect it was constructed for, without I/O", () => {
      const { client } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      const capabilities = backend.capabilities();
      assert.equal(capabilities.dialect, "viya4");
      assert.equal(capabilities.deployment.kind, "viya4");
      assert.deepEqual(capabilities.runtime, { kind: "unprobed" });
    });
  });

  describe("connecting", () => {
    it("connects twice without complaint", async () => {
      const { client } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      assert.ok((await backend.connect()).ok);
      assert.ok((await backend.connect()).ok);
    });

    it("refuses to run before it is connected", async () => {
      const { client, requests } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      const result = await backend.execute(fakeProgram(), {
        freshNamespace: false,
      });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "not-connected");
      assert.equal(requests.length, 0);
    });
  });

  describe("a run that succeeds", () => {
    it("uploads, submits, forwards output and reports success", async () => {
      const { client, requests } = router({
        syscc: "0",
        logLines: [line("6")],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();

      const accepted = accept(
        await backend.execute(fakeProgram("print(2 + 4)"), {
          freshNamespace: false,
        }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(settled.value.succeeded);
      assert.deepEqual(settled.value.diagnostics, []);
      assert.deepEqual(texts(outputs), ["6\n"]);

      // Upload before the pre-run directory listing (ADR-0019 point 1),
      // before submission, before any log or variable read.
      const order = requests.map((request) => request.link.rel);
      assert.deepEqual(order.slice(0, 3), ["assign", "self", "upload"]);
      assert.equal(order[3], "getFiles");
      assert.equal(order[4], "getDirectoryMembers");
      assert.equal(order[5], "execute");
      assert.ok(order.includes("variables"));

      // `restart` was not composed in — `freshNamespace: false` was asked for.
      const submitted = requests.find(
        (request) => request.link.rel === "execute",
      );
      const code = (submitted?.body as { code: string[] }).code;
      // ADR-0014 amendment, finding 70: a trailing `run;` closes the step —
      // without it, the step's own log/SYSCC/file-writes never flush.
      assert.equal(code.length, 2);
      assert.ok(code[0]?.startsWith("proc python infile="));
      assert.ok(!code[0]?.includes("restart"));
      assert.equal(code[1], "run;");
    });

    it("composes `restart` into the same statement for a fresh namespace", async () => {
      const { client, requests } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: true }),
      );
      // The fileref/job wire calls happen in the background after `execute`
      // has already resolved (ADR-0015: accepted, not finished) — `done` has
      // to be awaited before `requests` reflects them.
      await accepted.done;

      const submitted = requests.find(
        (request) => request.link.rel === "execute",
      );
      assert.ok(submitted !== undefined, "no job was ever submitted");
      const code = (submitted.body as { code: string[] }).code;
      assert.ok(code[0]?.startsWith("proc python restart infile="));
    });

    it("drops note and source lines but keeps everything else", async () => {
      const { client } = router({
        syscc: "0",
        logLines: [
          line(
            "NOTE: Resuming Python state from previous PROC PYTHON invocation.",
            "note",
          ),
          line("real output", "normal"),
          line("something unrecognised", "mystery"),
        ],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      await accepted.done;

      assert.deepEqual(texts(outputs), [
        "real output\n",
        "something unrecognised\n",
      ]);
    });

    it("forwards a dropped-lines marker as its own text/plain output", async () => {
      // A first attempt at this test pushed 100,005 lines through the real
      // `DEFAULT_MAX_BUFFERED_LINES` (100,000) to provoke `logStream.ts`'s
      // `EventBuffer` into emitting a `{ kind: "dropped" }` event, and blew
      // past `.mocharc.json`'s deliberate 2-second unit-test budget on every
      // CI runner — "anything taking longer than two seconds is not slow, it
      // is stuck." `logBufferLimits` is the test-only seam added afterward so
      // this branch is cheaply reachable instead: a cap of 3 lines, fed 5 in
      // one poll, drops the oldest 2.
      const { client } = router({
        syscc: "0",
        logLines: [line("1"), line("2"), line("3"), line("4"), line("5")],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
        undefined,
        { maxBufferedLines: 3 },
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(settled.value.succeeded);
      const dropped = texts(outputs).find((text) =>
        text.includes("log line(s) dropped"),
      );
      assert.equal(dropped, "[2 log line(s) dropped]\n");
      assert.deepEqual(
        texts(outputs).filter((text) => text !== dropped),
        ["3\n", "4\n", "5\n"],
      );
    });
  });

  describe("a run that raises", () => {
    it("reports an unhandled Python exception as a structured traceback, with the harness's <stdin> wrapper frames dropped (3c-ii, finding 39)", async () => {
      const { client } = router({
        syscc: "1012",
        syserrortext: "Unhandled Python exception.",
        logLines: [
          line("Traceback (most recent call last):"),
          line('  File "<stdin>", line 5, in <module>'),
          line('  File "<stdin>", line 2, in <module>'),
          line('  File "<string>", line 2, in <module>'),
          line("ValueError: boom-at-line-2"),
        ],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(!settled.value.succeeded);
      assert.equal(settled.value.diagnostics.length, 1);
      assert.equal(
        settled.value.diagnostics[0]?.message,
        "ValueError: boom-at-line-2",
      );

      const traceback = outputs.find(
        (
          output,
        ): output is Extract<
          RichOutput,
          { mime: "application/vnd.python.traceback" }
        > => output.mime === "application/vnd.python.traceback",
      );
      assert.ok(traceback !== undefined, "no traceback was forwarded");
      assert.equal(traceback.data.message, "ValueError: boom-at-line-2");
      // Only the user's own frame survives — both `<stdin>` harness frames
      // are dropped, not just re-ordered.
      assert.deepEqual(traceback.data.frames, [
        { file: "<string>", line: 2, name: "<module>" },
      ]);
    });

    it("appends Show Environment guidance to a ModuleNotFoundError's diagnostic message, leaving the forwarded traceback's own message untouched (phase-3.md 3e, phase-4.md 4c)", async () => {
      const { client } = router({
        syscc: "1012",
        syserrortext: "Unhandled Python exception.",
        logLines: [
          line("Traceback (most recent call last):"),
          line('  File "<stdin>", line 5, in <module>'),
          line('  File "<stdin>", line 2, in <module>'),
          line('  File "<string>", line 1, in <module>'),
          line("ModuleNotFoundError: No module named 'polars'"),
        ],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(!settled.value.succeeded);
      assert.equal(
        settled.value.diagnostics[0]?.message,
        "ModuleNotFoundError: No module named 'polars' Run \"Python on Viya: " +
          'Show Environment" to see what is installed on this connection.',
      );

      const traceback = outputs.find(
        (
          output,
        ): output is Extract<
          RichOutput,
          { mime: "application/vnd.python.traceback" }
        > => output.mime === "application/vnd.python.traceback",
      );
      assert.ok(traceback !== undefined, "no traceback was forwarded");
      // The forwarded traceback's own message is 4d's result-panel payload
      // and must read exactly as Python printed it — no guidance appended.
      assert.equal(
        traceback.data.message,
        "ModuleNotFoundError: No module named 'polars'",
      );
    });

    it("keeps every <string> frame when the user's own code recurses, dropping only the harness's leading <stdin> frames", async () => {
      // Only the *leading* run of `<stdin>` frames is the harness's: the
      // user's own code can recurse and print several `<string>` frames, and
      // none of them are mistaken for wrapper frames (3c-ii, finding 39).
      const { client } = router({
        syscc: "1012",
        syserrortext: "Unhandled Python exception.",
        logLines: [
          line("Traceback (most recent call last):"),
          line('  File "<stdin>", line 5, in <module>'),
          line('  File "<stdin>", line 2, in <module>'),
          line('  File "<string>", line 4, in <module>'),
          line('  File "<string>", line 2, in boom'),
          line("RecursionError: maximum recursion depth exceeded"),
        ],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      await accepted.done;

      const traceback = outputs.find(
        (
          output,
        ): output is Extract<
          RichOutput,
          { mime: "application/vnd.python.traceback" }
        > => output.mime === "application/vnd.python.traceback",
      );
      assert.ok(traceback !== undefined, "no traceback was forwarded");
      assert.deepEqual(traceback.data.frames, [
        { file: "<string>", line: 4, name: "<module>" },
        { file: "<string>", line: 2, name: "boom" },
      ]);
    });

    it("keeps a user-generated <stdin> frame that appears below a real frame, blocking finding from PR #61's review", async () => {
      // Regression test for a real bug an automated reviewer caught before
      // merge: a first version of this filter dropped every frame labelled
      // `<stdin>` wherever it appeared, which would silently erase a frame
      // the user's own code produces via `compile(src, "<stdin>", "exec")` (or
      // `eval`/`exec` against a code object built that way) — a real,
      // legitimate frame, not a harness artifact, because it can only ever
      // appear below at least one non-harness frame. Only the harness's
      // *leading* run at the top of the stack should be dropped.
      const { client } = router({
        syscc: "1012",
        syserrortext: "Unhandled Python exception.",
        logLines: [
          line("Traceback (most recent call last):"),
          line('  File "<stdin>", line 5, in <module>'),
          line('  File "<stdin>", line 2, in <module>'),
          line('  File "<string>", line 3, in <module>'),
          line('  File "<stdin>", line 1, in <module>'),
          line("ValueError: boom-from-compiled-stdin"),
        ],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      await accepted.done;

      const traceback = outputs.find(
        (
          output,
        ): output is Extract<
          RichOutput,
          { mime: "application/vnd.python.traceback" }
        > => output.mime === "application/vnd.python.traceback",
      );
      assert.ok(traceback !== undefined, "no traceback was forwarded");
      // The two leading harness frames are gone; the user's own `<string>`
      // frame AND the user-generated `<stdin>` frame below it both survive.
      assert.deepEqual(traceback.data.frames, [
        { file: "<string>", line: 3, name: "<module>" },
        { file: "<stdin>", line: 1, name: "<module>" },
      ]);
    });

    it("reports an empty frame list, not a plain-message fallback, when only the harness's own <stdin> frames are present", async () => {
      // A header genuinely found, with genuine frame lines following it, but
      // every one of them is the harness's own `<stdin>` — the harness itself
      // failing rather than the user's code. Distinct from "no frame lines at
      // all", which still falls back to a plain message below.
      const { client } = router({
        syscc: "1012",
        syserrortext: "Unhandled Python exception.",
        logLines: [
          line("Traceback (most recent call last):"),
          line('  File "<stdin>", line 5, in <module>'),
          line("RuntimeError: harness-only-failure"),
        ],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      await accepted.done;

      const traceback = outputs.find(
        (
          output,
        ): output is Extract<
          RichOutput,
          { mime: "application/vnd.python.traceback" }
        > => output.mime === "application/vnd.python.traceback",
      );
      assert.ok(traceback !== undefined, "no traceback was forwarded");
      assert.equal(
        traceback.data.message,
        "RuntimeError: harness-only-failure",
      );
      assert.deepEqual(traceback.data.frames, []);
    });

    it("falls back to a plain message for SYSCC=1012 with no traceback header at all", async () => {
      // `parseTraceback` returns `undefined` when no `Traceback (most recent
      // call last):` line is found — a `SYSCC=1012` run whose log was
      // truncated or never actually printed one. Untested either way before
      // this; pins the fallback rather than assuming it.
      const { client } = router({
        syscc: "1012",
        syserrortext: "Unhandled Python exception.",
        logLines: [line("some ordinary output, no traceback here")],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(!settled.value.succeeded);
      assert.equal(
        settled.value.diagnostics[0]?.message,
        "Unhandled Python exception.",
      );
      assert.ok(
        !outputs.some(
          (output) => output.mime === "application/vnd.python.traceback",
        ),
      );
    });

    it("falls back to a plain message for SYSCC=1012 with a header but no frame lines", async () => {
      // The header-found, zero-frames path — `parseTraceback` also returns
      // `undefined` here, distinct from "no header at all" above but exercising
      // the same fallback. Not previously tested.
      const { client } = router({
        syscc: "1012",
        syserrortext: "Unhandled Python exception.",
        logLines: [
          line("Traceback (most recent call last):"),
          line("ValueError: boom-with-no-frames"),
        ],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(!settled.value.succeeded);
      assert.equal(
        settled.value.diagnostics[0]?.message,
        "Unhandled Python exception.",
      );
      assert.ok(
        !outputs.some(
          (output) => output.mime === "application/vnd.python.traceback",
        ),
      );
    });

    it("reports a SAS-side error as a message, with no traceback to invent", async () => {
      const { client } = router({
        syscc: "3000",
        syserrortext:
          "180-322: Statement is not valid or it is used out of proper order.",
        logLines: [line("ERROR: some statement was wrong.", "error")],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(!settled.value.succeeded);
      assert.equal(
        settled.value.diagnostics[0]?.message,
        "180-322: Statement is not valid or it is used out of proper order.",
      );
      assert.ok(
        !outputs.some(
          (output) => output.mime === "application/vnd.python.traceback",
        ),
      );
    });

    it("still reports the failure when reading SYSERRORTEXT itself fails", async () => {
      // `readSyscc`'s own doc comment calls this "best-effort": a failure
      // reading SYSERRORTEXT does not undo a program SYSCC already confirmed
      // failed, it just means the run is reported without the SAS-side
      // message. Every other SYSERRORTEXT-adjacent test only ever gated or
      // cancelled this read; a genuine, non-cancellation failure here (a
      // dropped session) had never been exercised.
      const { client } = router({
        syscc: "3000",
        syserrortextReply: rejected("compute-rejected", "404 Not Found"),
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(!settled.value.succeeded);
      assert.equal(
        settled.value.diagnostics[0]?.message,
        "SAS reported an error (SYSCC=3000)",
      );
    });
  });

  describe("busy", () => {
    it("refuses a second run while one is in flight, naming it", async () => {
      const { client } = router({
        syscc: "0",
        logGate: deferred<Reply>().promise,
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const first = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      assert.ok(backend.busy);

      const second = await backend.execute(fakeProgram("print(2)"), {
        freshNamespace: false,
      });
      assert.ok(!second.ok);
      assert.equal(second.problem.code, "busy");
      // `assert.equal` above already narrows `second.problem` to the `busy`
      // variant, so `running` is reachable without re-checking `code`.
      assert.equal(second.problem.running, first.id);
    });

    it("defers to the shared guard when another window holds the claim", async () => {
      const { client } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(true),
      );
      await backend.connect();

      const result = await backend.execute(fakeProgram(), {
        freshNamespace: false,
      });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "busy");
    });

    it("refuses via the guard's own race, even though isBusy() reads clear", async () => {
      // The scenario `procPython.ts`'s doc comment gives for why `busy`
      // delegates to a guard at all: another window's `startSubmission()` can
      // win in the gap after this backend's own `isBusy()` already read
      // clear. The shared `guard()` fixture cannot represent that; this one
      // (`racingGuard()`) can, and it was untested either way before this.
      const { client, requests } = router({ syscc: "0" });
      const raced = racingGuard();
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        raced,
      );
      await backend.connect();

      const result = await backend.execute(fakeProgram(), {
        freshNamespace: false,
      });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "busy");
      assert.deepEqual([...raced.calls], ["start"]);
      assert.equal(requests.length, 0);
    });

    it("releases the guard once the run settles", async () => {
      const { client } = router({ syscc: "0" });
      const submissionGuard = guard();
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        submissionGuard,
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await accepted.done;

      assert.ok(!backend.busy);
      assert.deepEqual([...submissionGuard.calls], ["start", "end"]);
    });
  });

  describe("cancelling", () => {
    it("aborts mid-transfer, before any job exists", async () => {
      const gate = deferred<Reply>();
      const { client, requests } = router({
        syscc: "0",
        assignGate: gate.promise,
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await flush();
      assert.deepEqual(
        requests.map((request) => request.link.rel),
        ["assign"],
      );

      const cancelled = await backend.cancel(accepted);
      assert.ok(cancelled.ok);

      gate.resolve(rejected("compute-unreachable", "aborted"));
      const settled = await accepted.done;
      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "cancelled");
      assert.ok(!backend.busy);
    });

    it("cancels the job once it exists", async () => {
      const gate = deferred<Reply>();
      const { client, requests } = router({
        syscc: "0",
        logGate: gate.promise,
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await flush();
      assert.ok(requests.some((request) => request.link.rel === "log"));

      const cancelled = await backend.cancel(accepted);
      assert.ok(cancelled.ok);
      assert.ok(requests.some((request) => request.link.rel === "cancel"));

      gate.resolve(ok({ count: 0, items: [] }));
      const settled = await accepted.done;
      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "cancelled");
    });

    it("reports a failed cancel PUT as backend-failed, distinct from the run's own outcome", async () => {
      // `cancelActive`'s own `stream.cancel()` branch (the job's `cancel` PUT
      // itself failing, rather than the run failing) had no test of its own.
      const gate = deferred<Reply>();
      const { client } = router({
        syscc: "0",
        logGate: gate.promise,
        cancelReply: rejected("compute-rejected", "500 Internal Server Error"),
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await flush();

      const cancelled = await backend.cancel(accepted);
      assert.ok(!cancelled.ok);
      assert.equal(cancelled.problem.code, "backend-failed");

      gate.resolve(ok({ count: 0, items: [] }));
      // The run itself still settles as cancelled — `cancelActive` aborts the
      // controller unconditionally before ever asking `stream.cancel()` to
      // confirm anything, so the failed PUT above changes `cancel()`'s own
      // result and not `done`'s.
      const settled = await accepted.done;
      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "cancelled");
    });

    it("cancels a run even after the job is already terminal, before the outcome is read", async () => {
      // `LogStream.cancel` is a documented no-op once the job is observed
      // terminal, which happens before the trailing drain and well before
      // `SYSCC` is read. A `cancel()` landing in that window must still make
      // `done` resolve as cancelled rather than as a real outcome — the gap
      // an adversarial review of this slice found and this test pins.
      const gate = deferred<Reply>();
      const { client, requests } = router({
        syscc: "0",
        variablesGate: gate.promise,
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await flush();
      assert.ok(requests.some((request) => request.link.rel === "variables"));
      // The job is already terminal and its log fully drained, so
      // `stream.cancel()` alone would be a no-op here.
      assert.ok(!requests.some((request) => request.link.rel === "cancel"));

      const cancelled = await backend.cancel(accepted);
      assert.ok(cancelled.ok);

      gate.resolve(ok({ count: 1, items: [{ name: "SYSCC", value: "0" }] }));
      const settled = await accepted.done;
      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "cancelled");
    });

    it("cancels a run even after SYSCC confirms failure, before SYSERRORTEXT is read", async () => {
      // The `isCurrentRunAborted()` check right after the `SYSCC` read closes
      // the cancel-race window for a *successful* run, but a failing run goes
      // on to read `SYSERRORTEXT` before returning — an asymmetric second
      // window an adversarial review of this slice found, since only the
      // success path had been guarded. This pins the fix: the check is
      // repeated after that second read too.
      const gate = deferred<Reply>();
      const { client, requests } = router({
        syscc: "1012",
        syserrortextGate: gate.promise,
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await flush();
      assert.ok(
        requests.some(
          (request) =>
            request.link.rel === "variables" &&
            variableName(request.link.href) === "SYSERRORTEXT",
        ),
      );

      const cancelled = await backend.cancel(accepted);
      assert.ok(cancelled.ok);

      gate.resolve(
        ok({ count: 1, items: [{ name: "SYSERRORTEXT", value: "boom" }] }),
      );
      const settled = await accepted.done;
      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "cancelled");
    });

    it("succeeds and does nothing for a run that already settled", async () => {
      const { client } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await accepted.done;

      const cancelled = await backend.cancel(accepted);
      assert.ok(cancelled.ok);
    });

    it("closes cleanly when nothing is in flight", async () => {
      // Every other close() test here has an execute() or reset() run
      // active at the moment of the call, so `this.active !== undefined`'s
      // false arm — close() called with nothing running, the ordinary case
      // of tearing down an idle backend — had never been exercised.
      const { client } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();

      await backend.close();

      const result = await backend.execute(fakeProgram(), {
        freshNamespace: false,
      });
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "not-connected");
    });

    it("closing cancels what is in flight and disconnects", async () => {
      const gate = deferred<Reply>();
      const { client } = router({ syscc: "0", assignGate: gate.promise });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await flush();

      await backend.close();
      gate.resolve(rejected("compute-unreachable", "aborted"));
      const settled = await accepted.done;
      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "cancelled");

      const reconnected = await backend.execute(fakeProgram(), {
        freshNamespace: false,
      });
      assert.ok(!reconnected.ok);
      assert.equal(reconnected.problem.code, "not-connected");
    });

    it("reports a failed cancellation during close() to an injected sink, rather than discarding it", async () => {
      // A Codex review flagged this: close() awaited cancelActive() and then
      // unconditionally threw the result away, even when the job's own
      // `cancel` PUT itself failed. `ExecutionBackend.close()`'s own doc
      // comment already promises this case is "logged, not returned" — the
      // sink is what actually makes that true.
      const gate = deferred<Reply>();
      const { client } = router({
        syscc: "0",
        logGate: gate.promise,
        cancelReply: rejected("compute-rejected", "500 Internal Server Error"),
      });
      const reasons: string[] = [];
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
        (reason) => reasons.push(reason),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await flush();

      await backend.close();
      gate.resolve(ok({ count: 0, items: [] }));
      await accepted.done;

      assert.equal(reasons.length, 1);
      assert.ok(reasons[0]?.includes("cancelling the run"));
    });

    it("still resolves close() without a sink, the same failure just discarded as before", async () => {
      // No behaviour change for every existing construction of this class,
      // which passes no fifth argument at all.
      const gate = deferred<Reply>();
      const { client } = router({
        syscc: "0",
        logGate: gate.promise,
        cancelReply: rejected("compute-rejected", "500 Internal Server Error"),
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await flush();

      await backend.close();
      gate.resolve(ok({ count: 0, items: [] }));
      await accepted.done;

      const reconnected = await backend.execute(fakeProgram(), {
        freshNamespace: false,
      });
      assert.ok(!reconnected.ok);
      assert.equal(reconnected.problem.code, "not-connected");
    });
  });

  describe("failures translated from the compute layer", () => {
    it("reports a session with no SYSCC variable as backend-failed", async () => {
      // Finding 37 says every session carries SYSCC; `readVariable` still
      // reports `undefined` rather than assuming that, per its own doc
      // comment, and this pins what `runProgram` does with that surprise
      // instead of leaving the branch untested.
      const { client } = router({ syscc: "0", sysccMissing: true });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const settled = await accepted.done;

      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "backend-failed");
      // `assert.equal` above already narrows `settled.problem` to the
      // `backend-failed` variant, so `detail` is reachable without
      // re-checking `code`.
      assert.ok(settled.problem.detail.includes(`"SYSCC"`));
    });

    it("reports a failed upload as transfer-failed, and never submits a job", async () => {
      const { client, requests } = router({
        syscc: "0",
        assignReply: rejected("compute-rejected", "428 Precondition Required"),
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      // `execute()` itself still resolves accepted — it settles as soon as
      // the run is accepted, before the upload even starts — so the transfer
      // failure surfaces on `done`, not on this call's own result.
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const result = await accepted.done;

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "transfer-failed");
      assert.ok(!requests.some((request) => request.link.rel === "execute"));
    });

    it("reports a failed ETag re-read as transfer-failed, and never uploads or submits", async () => {
      // `assignReply` above only exercises the `assign` POST failing;
      // `writeFilerefContent`'s own `self` GET (the fresh-ETag re-read) is a
      // second, distinct failure path that had no test of its own.
      const { client, requests } = router({
        syscc: "0",
        selfReply: rejected("compute-rejected", "404 Not Found"),
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const result = await accepted.done;

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "transfer-failed");
      assert.ok(!requests.some((request) => request.link.rel === "upload"));
      assert.ok(!requests.some((request) => request.link.rel === "execute"));
    });

    it("reports a failed content upload as transfer-failed, and never submits a job", async () => {
      // The `upload` PUT itself failing (finding 36's `428 Precondition
      // Required` shape) — distinct from both the `assign` and `self`
      // failures above, and also untested until now.
      const { client, requests } = router({
        syscc: "0",
        uploadReply: rejected("compute-rejected", "428 Precondition Required"),
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const result = await accepted.done;

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "transfer-failed");
      assert.ok(!requests.some((request) => request.link.rel === "execute"));
    });

    it("reports a session gone during the upload as backend-gone, not transfer-failed", async () => {
      // Phase 3's 3f slice, 2026-08-28: `translate()` used to pick
      // `transfer-failed` unconditionally for the upload stage, even when
      // the underlying `ComputeFailure` was already `session-gone` — the
      // exact shape a dead or reaped session produces on the very first
      // request of a run, since `fileref.ts` maps every one of its own
      // failures through `asSessionGone`. Mirrors "reports a session gone
      // while submitting as backend-gone" below, but for the transfer stage.
      const { client } = router({
        syscc: "0",
        assignReply: {
          ok: false,
          reason: "the compute session is no longer available",
          problem: { code: "session-gone", error: { status: 404 } },
        },
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const result = await accepted.done;

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "backend-gone");
    });

    it("reports compute-unreachable while submitting as backend-gone too", async () => {
      // The existing "session gone" test below exercises one of the two
      // conditions `translate()`'s own doc comment names as recoverable
      // (`session-gone`); `compute-unreachable` is the other, and was never
      // separately exercised.
      const { client } = router({
        syscc: "0",
        executeReply: {
          ok: false,
          reason: "the compute service could not be reached",
          problem: { code: "compute-unreachable", detail: "aborted" },
        },
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const settled = await accepted.done;

      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "backend-gone");
    });

    it("reports a session gone while submitting as backend-gone", async () => {
      const { client } = router({
        syscc: "0",
        executeReply: {
          ok: false,
          reason: "the compute session is no longer available",
          problem: { code: "session-gone", error: { status: 404 } },
        },
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const settled = await accepted.done;

      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "backend-gone");
    });

    it("reports an otherwise-rejected submission as backend-failed", async () => {
      const { client } = router({
        syscc: "0",
        executeReply: rejected("compute-rejected", "500 Internal Server Error"),
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const settled = await accepted.done;

      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "backend-failed");
    });
  });

  describe("fileref allocation across a reattached session (Finding 72)", () => {
    const assignNames = (requests: readonly ComputeRequest[]): string[] =>
      requests
        .filter((request) => request.link.rel === "assign")
        .map((request) => (request.body as { name: string }).name);

    it("seeds the counter past the PYnnnnnn filerefs the session already holds", async () => {
      const { client, requests } = router({
        syscc: "0",
        filerefList: ["PY000001", "PY000002", "PY000005"],
      });
      const backend = new ProcPythonBackend(
        client,
        sessionWithFilerefList(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const settled = await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;

      assert.ok(settled.ok);
      // The `files` GET happens before the first `assign`, and the first name
      // tried is one past the highest held — not `PY000001`.
      const order = requests.map((request) => request.link.rel);
      assert.ok(order.indexOf("files") < order.indexOf("assign"));
      assert.deepEqual(assignNames(requests), ["PY000006"]);
    });

    it("reads the collection once, not before every run", async () => {
      const { client, requests } = router({
        syscc: "0",
        filerefList: ["PY000004"],
      });
      const backend = new ProcPythonBackend(
        client,
        sessionWithFilerefList(),
        dialect(),
        guard(),
      );
      await backend.connect();
      await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;
      await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;

      assert.equal(
        requests.filter((request) => request.link.rel === "files").length,
        1,
      );
      assert.deepEqual(assignNames(requests), ["PY000005", "PY000006"]);
    });

    it("ignores collection entries that are not PY + six digits", async () => {
      const { client, requests } = router({
        syscc: "0",
        filerefList: ["scratch", "PY000003", "PYABCDEF", "PY0003", "PY0000012"],
      });
      const backend = new ProcPythonBackend(
        client,
        sessionWithFilerefList(),
        dialect(),
        guard(),
      );
      await backend.connect();
      await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;

      assert.deepEqual(assignNames(requests), ["PY000004"]);
    });

    it("does not fail the run when the collection listing fails", async () => {
      const { client, requests } = router({
        syscc: "0",
        filerefListReply: rejected(
          "compute-rejected",
          "500 Internal Server Error",
        ),
      });
      const backend = new ProcPythonBackend(
        client,
        sessionWithFilerefList(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const settled = await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;

      assert.ok(settled.ok);
      // Counter untouched, so the bounded retry is the only thing standing
      // between this and a collision — here nothing is actually held, so the
      // first name works.
      assert.deepEqual(assignNames(requests), ["PY000001"]);
    });

    it("retries the listing on the next run after a transient failure, rather than disabling the seed", async () => {
      // A failed `files` GET must not stick the backend on the 16-attempt
      // retry for the rest of the connection — that cannot walk past a
      // reattached session holding more than 16 `PYnnnnnn` names. The flag is
      // only set once a listing actually comes back.
      const { client, requests } = router({
        syscc: "0",
        filerefListFailFirst: 1,
        filerefList: ["PY000001", "PY000002", "PY000005"],
      });
      const backend = new ProcPythonBackend(
        client,
        sessionWithFilerefList(),
        dialect(),
        guard(),
      );
      await backend.connect();

      // First run: the listing 500s, so the counter stays at zero.
      const first = await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;
      assert.ok(first.ok);

      // Second run: the listing is retried, succeeds, and seeds past the
      // highest held name — so this run's fileref jumps to PY000006 rather
      // than continuing from PY000002.
      const second = await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;
      assert.ok(second.ok);

      assert.equal(
        requests.filter((request) => request.link.rel === "files").length,
        2,
        "the listing was not retried after its first failure",
      );
      assert.deepEqual(assignNames(requests), ["PY000001", "PY000006"]);
    });

    it("retries a name collision under the next name", async () => {
      const { client, requests } = router({ syscc: "0", assignConflicts: 2 });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const settled = await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;

      assert.ok(settled.ok);
      assert.deepEqual(assignNames(requests), [
        "PY000001",
        "PY000002",
        "PY000003",
      ]);
    });

    it("gives up after the attempt budget, reported as transfer-failed", async () => {
      const { client, requests } = router({ syscc: "0", assignConflicts: 999 });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const settled = await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;

      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "transfer-failed");
      assert.equal(assignNames(requests).length, 16);
    });

    it("does not retry a non-4xx assign failure", async () => {
      const { client, requests } = router({
        syscc: "0",
        assignReply: rejected("compute-rejected", "500 Internal Server Error"),
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const settled = await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;

      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "transfer-failed");
      assert.equal(assignNames(requests).length, 1);
    });

    it("does not retry a session that is gone, and reports it as such", async () => {
      const { client, requests } = router({
        syscc: "0",
        assignReply: rejected("compute-rejected", "no such session", 404),
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const settled = await accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      ).done;

      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "backend-gone");
      assert.equal(assignNames(requests).length, 1);
    });
  });

  describe("reset", () => {
    it("restarts the interpreter without submitting Python", async () => {
      const { client, requests } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const result = await backend.reset();

      assert.ok(result.ok);
      const submitted = requests.find(
        (request) => request.link.rel === "execute",
      );
      const code = (submitted?.body as { code: string[] }).code;
      // ADR-0014 amendment, finding 70: `reset()`'s own step needs the same
      // trailing `run;` `runProgram`'s does, for the same reason.
      assert.deepEqual(code, ["proc python restart;", "run;"]);
    });

    it("refuses while an execute() run is in flight, naming it", async () => {
      // `reset()`'s own `busy` check reads `this.active?.id ?? "a run in
      // another window"`, the same fallback `execute()`'s naming does — but
      // every existing reset()-vs-guard test left `this.active` undefined
      // (the guard alone was busy). This is the other half: a run already in
      // flight on *this* instance, so `this.active` really is defined and its
      // id is what should be named.
      const { client } = router({
        syscc: "0",
        logGate: deferred<Reply>().promise,
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const running = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );

      const result = await backend.reset();
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "busy");
      assert.equal(result.problem.running, running.id);
    });

    it("reports a failed restart via SYSCC, not just a terminal job", async () => {
      // A Codex review flagged this as a real gap: reset() previously
      // trusted the job's own terminal state and never read SYSCC, so a
      // restart that itself failed (a missing PROC PYTHON license, or any
      // SAS-side error during `proc python restart;`) was reported as
      // success — exactly the trap ADR-0014/finding 33 already closed for
      // execute(), left open here.
      const { client } = router({
        syscc: "3000",
        syserrortext:
          "180-322: Statement is not valid or it is used out of proper order.",
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const result = await backend.reset();

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "backend-failed");
      assert.equal(
        result.problem.detail,
        "180-322: Statement is not valid or it is used out of proper order.",
      );
    });

    it("falls back to a plain message when a failed restart's SYSERRORTEXT is empty", async () => {
      const { client } = router({ syscc: "3000" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const result = await backend.reset();

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "backend-failed");
      assert.equal(
        result.problem.detail,
        "SAS reported an error while restarting the interpreter (SYSCC=3000)",
      );
    });

    it("is stopped by close(), the same as an execute() run", async () => {
      // reset() has no ExecutionHandle and no entry in `this.active`, so
      // close() cannot find it through the same path cancel() uses — an
      // adversarial review of this slice found close() silently leaving an
      // in-flight reset() to run to completion unattended. This pins the fix:
      // close() also aborts reset()'s own controller.
      const gate = deferred<Reply>();
      const { client } = router({ syscc: "0", executeGate: gate.promise });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();

      const resetting = backend.reset();
      await flush();
      await backend.close();
      gate.resolve(rejected("compute-unreachable", "aborted"));

      const result = await resetting;
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "cancelled");
    });

    it("reads its own stream's natural cancelled outcome, not just an aborted createJob", async () => {
      // The test above closes while `createJob` itself is still in flight, so
      // `reset()` returns via `translate()`'s own `isCurrentRunAborted()`
      // check and never reaches `ended.value.outcome === "cancelled"` at all.
      // Aborting *after* the job exists and its log stream is polling reaches
      // that second, distinct branch instead: `streamJobLog`'s pump notices
      // the caller's signal abort between reads and settles `done` with
      // `{ outcome: "cancelled" }` on its own, with no explicit
      // `stream.cancel()` call from this backend at all.
      const gate = deferred<Reply>();
      const { client } = router({ syscc: "0", logGate: gate.promise });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();

      const resetting = backend.reset();
      await flush();
      await backend.close();
      gate.resolve(ok({ count: 0, items: [] }));

      const result = await resetting;
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "cancelled");
    });

    it("refuses before connecting, the same as execute", async () => {
      const { client } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      const result = await backend.reset();
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "not-connected");
    });

    it("defers to the shared guard when another window holds the claim", async () => {
      // The execute() analogue of this exists already; reset() shares the
      // same three guard calls but had no test of its own for either the
      // plain isBusy() defer or the race below — both untested until now.
      const { client, requests } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(true),
      );
      await backend.connect();

      const result = await backend.reset();
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "busy");
      assert.equal(requests.length, 0);
    });

    it("refuses via the guard's own race, even though isBusy() reads clear", async () => {
      const { client, requests } = router({ syscc: "0" });
      const raced = racingGuard();
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        raced,
      );
      await backend.connect();

      const result = await backend.reset();
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "busy");
      assert.deepEqual([...raced.calls], ["start"]);
      assert.equal(requests.length, 0);
    });
  });

  describe("rich output capture (ADR-0019)", () => {
    it("captures a new PNG and a new HTML file, in filename order, after the run's text output, and deletes both", async () => {
      const png = readFixtureBytes("rich-output", "tiny.png");
      const html = new TextEncoder().encode("<table></table>");
      const { client, deletedNames } = router({
        syscc: "0",
        logLines: [line("hello")],
        filesAfter: [
          { name: "b_plot.png", size: png.length },
          { name: "a_table.html", size: html.length },
        ],
        fileContent: { "b_plot.png": png, "a_table.html": html },
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(settled.value.succeeded);

      // The run's own text output first, then the two captures — filename
      // order (`a_table.html` before `b_plot.png`), not the order they were
      // written to the fixture list above.
      assert.deepEqual(
        outputs.map((output) => output.mime),
        ["text/plain", "text/html", "image/png"],
      );
      const htmlOutput = outputs.find(
        (output): output is Extract<RichOutput, { mime: "text/html" }> =>
          output.mime === "text/html",
      );
      const pngOutput = outputs.find(
        (output): output is Extract<RichOutput, { mime: "image/png" }> =>
          output.mime === "image/png",
      );
      assert.ok(htmlOutput !== undefined, "no text/html output was captured");
      assert.ok(pngOutput !== undefined, "no image/png output was captured");
      assert.equal(htmlOutput.data, "<table></table>");
      assert.deepEqual(Buffer.from(pngOutput.data, "base64"), Buffer.from(png));

      // Every captured file is deleted afterward (ADR-0019 point 9).
      assert.deepEqual([...deletedNames].sort(), [
        "a_table.html",
        "b_plot.png",
      ]);
    });

    it("skips a candidate over the cap with a text/plain note, and does not delete it", async () => {
      const { client, deletedNames } = router({
        syscc: "0",
        filesAfter: [{ name: "huge.png", size: 10 * 1024 * 1024 + 1 }],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(settled.value.succeeded);
      assert.ok(!outputs.some((output) => output.mime === "image/png"));
      const note = texts(outputs).find((text) => text.includes("huge.png"));
      assert.ok(note !== undefined, "no skip note was produced");
      assert.equal(deletedNames.length, 0);
    });

    it("skips a candidate that fails to fetch with a text/plain note, and does not delete it", async () => {
      const { client, deletedNames } = router({
        syscc: "0",
        filesAfter: [{ name: "unreadable.png", size: 100 }],
        fileContentReply: {
          "unreadable.png": rejected("compute-rejected", "404 Not Found", 404),
        },
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(settled.value.succeeded);
      assert.ok(!outputs.some((output) => output.mime === "image/png"));
      const note = texts(outputs).find((text) =>
        text.includes("unreadable.png"),
      );
      assert.ok(note !== undefined, "no skip note was produced");
      assert.equal(deletedNames.length, 0);
    });

    it("captures nothing at all on a cancelled run", async () => {
      // ADR-0019: capture never runs for a cancelled run. A candidate is
      // configured here specifically so the assertion is meaningful — if
      // `captureRichOutput` ran anyway, this would have something to find.
      const gate = deferred<Reply>();
      const { client, requests, deletedNames } = router({
        syscc: "0",
        logGate: gate.promise,
        filesAfter: [{ name: "plot.png", size: 100 }],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await flush();

      const cancelled = await backend.cancel(accepted);
      assert.ok(cancelled.ok);

      gate.resolve(ok({ count: 0, items: [] }));
      const settled = await accepted.done;

      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "cancelled");
      // Exactly one `getDirectoryMembers` call — the pre-job listing. A
      // second (the post-job listing `captureRichOutput` would have made)
      // never happens, and neither does any per-file request.
      const rels = requests.map((request) => request.link.rel);
      assert.equal(
        rels.filter((rel) => rel === "getDirectoryMembers").length,
        1,
      );
      assert.ok(!rels.includes("getFile"));
      assert.ok(!rels.includes("deleteFile"));
      assert.equal(deletedNames.length, 0);
    });

    it("resolves as cancelled, not successful, when cancel lands mid-capture", async () => {
      // A race `readSyscc`'s own two checks do not cover: `SYSCC` has already
      // been read (unhindered here — this is not that gate), the outcome is
      // already built, and the run is now in `captureRichOutput`'s own extra
      // network calls when cancel() arrives. `runProgram`'s check right after
      // `captureRichOutput` is what this test is for; without it, `done`
      // would resolve with the genuine (successful) outcome below instead.
      const gate = deferred<Reply>();
      const { client, requests, deletedNames } = router({
        syscc: "0",
        filesAfter: [{ name: "plot.png", size: 100 }],
        fileContentGate: gate.promise,
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputsPromise = collect(accepted.outputs);
      await flush();

      const cancelled = await backend.cancel(accepted);
      assert.ok(cancelled.ok);

      gate.resolve(ok(null, { rawBody: new Uint8Array([1, 2, 3, 4]) }));
      const outputs = await outputsPromise;
      const settled = await accepted.done;

      // The outcome flips to `cancelled` even though the fetch and delete
      // below both actually ran and succeeded — `runProgram`'s new check does
      // not, and must not, undo work `captureRichOutput` already did.
      assert.ok(!settled.ok);
      assert.equal(settled.problem.code, "cancelled");
      assert.ok(
        outputs.some((output) => output.mime === "image/png"),
        "the candidate already in flight when cancel() landed should still have been captured",
      );
      const rels = requests.map((request) => request.link.rel);
      assert.ok(rels.includes("getFile"));
      assert.ok(rels.includes("deleteFile"));
      assert.deepEqual([...deletedNames], ["plot.png"]);
    });

    it("logs a background failure and still succeeds when the pre-run listing fails", async () => {
      // `captureRichOutput`'s own "no baseline, so skip the whole step"
      // branch: `filesBefore` is `runProgram`'s pre-job listing, threaded
      // through as an already-settled `ComputeResult` — this fails it
      // outright rather than gating it, since there is no run in flight yet
      // to cancel.
      const reasons: string[] = [];
      const { client, requests } = router({
        syscc: "0",
        directoryMembersCallReply: {
          1: rejected("compute-rejected", "500 Internal Server Error"),
        },
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
        (reason) => reasons.push(reason),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await collect(accepted.outputs);
      const settled = await accepted.done;

      // The run's own outcome is unaffected — this is a capture-step failure,
      // not a program failure (ADR-0019: "the run's own outcome is
      // unaffected").
      assert.ok(settled.ok);
      assert.ok(settled.value.succeeded);
      assert.equal(reasons.length, 1);
      assert.ok(reasons[0]?.includes("before the run"));
      // Exactly one `getDirectoryMembers` call: the failed pre-job listing.
      // `captureRichOutput` never lists again without a baseline to diff.
      const rels = requests.map((request) => request.link.rel);
      assert.equal(
        rels.filter((rel) => rel === "getDirectoryMembers").length,
        1,
      );
    });

    it("logs a background failure and still succeeds when the post-run listing fails", async () => {
      // The sibling branch: the pre-job listing succeeded, but the listing
      // `captureRichOutput` itself makes after the job settles fails.
      const reasons: string[] = [];
      const { client } = router({
        syscc: "0",
        directoryMembersCallReply: {
          2: rejected("compute-rejected", "500 Internal Server Error"),
        },
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
        (reason) => reasons.push(reason),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(settled.value.succeeded);
      assert.equal(reasons.length, 1);
      assert.ok(reasons[0]?.includes("after the run"));
    });

    it("logs a background failure, but still reports the output, when deleting a captured file fails", async () => {
      // ADR-0019 point 9: "a failed deletion is logged, not surfaced or
      // retried" — a leaked file is a much smaller problem than failing an
      // otherwise-successful run over its own cleanup step.
      const reasons: string[] = [];
      const { client, deletedNames } = router({
        syscc: "0",
        filesAfter: [{ name: "plot.png", size: 100 }],
        deleteFails: ["plot.png"],
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
        (reason) => reasons.push(reason),
      );
      await backend.connect();
      const accepted = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );
      const outputs = await collect(accepted.outputs);
      const settled = await accepted.done;

      assert.ok(settled.ok);
      assert.ok(settled.value.succeeded);
      assert.ok(outputs.some((output) => output.mime === "image/png"));
      assert.equal(reasons.length, 1);
      assert.ok(reasons[0]?.includes("plot.png"));
      // The router's own rejection means `deleteFile` was answered, not
      // skipped — `deletedNames` only records a *successful* delete.
      assert.equal(deletedNames.length, 0);
    });
  });

  describe("probeRuntime", () => {
    /** The router's `getDirectoryMembers` numbers its calls; `probeRuntime`
     * lists the directory exactly once (unlike `execute()`'s before/after
     * pair), so that one call is the router's "call 1" and the fixture
     * belongs in `filesBefore` regardless of when the probe actually wrote
     * the file in wall-clock terms. */
    function probeFileListing(
      bytes: Uint8Array,
    ): NonNullable<RouterOptions["filesBefore"]> {
      return [{ name: ENVIRONMENT_PROBE_FILENAME, size: bytes.length }];
    }

    it("refuses before connect()", async () => {
      const { client } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      const result = await backend.probeRuntime();
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "not-connected");
    });

    it("refuses while an execute() run is in flight, naming it", async () => {
      const { client } = router({
        syscc: "0",
        logGate: deferred<Reply>().promise,
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const running = accept(
        await backend.execute(fakeProgram(), { freshNamespace: false }),
      );

      const result = await backend.probeRuntime();
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "busy");
      assert.equal(result.problem.running, running.id);
    });

    it("submits the probe's own fixed statements plus a trailing run;", async () => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12.0",
          executable: "/usr/bin/python3",
          packages: [["numpy", "2.0.0"]],
        }),
      );
      const { client, requests } = router({
        syscc: "0",
        filesBefore: probeFileListing(bytes),
        fileContent: { [ENVIRONMENT_PROBE_FILENAME]: bytes },
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      await backend.probeRuntime();

      const submitted = requests.find(
        (request) => request.link.rel === "execute",
      );
      const code = (submitted?.body as { code: string[] }).code;
      assert.deepEqual(code, [...environmentProbeStatements(), "run;"]);
    });

    it("parses a successful probe, updates capabilities(), and deletes its own file", async () => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          version: "3.12.0 (test)",
          executable: "/opt/py/bin/python3",
          packages: [
            ["numpy", "2.0.0"],
            ["pandas", "3.0.0"],
          ],
        }),
      );
      const { client, deletedNames } = router({
        syscc: "0",
        filesBefore: probeFileListing(bytes),
        fileContent: { [ENVIRONMENT_PROBE_FILENAME]: bytes },
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const result = await backend.probeRuntime();

      assert.ok(result.ok);
      assert.deepEqual(result.value, {
        kind: "available",
        version: "3.12.0 (test)",
        executable: "/opt/py/bin/python3",
        packages: [
          { name: "numpy", version: "2.0.0" },
          { name: "pandas", version: "3.0.0" },
        ],
      });
      assert.deepEqual(backend.capabilities().runtime, result.value);
      assert.deepEqual(deletedNames, [ENVIRONMENT_PROBE_FILENAME]);
    });

    it("reports runtime-unavailable when the probe's own script fails (non-zero SYSCC)", async () => {
      const { client } = router({
        syscc: "3000",
        syserrortext: "PROC PYTHON is not licensed on this deployment.",
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const result = await backend.probeRuntime();

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "runtime-unavailable");
      assert.equal(
        result.problem.detail,
        "PROC PYTHON is not licensed on this deployment.",
      );
      // A failed probe must not overwrite a prior "unprobed" cache with
      // anything that looks like an answer.
      assert.deepEqual(backend.capabilities().runtime, { kind: "unprobed" });
    });

    it("falls back to a plain message when a failed probe's SYSERRORTEXT is empty", async () => {
      const { client } = router({ syscc: "3000" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const result = await backend.probeRuntime();

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "runtime-unavailable");
      assert.equal(
        result.problem.detail,
        "SAS reported an error while probing the Python runtime (SYSCC=3000)",
      );
    });

    it("reports backend-failed when SYSCC succeeds but the probe's own file is missing", async () => {
      const { client } = router({ syscc: "0" });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const result = await backend.probeRuntime();

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "backend-failed");
      assert.ok(result.problem.detail.includes(ENVIRONMENT_PROBE_FILENAME));
    });

    it("reports backend-failed when the probe's own file does not parse", async () => {
      const bytes = new TextEncoder().encode("not json");
      const { client } = router({
        syscc: "0",
        filesBefore: probeFileListing(bytes),
        fileContent: { [ENVIRONMENT_PROBE_FILENAME]: bytes },
      });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();
      const result = await backend.probeRuntime();

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "backend-failed");
    });

    it("is stopped by close(), the same as an execute() run and a reset()", async () => {
      // Same proven shape as `reset()`'s own "is stopped by close()" case
      // just above: gate `createJob` itself, close while it is still in
      // flight, then resolve the gate — `translate()`'s own
      // `isCurrentRunAborted()` check reports `cancelled` regardless of what
      // the gate resolves with, because the controller was already aborted.
      const gate = deferred<Reply>();
      const { client } = router({ syscc: "0", executeGate: gate.promise });
      const backend = new ProcPythonBackend(
        client,
        session(),
        dialect(),
        guard(),
      );
      await backend.connect();

      const probing = backend.probeRuntime();
      await flush();
      await backend.close();
      gate.resolve(rejected("compute-unreachable", "aborted"));

      const result = await probing;
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "cancelled");
    });
  });
});
