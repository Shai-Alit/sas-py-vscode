// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type ExecutionHandle,
  type RichOutput,
} from "../../src/backend/backend";
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
}

/** A `ComputeClient` that answers every request `ProcPythonBackend` makes,
 * keyed on what the request is for rather than on when it arrives. */
function router(opts: RouterOptions): {
  readonly client: ComputeClient;
  readonly requests: ComputeRequest[];
} {
  let filerefName = "unknown";
  let logCalls = 0;
  let executeCalls = 0;
  let sysccCalls = 0;
  let syserrortextCalls = 0;

  const requests: ComputeRequest[] = [];
  const client: ComputeClient = {
    send: async (request) => {
      requests.push(request);
      switch (request.link.rel) {
        case "assign": {
          if (opts.assignGate !== undefined) return await opts.assignGate;
          if (opts.assignReply !== undefined) return opts.assignReply;
          const body = request.body as { name: string };
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
            return opts.syserrortext === undefined
              ? ok({ count: 0, items: [] })
              : ok({ count: 1, items: [{ name, value: opts.syserrortext }] });
          }
          return ok({ count: 0, items: [] });
        }
        default:
          throw new Error(`unscripted request rel: ${request.link.rel}`);
      }
    },
  };
  return { client, requests };
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
      assert.equal(capabilities.runtime, "unprobed");
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

      // Upload before submission, submission before any log or variable read.
      const order = requests.map((request) => request.link.rel);
      assert.deepEqual(order.slice(0, 3), ["assign", "self", "upload"]);
      assert.equal(order[3], "execute");
      assert.ok(order.includes("variables"));

      // `restart` was not composed in — `freshNamespace: false` was asked for.
      const submitted = requests.find(
        (request) => request.link.rel === "execute",
      );
      const code = (submitted?.body as { code: string[] }).code;
      assert.equal(code.length, 1);
      assert.ok(code[0]?.startsWith("proc python infile="));
      assert.ok(!code[0]?.includes("restart"));
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
  });

  describe("a run that raises", () => {
    it("reports an unhandled Python exception as a structured traceback", async () => {
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
      assert.equal(traceback.data.frames.length, 3);
      assert.deepEqual(traceback.data.frames[2], {
        file: "<string>",
        line: 2,
        name: "<module>",
      });
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
      assert.ok(
        settled.problem.code === "backend-failed" &&
          settled.problem.detail.includes(`"SYSCC"`),
      );
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
      assert.deepEqual(code, ["proc python restart;"]);
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
});
