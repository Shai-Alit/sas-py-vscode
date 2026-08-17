// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import path from "node:path";

import { loadScript } from "../helpers/load-script";

interface Contract {
  name: string;
  contract: unknown;
}

interface CheckInput {
  contracts: Contract[];
  dialectIds: string[] | undefined;
  factories: string[];
  fixtureDirs: string[];
}

// Property signatures rather than methods, as in coverage-scope.test.ts: these
// are plain functions read off a module namespace.
interface CheckContracts {
  unionMembers: (
    source: string,
    typeName: string,
    fileName?: string,
  ) => string[] | undefined;
  exportedFunctions: (source: string, fileName?: string) => string[];
  check: (input: CheckInput) => string[];
  checkRepository: (root: string) => string[];
}

/**
 * The check that keeps `contracts/` from becoming a folder of stale claims.
 *
 * A contract file is documentation, and the only thing separating documentation
 * that is true from documentation that used to be true is something that fails
 * when it stops. So these tests are about the ways the agreement between a
 * contract, the dialect layer and the fixtures can break — each case below is
 * one of them, stated as the mistake rather than as the code path.
 *
 * The last block runs the check against this repository, so a renamed dialect
 * factory or a generation added to the union without a contract fails here, by
 * name, on three operating systems.
 */
describe("check-contracts", () => {
  let script: CheckContracts;

  before(async () => {
    script = await loadScript<CheckContracts>("check-contracts.mjs");
  });

  describe("unionMembers", () => {
    it("reads a string-literal union", () => {
      assert.deepEqual(
        script.unionMembers('export type Id = "viya4" | "viya35";', "Id"),
        ["viya4", "viya35"],
      );
    });

    it("reads a one-member alias that is not a union at all", () => {
      // The shape this repository had before Viya 3.5 existed, and the shape it
      // returns to if a generation is ever dropped. Treating it as "not a union"
      // would silently report no generations and pass everything.
      assert.deepEqual(script.unionMembers('type Id = "viya4";', "Id"), [
        "viya4",
      ]);
    });

    it("returns undefined when the type is not there", () => {
      // Distinct from finding it empty: one means the source moved, the other
      // means the union grew something unreadable, and the advice differs.
      assert.equal(
        script.unionMembers("export type Other = string;", "Id"),
        undefined,
      );
    });

    it("returns nothing usable when a member is not a string literal", () => {
      assert.deepEqual(
        script.unionMembers('type Id = "viya4" | (string & {});', "Id"),
        [],
      );
    });

    it("ignores a type of the same name in a comment", () => {
      // The parser earns its place here for the same reason it does in
      // check-coverage-scope: this repository's doc comments discuss the types
      // they sit above, and a regex reads the prose as a declaration.
      const source = ['/** type Id = "wrong"; */', 'type Id = "viya4";'].join(
        "\n",
      );
      assert.deepEqual(script.unionMembers(source, "Id"), ["viya4"]);
    });
  });

  describe("exportedFunctions", () => {
    it("takes the exported functions and nothing else", () => {
      const source = [
        "export function createViya4Dialect() {}",
        "function helper() {}",
        "export const notAFunction = 1;",
        "export interface Dialect { id: string }",
      ].join("\n");
      assert.deepEqual(script.exportedFunctions(source), [
        "createViya4Dialect",
      ]);
    });
  });

  describe("check", () => {
    const DIALECTS = ["viya4", "viya35"];
    const FACTORIES = ["createViya4Dialect", "createViya35Dialect"];
    const FIXTURES = ["viya4", "viya35", "harness"];

    /** A contract that passes, which each case below then breaks one way. */
    const good = (
      generation: string,
      extra: Record<string, unknown> = {},
    ): Contract => ({
      name: `contracts/${generation}.yaml`,
      contract: {
        generation,
        dialect: generation === "viya4" ? FACTORIES[0] : FACTORIES[1],
        fixtures: generation,
        reference: "https://developer.sas.com/rest-apis",
        endpoints: [],
        ...extra,
      },
    });

    const run = (contracts: Contract[], dialectIds = DIALECTS): string[] =>
      script.check({
        contracts,
        dialectIds,
        factories: FACTORIES,
        fixtureDirs: FIXTURES,
      });

    const both = (extra: Record<string, unknown> = {}): Contract[] => [
      good("viya4", extra),
      good("viya35"),
    ];

    it("passes a matching set", () => {
      assert.deepEqual(run(both()), []);
    });

    it("refuses an unknown top-level key", () => {
      // Silent otherwise: `fixture` for `fixtures` leaves the fixtures rule
      // with nothing to check and the file still green.
      const problems = run(both({ fixture: "viya4" }));
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? "", /unknown top-level key "fixture"/);
    });

    it("refuses a generation that is not a DialectId", () => {
      const problems = run([good("viya4"), good("viya35"), good("viya5")]);
      // Two: the bad generation, and the file name that now disagrees with it.
      assert.ok(
        problems.some((problem) => problem.includes("not a DialectId")),
      );
    });

    it("refuses an alias where the canonical id belongs", () => {
      // `resolveDialectId` would happily take "v4" from a profile setting. A
      // file written by hand in this repository is held to one spelling.
      const contract = good("viya4");
      (contract.contract as Record<string, unknown>).generation = "v4";
      const problems = run([contract, good("viya35")]);
      assert.ok(
        problems.some((problem) => problem.includes("not a DialectId")),
      );
    });

    it("refuses a file whose name disagrees with its generation", () => {
      const problems = run([
        { name: "contracts/viya-4.yaml", contract: good("viya4").contract },
        good("viya35"),
      ]);
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? "", /but is named "viya-4"/);
    });

    it("catches a dialect factory that no longer exists", () => {
      const problems = run(both({ dialect: "createViya4Client" }));
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? "", /no module under src\/dialects/);
    });

    it("catches a fixture directory that does not exist", () => {
      const problems = run(both({ fixtures: "viya4-payloads" }));
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? "", /does not exist under test\/fixtures/);
    });

    it("catches a generation with no contract at all", () => {
      // Direction 2, and the one nothing else would notice: a generation added
      // to the union simply has no recorded footprint, and the absence looks
      // exactly like a generation that needs none.
      const problems = run(
        [good("viya4"), good("viya35")],
        [...DIALECTS, "viya5"],
      );
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? "", /contracts\/viya5\.yaml/);
      assert.match(problems[0] ?? "", /does not exist/);
    });

    it("reports a missing DialectId union rather than passing everything", () => {
      // Not via `run`: passing `undefined` to a parameter with a default gets
      // the default, so this case has to say what it means directly.
      const problems = script.check({
        contracts: both(),
        dialectIds: undefined,
        factories: FACTORIES,
        fixtureDirs: FIXTURES,
      });
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? "", /declares no DialectId/);
    });

    describe("endpoints", () => {
      const endpoint = (extra: Record<string, unknown>) =>
        both({
          endpoints: [
            {
              id: "cadence_version",
              method: "GET",
              accept: "application/json",
              ...extra,
            },
          ],
        });

      it("accepts a composed path", () => {
        assert.deepEqual(run(endpoint({ path: "/deploymentData" })), []);
      });

      it("refuses both a path and a via", () => {
        // How a link-navigated endpoint acquires a hard-coded path for someone
        // to reach for later, against ADR-0010.
        const problems = run(
          endpoint({
            path: "/deploymentData/cadenceVersion",
            via: {
              from: "cadence_version",
              relation: "cadenceVersion",
              type: "application/vnd.sas.deployment.data.cadence.version",
            },
          }),
        );
        assert.ok(
          problems.some((problem) => problem.includes("declares both")),
        );
      });

      it("refuses neither a path nor a via", () => {
        const problems = run(endpoint({}));
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /declares neither/);
      });

      it("refuses a path that is not root-relative", () => {
        const problems = run(
          endpoint({ path: "https://example.invalid/deploymentData" }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /not root-relative/);
      });

      it("refuses a via followed from an endpoint we never fetch", () => {
        const problems = run(
          endpoint({
            via: {
              from: "deployment_data_root",
              relation: "cadenceVersion",
              type: "application/vnd.sas.deployment.data.cadence.version",
            },
          }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /not an endpoint in this contract/);
      });

      it("refuses a via with no media type", () => {
        // Finding 44: the `cadenceVersion` relation appears twice in the link
        // document, distinguished only by `type`. A `rel`-only lookup works
        // today by luck.
        const problems = run(
          both({
            endpoints: [
              { id: "root", method: "GET", accept: "a/b", path: "/x" },
              {
                id: "leaf",
                method: "GET",
                accept: "a/b",
                via: { from: "root", relation: "cadenceVersion" },
              },
            ],
          }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /"via" with no "type"/);
      });

      it("refuses a duplicated id", () => {
        const one = { id: "same", method: "GET", accept: "a/b", path: "/x" };
        const problems = run(both({ endpoints: [one, { ...one }] }));
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /declared twice/);
      });

      it("requires a method, because the link documents carry none", () => {
        const problems = run(
          both({ endpoints: [{ id: "x", accept: "a/b", path: "/x" }] }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /no "method"/);
      });

      it("requires an accept, because Viya is media-type driven", () => {
        const problems = run(
          both({ endpoints: [{ id: "x", method: "GET", path: "/x" }] }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /no "accept"/);
      });
    });

    describe("absent", () => {
      const present = {
        id: "cadence_version",
        method: "GET",
        accept: "application/json",
        path: "/deploymentData/cadenceVersion",
      };

      const pair = (absent: unknown): Contract[] => [
        good("viya4", { endpoints: [present] }),
        good("viya35", { absent }),
      ];

      it("accepts an absence that names an endpoint another contract has", () => {
        assert.deepEqual(
          run(pair([{ id: "cadence_version", reason: "no cadence in 3.5" }])),
          [],
        );
      });

      it("refuses an absence relative to nothing", () => {
        // The decay mode: the endpoint goes away everywhere, and what is left
        // is a note recording that a generation lacks something nothing has.
        const problems = run(
          pair([{ id: "deployment_data_root", reason: "gone" }]),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /no contract declares it/);
      });

      it("refuses an endpoint that is declared absent from its own contract", () => {
        const problems = run([
          good("viya4", {
            endpoints: [present],
            absent: [{ id: "cadence_version", reason: "contradiction" }],
          }),
          good("viya35"),
        ]);
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /also declares it as an endpoint/);
      });

      it("requires a reason", () => {
        const problems = run(pair([{ id: "cadence_version" }]));
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /no "reason"/);
      });
    });

    /**
     * A contract is YAML somebody typed, so every field can arrive as the wrong
     * kind of thing.
     *
     * These are the arms that fire on a malformed file rather than on an
     * incorrect one, and they are worth stating as cases for the reason the
     * checker has them at all: the alternative to a sentence naming the key is a
     * `TypeError` from three frames further in, on a file the reader is already
     * unsure about. A gate whose failure mode is a stack trace gets read as a
     * broken gate.
     */
    describe("malformed shapes", () => {
      const has = (problems: string[], pattern: RegExp): void => {
        assert.ok(
          problems.some((problem) => pattern.test(problem)),
          `no problem matched ${pattern.source}: ${problems.join(" | ")}`,
        );
      };

      /** A whole contract replaced by something that is not a document. */
      it("refuses a contract that is not a mapping", () => {
        // `endpoints:` alone at the top of a file parses to a list, and an empty
        // file parses to `null`. Both are things a half-written contract is.
        for (const contract of [[], null, "viya4"]) {
          has(
            run([{ name: "contracts/viya4.yaml", contract }, good("viya35")]),
            /is not a YAML mapping/,
          );
        }
      });

      it("names each missing top-level key", () => {
        // Rebuilt without the key rather than `delete`d out of the object: a
        // dynamic delete is banned by lint, and rebuilding says what the case
        // is about — a file somebody wrote without that line — more directly
        // than removing it afterwards does.
        const without = (key: string): string[] => {
          const body = good("viya4").contract as Record<string, unknown>;
          const contract = Object.fromEntries(
            Object.entries(body).filter(([name]) => name !== key),
          );
          return run([
            { name: "contracts/viya4.yaml", contract },
            good("viya35"),
          ]);
        };
        has(without("generation"), /has no "generation"/);
        has(without("dialect"), /has no "dialect"/);
        has(without("fixtures"), /has no "fixtures"/);
        has(without("reference"), /has no "reference"/);
      });

      it("refuses an endpoints that is not a list", () => {
        const problems = run(both({ endpoints: { id: "one" } }));
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /"endpoints" is not a list/);
      });

      it("refuses an endpoint that is not a mapping", () => {
        const problems = run(both({ endpoints: ["cadence_version"] }));
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /endpoint 0 is not a mapping/);
      });

      it("refuses an endpoint with no id, and says why ids matter", () => {
        const problems = run(
          both({ endpoints: [{ method: "GET", accept: "a/b", path: "/x" }] }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /endpoint 0 has no "id"/);
      });

      it("refuses an unknown endpoint key", () => {
        const problems = run(
          both({
            endpoints: [
              {
                id: "x",
                method: "GET",
                accept: "a/b",
                path: "/x",
                query_params: ["start"],
              },
            ],
          }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /unknown key "query_params"/);
      });

      it("refuses a via that is not a mapping", () => {
        const problems = run(
          both({
            endpoints: [
              { id: "x", method: "GET", accept: "a/b", via: "cadenceVersion" },
            ],
          }),
        );
        assert.equal(problems.length, 1);
        assert.match(
          problems[0] ?? "",
          /not a mapping of from\/relation\/type/,
        );
      });

      it("refuses an unknown via key", () => {
        const problems = run(
          both({
            endpoints: [
              { id: "root", method: "GET", accept: "a/b", path: "/x" },
              {
                id: "leaf",
                method: "GET",
                accept: "a/b",
                via: {
                  from: "root",
                  relation: "cadenceVersion",
                  type: "a/b",
                  href: "/x/cadence",
                },
              },
            ],
          }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /unknown "via" key "href"/);
      });

      it("refuses field lists that are not lists", () => {
        const fields = (extra: Record<string, unknown>): string[] =>
          run(
            both({
              endpoints: [
                { id: "x", method: "GET", accept: "a/b", path: "/x", ...extra },
              ],
            }),
          );
        has(fields({ response_fields: "links" }), /"response_fields"/);
        has(fields({ item_fields: "rel" }), /"item_fields"/);
      });

      it("refuses an absent that is not a list", () => {
        const problems = run(both({ absent: { id: "cadence_version" } }));
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /"absent" is not a list/);
      });

      it("refuses an absent entry that is not a mapping", () => {
        const problems = run(both({ absent: ["cadence_version"] }));
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /absent 0 is not a mapping/);
      });

      it("refuses an absent entry with no id", () => {
        const problems = run(both({ absent: [{ reason: "not in 3.5" }] }));
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /absent 0 has no "id"/);
      });

      it("refuses an unknown absent key", () => {
        const problems = run([
          good("viya4", {
            endpoints: [
              {
                id: "cadence_version",
                method: "GET",
                accept: "a/b",
                path: "/x",
              },
            ],
          }),
          good("viya35", {
            absent: [
              {
                id: "cadence_version",
                reason: "no cadence versioning in 3.5",
                since: "3.5",
              },
            ],
          }),
        ]);
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /unknown key "since"/);
      });

      it("reports a DialectId union it cannot enumerate", () => {
        // `unionMembers` returns `[]` for a union with a computed member, which
        // is a different failure from the type having moved and gets different
        // advice: teach this check, rather than go looking for the file.
        const problems = script.check({
          contracts: both(),
          dialectIds: [],
          factories: FACTORIES,
          fixtureDirs: FIXTURES,
        });
        assert.equal(problems.length, 1);
        assert.match(problems[0] ?? "", /not all string literals/);
      });
    });
  });

  describe("this repository", () => {
    it("has contracts that agree with the dialects and the fixtures", () => {
      // `out/test/unit/` → repository root.
      const root = path.resolve(__dirname, "..", "..", "..");
      assert.deepEqual(script.checkRepository(root), []);
    });
  });
});
