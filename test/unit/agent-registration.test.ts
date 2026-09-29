// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  agentServerUrl,
  crtQuote,
  headersHelperCommand,
  posixQuote,
  powerShellQuote,
  registrationCommand,
  registrationJson,
  shellKindFor,
} from "../../src/agent/registration";

/**
 * The registration line and its `headersHelper` (ADR-0042). The expected
 * strings are the forms run through an npm-style `claude.cmd` shim on
 * 2026-09-28 ("12o built"): each arrived at the program as the single JSON
 * argument it started as. These tests pin the strings; the manual items pin
 * that a real shell still agrees.
 */

const WIN_FILE =
  "C:\\Users\\A User\\AppData\\Roaming\\Code\\User\\workspaceStorage\\abc\\sean.python-on-viya\\mcp-headers-45123.json";
const POSIX_FILE =
  "/home/a user/.config/Code/User/workspaceStorage/abc/sean.python-on-viya/mcp-headers-45123.json";

describe("agent registration", () => {
  describe("shellKindFor", () => {
    for (const [path, kind] of [
      ["C:\\Windows\\System32\\cmd.exe", "cmd"],
      ["C:\\WINDOWS\\System32\\CMD.EXE", "cmd"],
      [
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "powershell",
      ],
      ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "powershell"],
      ["/usr/local/bin/pwsh", "powershell"],
      ["C:\\Program Files\\Git\\bin\\bash.exe", "posix"],
      ["/bin/zsh", "posix"],
      ["/usr/bin/fish", "posix"],
      ["C:\\Windows\\System32\\wsl.exe", "posix"],
      ["", "posix"],
      ["cmd", "cmd"],
    ] as const) {
      it(`reads ${JSON.stringify(path)} as ${kind}`, () => {
        assert.equal(shellKindFor(path), kind);
      });
    }
  });

  describe("headersHelperCommand", () => {
    it("types the file, double-quoted, on Windows", () => {
      assert.equal(
        headersHelperCommand(WIN_FILE, "win32"),
        `type "${WIN_FILE}"`,
      );
    });

    it("keeps characters that are literal inside cmd's double quotes", () => {
      const path = "C:\\a & b ^ (c) ' ; d\\mcp-headers-1.json";
      assert.equal(headersHelperCommand(path, "win32"), `type "${path}"`);
    });

    for (const character of ["%", "!", '"']) {
      it(`refuses a Windows path containing ${character}`, () => {
        assert.equal(
          headersHelperCommand(`C:\\a${character}b\\f.json`, "win32"),
          undefined,
        );
      });
    }

    it("cats the file, single-quoted, elsewhere", () => {
      assert.equal(
        headersHelperCommand(POSIX_FILE, "other"),
        `cat '${POSIX_FILE}'`,
      );
      assert.equal(
        headersHelperCommand("/it's/$HOME/%x!/f.json", "other"),
        `cat '/it'\\''s/$HOME/%x!/f.json'`,
      );
    });

    for (const character of ["\n", "\r", "\t", "\u0000", "\u001f", "\u007f"]) {
      it(`refuses a control character (${JSON.stringify(character)}) on either platform`, () => {
        assert.equal(
          headersHelperCommand(`/a${character}b`, "other"),
          undefined,
        );
        assert.equal(
          headersHelperCommand(`C:\\a${character}b`, "win32"),
          undefined,
        );
      });
    }
  });

  it("points the URL at 127.0.0.1, never localhost", () => {
    assert.equal(agentServerUrl(45_123), "http://127.0.0.1:45123/mcp");
  });

  it("stores the URL and the helper in the JSON", () => {
    assert.deepEqual(JSON.parse(registrationJson(45_123, 'type "x"')), {
      type: "http",
      url: "http://127.0.0.1:45123/mcp",
      headersHelper: 'type "x"',
    });
  });

  describe("registrationCommand", () => {
    const winHelper = `type "C:\\A B\\h.json"`;
    const winJson = `{"type":"http","url":"http://127.0.0.1:45123/mcp","headersHelper":"type \\"C:\\\\A B\\\\h.json\\""}`;

    it("chains remove and add-json for a POSIX shell", () => {
      const helper = "cat '/a b/h.json'";
      assert.equal(
        registrationCommand(45_123, helper, "posix", "other"),
        "claude mcp remove --scope local python-on-viya 2>/dev/null; " +
          "claude mcp add-json --scope local python-on-viya " +
          `'{"type":"http","url":"http://127.0.0.1:45123/mcp","headersHelper":"cat '\\''/a b/h.json'\\''"}'`,
      );
    });

    it("quotes Git Bash on Windows the POSIX way", () => {
      assert.equal(
        registrationCommand(45_123, winHelper, "posix", "win32"),
        "claude mcp remove --scope local python-on-viya 2>/dev/null; " +
          `claude mcp add-json --scope local python-on-viya '${winJson}'`,
      );
    });

    it("CRT-quotes the JSON for cmd, continuing past a failed remove", () => {
      assert.equal(
        registrationCommand(45_123, winHelper, "cmd", "win32"),
        "claude mcp remove --scope local python-on-viya 2>nul & " +
          "claude mcp add-json --scope local python-on-viya " +
          `"{\\"type\\":\\"http\\",\\"url\\":\\"http://127.0.0.1:45123/mcp\\",\\"headersHelper\\":\\"type \\\\\\"C:\\\\A B\\\\h.json\\\\\\"\\"}"`,
      );
    });

    it("wraps the cmd form in cmd /c for PowerShell on Windows", () => {
      const cmdLine = registrationCommand(45_123, winHelper, "cmd", "win32");
      assert.equal(
        registrationCommand(45_123, winHelper, "powershell", "win32"),
        `cmd /c '${cmdLine}'`,
      );
    });

    it("doubles a single quote inside the PowerShell wrapper", () => {
      const helper = `type "C:\\O'Brien\\h.json"`;
      const line = registrationCommand(1, helper, "powershell", "win32");
      assert.ok(line.startsWith("cmd /c '"));
      assert.ok(line.includes("O''Brien"));
      assert.ok(!/[^']'[^']/.test(line.slice("cmd /c '".length, -1)));
    });

    it("doubles a curly single quote inside the PowerShell wrapper", () => {
      const helper = `type "C:\\O\u2019Brien $(calc)\\h.json"`;
      const line = registrationCommand(1, helper, "powershell", "win32");
      assert.ok(line.includes("O\u2019\u2019Brien $(calc)"));
    });

    it("keeps cmd's metacharacters in a path inside its quoted region", () => {
      const helper = headersHelperCommand("C:\\a & b ^ (c)\\h.json", "win32");
      assert.ok(helper !== undefined);
      const line = registrationCommand(1, helper, "cmd", "win32");
      // The JSON's own keys fall outside cmd's quotes, but they are fixed:
      // the path adds nothing there.
      const plain = registrationCommand(1, 'type "C:\\h.json"', "cmd", "win32");
      assert.equal(outsideCmdQuotes(line), outsideCmdQuotes(plain));
      assert.ok(!/[\^()]/.test(outsideCmdQuotes(line)));
      assert.equal(
        splitCrtArgument(line.slice(line.indexOf(' "{') + 1)),
        registrationJson(1, helper),
      );
    });

    it("single-quotes the JSON for PowerShell elsewhere", () => {
      assert.equal(
        registrationCommand(45_123, "cat '/a/h.json'", "powershell", "other"),
        "claude mcp remove --scope local python-on-viya 2>$null; " +
          "claude mcp add-json --scope local python-on-viya " +
          `'{"type":"http","url":"http://127.0.0.1:45123/mcp","headersHelper":"cat ''/a/h.json''"}'`,
      );
    });
  });

  describe("quoting", () => {
    it("posixQuote closes, escapes and reopens a single quote", () => {
      assert.equal(posixQuote("a'b"), `'a'\\''b'`);
      assert.equal(posixQuote(""), "''");
    });

    it("powerShellQuote doubles every quote PowerShell reads as a single quote", () => {
      assert.equal(powerShellQuote("a'b"), "'a''b'");
      for (const quote of ["\u2018", "\u2019", "\u201a", "\u201b"]) {
        assert.equal(
          powerShellQuote(`O${quote}Brien`),
          `'O${quote}${quote}Brien'`,
        );
      }
    });

    it("crtQuote doubles backslashes only before a quote or at the end", () => {
      assert.equal(crtQuote('a"b'), '"a\\"b"');
      assert.equal(crtQuote('a\\"b'), '"a\\\\\\"b"');
      assert.equal(crtQuote("a\\b"), '"a\\b"');
      assert.equal(crtQuote("a\\"), '"a\\\\"');
      assert.equal(crtQuote(""), '""');
    });

    it("crtQuote round-trips through the Microsoft C runtime's splitting rules", () => {
      for (const value of [
        registrationJson(1, `type "C:\\A B\\h.json"`),
        'x\\\\"y',
        "trailing\\\\",
        "plain",
      ]) {
        assert.equal(splitCrtArgument(crtQuote(value)), value);
      }
    });
  });
});

/**
 * What `cmd.exe` acts on in a line: the characters outside double quotes.
 * It toggles quoting at every `"`, and a backslash does not escape one.
 */
function outsideCmdQuotes(line: string): string {
  let quoted = false;
  let out = "";
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (!quoted) out += character;
  }
  return out;
}

/**
 * One double-quoted argument, split the way `CommandLineToArgvW` and the MSVC
 * runtime do: `2n` backslashes before a quote are `n` backslashes and the
 * quote ends the string, `2n+1` are `n` and a literal quote, and backslashes
 * before anything else are literal. Written from Microsoft's "Parsing C
 * command-line arguments" rules, not from `crtQuote`, so the round trip
 * checks one against the other.
 */
function splitCrtArgument(quoted: string): string {
  assert.ok(quoted.startsWith('"'));
  let out = "";
  let i = 1;
  for (;;) {
    let slashes = 0;
    while (quoted[i] === "\\") {
      slashes++;
      i++;
    }
    const next = quoted[i];
    if (next === '"') {
      out += "\\".repeat(Math.floor(slashes / 2));
      if (slashes % 2 === 1) {
        out += '"';
        i++;
        continue;
      }
      assert.equal(
        i,
        quoted.length - 1,
        "the argument ends at its closing quote",
      );
      return out;
    }
    assert.ok(next !== undefined, "an unterminated argument");
    out += "\\".repeat(slashes) + next;
    i++;
  }
}
