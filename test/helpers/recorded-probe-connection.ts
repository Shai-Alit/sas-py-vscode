// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A `ComputeConnection`-shaped fixture whose simulated wire answers a
 * successful `probeRuntime()` call end to end — the one call sequence
 * `recorded-connection.ts`'s own doc comment says its shared double cannot
 * produce (its simulated `getDirectoryMembers` always answers empty, so a
 * probe run through it settles on `SYSCC` and then fails to find its own
 * output file).
 *
 * Adversarial review, `feat/phase-10b-pylance-stub-reflection`: 10b's own
 * `commands.ts` wiring (`syncStubsForFreshProbe`, the `reloadAdvisable`
 * threading into `showEnvironmentImpl`/`searchEnvironmentImpl`) has a real
 * injection seam (`RunCommandDeps.pylanceStubs`) built specifically so a
 * test can reach it, but reaching it at all needs `ensureProbedEnvironment`'s
 * fresh-probe branch to actually succeed — which needs a real
 * `backendFor()` → `new ProcPythonBackend(...)` construction (no injectable
 * factory) to run against a `ComputeClient` that answers the probe's exact
 * call sequence. `proc-python-backend.test.ts`'s own `router()` already does
 * this, but it is private to that file and much larger than a probe alone
 * needs (execute/reset/cancel/rich-output, fileref allocation, and a dozen
 * failure-injection options this module has no use for). This is that
 * fixture, trimmed to the one call sequence `probeRuntime()` makes on
 * success: `execute` → `log` → `state` → `variables` (`SYSCC`) →
 * `getFiles` → `getDirectoryMembers` → `getFileProperties` (a fresh `ETag`
 * before delete, per `files.ts`'s own `deleteSessionFile`) → `getFile` →
 * `deleteFile`.
 *
 * Reuses `recorded-proc-python.ts`'s exported `session()`/`dialect()` — the
 * same session shape (`execute`/`variables`/`getFiles` links)
 * `recorded-connection.ts` itself builds from — rather than a third,
 * independently-drifting copy of either.
 */

import type {
  ComputeClient,
  ComputeResponse,
  ComputeResult,
} from "../../src/compute/client";
import type { ComputeConnection } from "../../src/compute/sessionManager";
import type { DialectResolution } from "../../src/dialects/resolve";
import { dialect, session } from "./recorded-proc-python";

type Reply = ComputeResult<ComputeResponse>;

function ok(body: unknown, init?: Partial<ComputeResponse>): Promise<Reply> {
  return Promise.resolve({
    ok: true,
    value: {
      status: 200,
      notModified: false,
      contentType: "application/json",
      text: "",
      body,
      ...init,
    },
  });
}

const SESSION_PATH = "/compute/sessions/recorded-proc-python-session";
const JOB_ID = "recorded-probe-job";
const JOB_PATH = `${SESSION_PATH}/jobs/${JOB_ID}`;

/** The file name a `getFile`/`getFileProperties`/`deleteFile` href names —
 * mirrors how `fileLinksFor` below builds those hrefs, the same convention
 * `proc-python-backend.test.ts`'s own private router uses. */
function fileNameFromHref(href: string): string {
  const base = href.endsWith("/content")
    ? href.slice(0, -"/content".length)
    : href;
  return decodeURIComponent(base.split("/").pop() ?? "");
}

function fileLinksFor(name: string): unknown[] {
  const path = `${SESSION_PATH}/files/cwd/${encodeURIComponent(name)}`;
  return [
    {
      rel: "getFileProperties",
      method: "GET",
      href: path,
      type: "application/vnd.sas.compute.file.properties",
    },
    { rel: "getFile", method: "GET", href: `${path}/content` },
    { rel: "deleteFile", method: "DELETE", href: path },
  ];
}

/** The probe's own JSON payload, exactly as `environment.ts`'s Python side
 * writes it. */
export interface RecordedProbePayload {
  readonly version: string;
  readonly executable: string;
  readonly packages: readonly (readonly [string, string, readonly string[]])[];
}

export interface RecordedProbeOptions {
  readonly profileId: string;
  readonly profileName: string;
  readonly payload: RecordedProbePayload;
  /** The name the probe's own output file is listed under — defaults to
   * `ENVIRONMENT_PROBE_FILENAME`. Overridable only so a test can pin the
   * "reported success but left no file behind" failure without this fixture
   * needing its own copy of that constant's value hardcoded as a magic
   * string. */
  readonly probeFileName: string;
}

/**
 * A `ComputeConnection` whose `probeRuntime()` call succeeds with
 * `options.payload`. Every other call type this fixture's `ComputeClient`
 * might see is unscripted and throws — the same "keyed on `rel`, anything
 * else is a test bug" discipline `proc-python-backend.test.ts`'s own
 * `router()` uses.
 */
export function createRecordedProbeConnection(
  options: RecordedProbeOptions,
): ComputeConnection {
  const bytes = new TextEncoder().encode(JSON.stringify(options.payload));

  const client: ComputeClient = {
    send: (request) => {
      switch (request.link.rel) {
        case "execute":
          return ok(
            {
              id: JOB_ID,
              state: "pending",
              links: [
                { rel: "self", method: "GET", href: JOB_PATH },
                { rel: "state", method: "GET", href: `${JOB_PATH}/state` },
                {
                  rel: "log",
                  method: "GET",
                  href: `${JOB_PATH}/log`,
                  type: "application/vnd.sas.collection",
                },
              ],
            },
            { status: 201 },
          );
        case "log":
          return ok(
            {
              count: 0,
              items: [],
              links: [{ rel: "self", method: "GET", href: `${JOB_PATH}/log` }],
            },
            { contentType: "application/vnd.sas.collection+json" },
          );
        case "state":
          return ok(undefined, {
            status: 200,
            contentType: "text/plain",
            text: "completed",
            body: undefined,
          });
        case "variables":
          // Only `SYSCC` is ever read on a successful probe — a failure
          // path would also read `SYSERRORTEXT`, which this fixture has no
          // reason to script since it exists to exercise the success path.
          return ok({ count: 1, items: [{ name: "SYSCC", value: "0" }] });
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
        case "getDirectoryMembers":
          return ok({
            count: 1,
            items: [
              {
                name: options.probeFileName,
                size: bytes.length,
                links: fileLinksFor(options.probeFileName),
              },
            ],
          });
        case "getFileProperties": {
          const name = fileNameFromHref(request.link.href);
          return ok({ name }, { etag: `"etag-${name}"` });
        }
        case "getFile":
          return ok(null, { rawBody: bytes });
        case "deleteFile":
          return ok(undefined, { status: 204 });
        default:
          return Promise.reject(
            new Error(
              `recorded-probe-connection: unscripted request rel: ${request.link.rel}`,
            ),
          );
      }
    },
  };

  const generation: DialectResolution = {
    dialect: dialect(),
    reason: "recorded-probe-connection fixture",
    certain: true,
  };

  return {
    profileId: options.profileId,
    profileName: options.profileName,
    context: "recorded-probe-connection-context",
    client,
    generation,
    session: session(),
  };
}
