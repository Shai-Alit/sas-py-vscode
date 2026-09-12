# FAQ

Quick answers to the questions that come up before you have hit an actual
error — for those, see [Troubleshooting](troubleshooting.md) instead. Every
answer here links to the page with the full story.

## What this extension is

**Do I need Python installed on my machine?** No. Your code runs inside a
compute session on SAS Viya, against the Python environment your
administrator manages there — not an interpreter on your own machine. See
[the README](https://github.com/Shai-Alit/sas-py-vscode#readme).

**Does this replace the SAS extension for VS Code?** No — install both. That
one authors SAS; this one authors Python. Neither needs the other, and having
both installed changes nothing about how either behaves.

**Can I use it to run Python locally, the ordinary way?** Not through this
extension, on purpose, and that will not change — see [the
README](https://github.com/Shai-Alit/sas-py-vscode#readme)'s "Why not just use
a local Python?" section. On the **Local** run target, this extension steps
out of the way entirely: the run button you already had is Microsoft's
(`ms-python.python`'s), and nothing here wraps it or starts an interpreter of
its own. See [Running Python](running-python.md#before-anything-appears).

**Which Viya versions does this work with?** Viya 4. Viya 3.5 is not
supported at all — not merely unverified, dropped as a target
([ADR-0022](adr/0022-drop-viya-35-support.md)) — and SAS 9 was never in
scope. Within Viya 4, the one thing that differs by release is sign-in setup;
see the next question.

**Does completion, hover, or refactoring come from this extension?** No —
that is [`ms-python.python`](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
and Pylance's job. This extension owns running your code, nothing about
editing it. See [Getting started](getting-started.md).

## Setting up

**Do I need my Viya administrator to do anything before I can sign in?**
Depends on your Viya release. On **2022.11 and later**, no — those
deployments already have a built-in client this extension uses. On earlier
Viya 4 releases, yes: an administrator has to register an OAuth client for
you first. See [Connection profiles](connection-profiles.md).

**I signed in and a code showed up on a web page — is that supposed to
happen?** Yes, on most deployments. The built-in OAuth client is registered
to display a code rather than hand control back to the editor automatically.
Paste that code into the box VS Code shows you; that is the intended route,
not a fallback. See [Signing in](signing-in.md#oauth-clients-and-the-secret-prompt).

**Why don't I see my files anywhere?** Two different things live in two
different places. Files you create or open through **File > Open Folder** are
on your own disk, exactly like any other VS Code workspace. Your files *on
Viya* — the ones SAS Studio shows you — are in the **SAS Content** view in
the activity bar, not in the file explorer; see [Browsing SAS
Content](browsing-sas-content.md). If that view looks empty, you likely just
have not [connected](connecting.md) yet.

## Running code

**Do I have to click something to run my code, or does it run automatically
on save?** You run it explicitly — **Python on Viya: Run File** or **Run
Selection**, from the play button, the right-click menu, or the Command
Palette. Nothing runs on save, and nothing runs in the background. See
[Running Python](running-python.md).

**What happens to my variables when I close VS Code?** They usually survive.
Your Python state lives in the Viya compute session, not in the editor, and
reopening the same folder reattaches to that same session rather than
starting a fresh one. What does end it: about fifteen minutes of the session
sitting idle (Viya's own timeout), or running **Disconnect**. See
[Connecting to Viya](connecting.md#sessions-end-on-their-own).

**Can I install a package I need?** Not from the extension, and that is
deliberate — the Python environment is your administrator's to manage, the
same as any other shared Viya resource. Run **Python on Viya: Show
Environment** to see exactly what is already there before assuming you need
something new. See [The Python environment](python-environment.md).

**Why does my output show a `Python 3.x …` banner and stray `>>>` lines?**
`PROC PYTHON` — the SAS mechanism this extension runs your code through —
prints those itself; the extension deliberately does not strip them, because
a program that legitimately prints `>>>` must not have it removed. Harmless.
See [Running Python](running-python.md#known-rough-edges).

## Data and libraries

**Can my Python code read and write SAS data directly?** Yes —
`SAS.sd2df("libref.table")` and `SAS.df2sd(df, "libref.table")` read and
write any library your session can see, including one behind a SAS/ACCESS
engine, with no local database driver and no second credential. See [Python
and SAS libraries](data-access.md).

**Is there a way to look at a table without writing any code?** Yes — the
**SAS Libraries** view in the activity bar opens any table in a scrollable,
sortable, filterable grid, and can export one to CSV, all without a line of
Python. See [Browsing SAS libraries](browsing-sas-libraries.md).

**Is any of this sent anywhere besides my Viya deployment?** No. There is no
telemetry, and no setting to turn it off, because there is nothing collected
to turn off. See [the README](https://github.com/Shai-Alit/sas-py-vscode#readme).
