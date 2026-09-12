# Getting started

The short path from a fresh VS Code install to a Python file running on SAS
Viya. Each step links to the page that covers it in full — this one is just
the order to do them in.

## What you need

- VS Code.
- A SAS Viya 4 deployment, and an account on it you can sign in with.
- A browser, for the OAuth sign-in page Viya shows you.

You do not need Python installed anywhere on your own machine. Your code runs
inside a compute session on Viya, against the Python environment your
administrator manages there.

## 1. Install the extension

Search for **Python on Viya** in the Extensions view (`Ctrl`/`Cmd`+`Shift`+`X`),
or install it directly from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=shai-alit.python-on-viya)
or [Open VSX](https://open-vsx.org/extension/shai-alit/python-on-viya) if
you are on a VS Code-compatible editor that uses that registry instead.

## 2. Install the Python extension too (recommended, not required)

This extension owns *running* your code; it does not do completion, hovers, or
refactoring. For that, install
[`ms-python.python`](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
(and Pylance, which it pulls in). Skip this step if you only want to run
code you already have — VS Code's own syntax highlighting is enough for
everything in this guide.

## 3. Open a folder

Open the folder your `.py` files live in (or an empty one to start fresh). If
VS Code asks whether you trust the folder, say yes: signing in, connecting,
and running code all require a trusted workspace, because they run code on a
remote server under your identity. Editing files and managing connection
profiles work either way. See [ADR-0002](adr/0002-workspace-trust-posture.md).

## 4. Add a connection profile

A connection profile tells the extension which Viya deployment to talk to.
Open the Command Palette (`Ctrl`/`Cmd`+`Shift`+`P`) and run **Python on Viya:
Add Connection Profile**. Give it a name and the deployment's address — for
example `https://viya.example.com` — and leave everything else blank for now.

On **Viya 4 2022.11 and later** that is the whole profile; nothing else needs
setting up. On earlier Viya 4 releases you need an OAuth client registered by
your administrator first. Both cases, and what the other fields on a profile
do, are covered in [Connection profiles](connection-profiles.md).

## 5. Connect

Run **Python on Viya: Connect to SAS Viya** from the Command Palette. If you
are not signed in yet, this signs you in first — your browser opens on your
deployment's own login page, and the extension never sees your Viya password.
Most deployments then show you a short code to paste into the box VS Code
pops up; that is the normal path, not a fallback. Once connected, a message
names the profile you are connected to.

The first time you connect, you may also be asked which **compute context**
to use — pick the one your administrator told you to, or the default if you
were not told anything. Full detail, including what to do if nothing looks
right, is in [Signing in](signing-in.md) and [Connecting to Viya](connecting.md).

## 6. Point the editor at Viya

This extension's commands only appear when the workspace's **run target** is
a Viya profile — not Local, which is VS Code's own Python behaviour and is
where a fresh workspace starts. Click the run-target item in the status bar
(it says **Local Python** until you change it), or run **Python on Viya:
Select Run Target**, and pick the profile you just connected with.

## 7. Run something

Create a `.py` file with one line in it, for example:

```python
print("Hello from Viya")
```

Then run **Python on Viya: Run File** — the play button in the editor's top
right, the editor's right-click menu, or the Command Palette all do the same
thing. A channel called **Python on Viya: Output** opens and streams the
result. That is your `print()` output, produced by a Python interpreter
running inside Viya, not on your machine.

From here, [Running Python](running-python.md) covers running a selection
instead of a whole file, cancelling, and what happens with output that is not
plain text (a chart, a DataFrame rendered as a table).

## Where to next

- **[Browsing SAS Content](browsing-sas-content.md)** — a tree view of your
  Viya folders and files (My Folder, SAS Content, Favorites, Recycle Bin) in
  the activity bar, for opening and saving files straight from Viya instead of
  your local disk.
- **[Browsing SAS libraries](browsing-sas-libraries.md)** — a second tree view
  of the active session's SAS libraries, with a scrollable, sortable,
  filterable grid for any table in them, table properties, and a CSV export.
- **[Python and SAS libraries](data-access.md)** — reading and writing that
  same library data directly from your own Python code, with no local
  database driver and no second credential to manage.
- **[The Python environment](python-environment.md)** — **Show Environment**
  lists the interpreter version and every package installed on it, so you can
  check whether something is there before you `import` it.
- **[Diagnostics](diagnostics.md)** — how a failed run shows up in the
  Problems panel.

## If something did not work

Check the [FAQ](faq.md) first if it is more of a "wait, how does this work"
question than an error. For an actual error, start with
[Troubleshooting](troubleshooting.md) — it is organized by what
you see on screen, and most entries point back into the page that covers that
area in full. Two output channels matter when something is wrong: **Python on
Viya: Output** is a transcript of what your program printed, and **Python on
Viya** (opened with **Python on Viya: Show Log**) is the extension's own
record of every request it made, including the status code and correlation id
your administrator will ask for.
