// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { loadScript } from "../helpers/load-script";

interface Document {
  file: string;
  content: string;
}

// Declared as a property rather than a method, because that is what it is: a
// plain function pulled off a module namespace, with no `this` to lose.
interface GenerateReference {
  build: (pkg: unknown, nls: unknown) => Document[];
}

/**
 * Only as much of the manifest as the generator reads. Typed loosely on
 * purpose: these fixtures deliberately include shapes `package.json` does not
 * currently have — an empty properties map, a description containing a pipe —
 * and a type that mirrors the real manifest exactly would reject precisely the
 * inputs worth testing.
 */
interface Manifest {
  displayName: string;
  capabilities?: {
    untrustedWorkspaces?: { restrictedConfigurations?: string[] };
  };
  contributes?: {
    commands?: { command: string; title: string; category?: string }[];
    configuration?: {
      title: string;
      properties: Record<string, Record<string, unknown>>;
    };
  };
}

/**
 * The settings and command reference generator.
 *
 * These tests exist because of what the generator's failure looks like: not a
 * crash, but a table that renders and is wrong. A corrupted row, an unresolved
 * `%placeholder%`, a missing trust footnote — every one of them produces a
 * document that looks finished. The `--check` job in CI compares the committed
 * output against the generator, which keeps the two in step but says nothing
 * about whether either is correct.
 */
describe("docs reference generator", () => {
  let build: GenerateReference["build"];

  before(async () => {
    ({ build } = await loadScript<GenerateReference>("generate-reference.mjs"));
  });

  const nls: Record<string, string> = {
    "extension.category": "Python on Viya",
    "command.run.title": "Run File on Viya",
    "configuration.profiles.description": "Named connection profiles.",
  };

  const pkg: Manifest = {
    displayName: "Python on Viya",
    capabilities: {
      untrustedWorkspaces: {
        restrictedConfigurations: ["pythonOnViya.connectionProfiles"],
      },
    },
    contributes: {
      commands: [
        {
          command: "pythonOnViya.run",
          title: "%command.run.title%",
          category: "%extension.category%",
        },
      ],
      configuration: {
        title: "Python on Viya",
        properties: {
          "pythonOnViya.connectionProfiles": {
            type: "object",
            default: {},
            scope: "resource",
            markdownDescription: "%configuration.profiles.description%",
          },
          "pythonOnViya.defaultProfile": {
            type: "string",
            default: "",
            scope: "resource",
            description: "The profile used when none is chosen.",
          },
        },
      },
    },
  };

  function generate(
    overrides: Partial<Manifest> = {},
    table: Record<string, string> = nls,
  ) {
    const documents = build({ ...pkg, ...overrides }, table);
    const byName = new Map(documents.map((d) => [d.file, d.content]));
    return {
      settings: byName.get("settings.md") ?? "",
      commands: byName.get("commands.md") ?? "",
    };
  }

  it("produces exactly the two documents, each carrying the do-not-edit banner", () => {
    const documents = build(pkg, nls);
    assert.deepEqual(
      documents.map((d) => d.file),
      ["settings.md", "commands.md"],
    );
    for (const document of documents) {
      assert.match(
        document.content,
        /GENERATED FILE — DO NOT EDIT/,
        `${document.file} has no banner, so the first person to find a typo will fix it in the wrong place.`,
      );
    }
  });

  it("resolves %placeholders% through package.nls.json", () => {
    const { settings, commands } = generate();
    assert.match(settings, /Named connection profiles\./);
    assert.match(commands, /Run File on Viya/);
    assert.doesNotMatch(
      settings + commands,
      /%[a-z.]+%/i,
      "an unresolved placeholder renders literally in the VS Code UI.",
    );
  });

  it("refuses a placeholder that package.nls.json does not define", () => {
    // The message has to name the key *and* where it was referenced. "a key is
    // missing" sends the reader to diff two JSON files by eye.
    const withoutCommandTitle = { ...nls };
    delete withoutCommandTitle["command.run.title"];
    assert.throws(
      () => generate({}, withoutCommandTitle),
      /contributes\.commands\.pythonOnViya\.run\.title references %command\.run\.title%, which is not in package\.nls\.json/,
      "a missing key must name itself; VS Code would otherwise ship the raw %key% as visible text.",
    );

    const withoutSetting = { ...nls };
    delete withoutSetting["configuration.profiles.description"];
    assert.throws(
      () => generate({}, withoutSetting),
      /configuration\.profiles\.description/,
      "the settings table must fail on a missing key too, not only the commands table.",
    );
  });

  it("marks a trust-restricted setting and explains the dagger", () => {
    const { settings } = generate();
    const restricted = settings
      .split("\n")
      .find((line) => line.includes("pythonOnViya.connectionProfiles"));
    assert.ok(restricted, "the restricted setting is missing from the table.");
    assert.match(restricted, /†/);

    const unrestricted = settings
      .split("\n")
      .find((line) => line.includes("pythonOnViya.defaultProfile"));
    assert.ok(unrestricted);
    assert.doesNotMatch(
      unrestricted,
      /†/,
      "an unrestricted setting marked as restricted is worse than no marking: it teaches the reader to ignore the symbol.",
    );

    assert.match(settings, /Restricted in untrusted workspaces/);
    assert.match(settings, /0002-workspace-trust-posture\.md/);
  });

  it("omits the footnote when nothing is restricted", () => {
    const { settings } = generate({
      capabilities: { untrustedWorkspaces: { restrictedConfigurations: [] } },
    });
    assert.doesNotMatch(settings, /Restricted in untrusted workspaces/);
    assert.doesNotMatch(settings, /†/);
  });

  it("keeps a pipe or a newline in a description inside its own cell", () => {
    // Both silently corrupt a markdown table rather than failing: a pipe ends
    // the cell, a newline ends the row. The generated file still renders, just
    // as a different table than the one intended.
    const { settings } = generate({
      contributes: {
        ...pkg.contributes,
        configuration: {
          title: "Python on Viya",
          properties: {
            "pythonOnViya.hostile": {
              type: "string",
              default: "",
              description: 'Accepts "a" | "b".\nSecond line.',
            },
          },
        },
      },
    });

    const rows = settings
      .split("\n")
      .filter((line) => line.includes("pythonOnViya.hostile"));
    assert.equal(rows.length, 1, "the description broke the row in two.");
    assert.match(rows[0] ?? "", /\\\|/, "the pipe was not escaped.");
    assert.match(rows[0] ?? "", /Second line\./);
  });

  it("escapes a backslash before it escapes a pipe", () => {
    // The CodeQL js/incomplete-sanitization case: escaping `|` -> `\|` without
    // first escaping `\` means a value ending in `\` right before a `|` still
    // breaks the cell (`\` + `\|` renders as an escaped backslash, then a bare
    // pipe). A `\|` in the source must come out as `\\\|` — escaped backslash,
    // then escaped pipe.
    const { settings } = generate({
      contributes: {
        ...pkg.contributes,
        configuration: {
          title: "Python on Viya",
          properties: {
            "pythonOnViya.hostile": {
              type: "string",
              default: "",
              description: "a\\|b",
            },
          },
        },
      },
    });

    const rows = settings
      .split("\n")
      .filter((line) => line.includes("pythonOnViya.hostile"));
    assert.equal(rows.length, 1, "the backslash-pipe broke the row in two.");
    assert.ok(
      (rows[0] ?? "").includes("a\\\\\\|b"),
      "the backslash was not escaped before the pipe.",
    );
  });

  it("renders defaults the way settings.json would be written", () => {
    const { settings } = generate();
    const rows = settings.split("\n");
    const empty = rows.find((line) =>
      line.includes("pythonOnViya.defaultProfile"),
    );
    // `""` and `{}` both stringify to nothing useful without JSON.stringify —
    // an empty cell reads as "no default", which is a different claim.
    assert.match(empty ?? "", /`""`/);
    assert.match(
      rows.find((line) => line.includes("connectionProfiles")) ?? "",
      /`\{\}`/,
    );
  });

  it("writes the palette entry the way the palette shows it", () => {
    const { commands } = generate();
    assert.match(commands, /`Python on Viya: Run File on Viya`/);
    assert.match(commands, /`pythonOnViya\.run`/);
  });

  it("says so plainly when there is nothing to document", () => {
    const { settings, commands } = generate({
      contributes: {
        commands: [],
        configuration: { title: "x", properties: {} },
      },
    });
    assert.match(settings, /No settings are contributed yet/);
    assert.match(commands, /No commands are contributed yet/);
  });
});
