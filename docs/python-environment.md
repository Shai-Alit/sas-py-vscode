# The Python environment

Your code runs against the Python interpreter your Viya administrator
configured and manages — not one you installed. **Python on Viya: Show
Environment** tells you what that interpreter is and what is installed in it.

## Show Environment

Run **Python on Viya: Show Environment** from the Command Palette, or click the
environment item in the status bar — the one to the right of the profile,
visible once the run target is a Viya profile.

It opens a read-only document beside your code showing:

- the **interpreter version** and the path to its **executable**;
- when the answer was **probed**;
- every installed distribution, with its version;
- a **Local comparison** section against whatever interpreter the Python
  extension currently has active — see below.

The document is plain text, so <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>F</kbd>
searches it — which is the point, on a stock Viya 4 the list runs to a few
hundred entries. The package list comes from `importlib.metadata`, the
interpreter's own record of what is installed, not from shelling out to `pip`.
A distribution whose metadata is too broken to read is skipped rather than
blanking or crashing the list.

## Local comparison

Below the package list, **Show Environment** compares what is installed on
Viya against your own local Python environment — whichever interpreter the
[Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
currently has active for the file you're editing — into three lists:

- only on this Viya profile;
- only in your local environment;
- installed on both, at different versions.

Package names are matched regardless of case or `-`/`_`/`.` punctuation
differences, so `My-Package` and `my_package` are never reported as a false
mismatch.

If the Python extension is not installed, has no active environment, or its
active environment cannot be read, the section says the local environment is
unknown rather than guessing — the rest of the document is unaffected.

## Search Environment

**Python on Viya: Search Environment** opens a filterable quick pick over the
current profile's installed packages — type to narrow a list of a few hundred
down to the one you're after, faster than scrolling and searching the full
document. Picking an entry copies `name==version` to the clipboard. It shares
**Show Environment**'s own cached-vs-fresh logic exactly: a cached answer for
the profile is used with no network call, and the first search for a profile
probes it (and syncs the Pylance stub tree the same way **Show Environment**
does, complete with the same reload notice below, when the sync changes
anything) before showing you a list.

## It is probed once, then cached

Asking the deployment costs a real `PROC PYTHON` round trip, and the answer
changes about as often as your administrator rebuilds the environment — rarely.
So the first **Show Environment** for a profile probes, and every one after
that is served instantly from a cache. The cache is per profile, kept in the
editor's global state, so it survives a window reload and is shared between
every folder you open that profile from. A fresh window with a cached answer
does not connect just to show it to you.

There is **no automatic refresh**. A cached answer is current until you say
otherwise.

## Refresh Environment Info

**Python on Viya: Refresh Environment Info** re-probes even when a cached
answer exists. If the environment document is already open, it updates in place
— the same tab, the fresh answer, no second tab.

Run it after your administrator tells you the environment changed, or when a
`ModuleNotFoundError` disagrees with what the cached list says is installed.

## Quieting Pylance's false "unresolved import" warnings

Pylance analyses your code against your *local* interpreter, which usually
does not have Viya's packages installed — so a perfectly good
`import some_viya_only_package` can show a red squiggle
(`reportMissingImports`) even though it works fine when you run the file on
Viya.

Every **Show Environment**, **Search Environment**, and **Refresh Environment
Info** call that reaches Viya also writes a small set of generated type stubs
— one per package that is on Viya but not in your local environment — to a
`.pythonOnViya/typings/` folder in your workspace, and points Pylance's
`python.analysis.stubPath` setting at it (workspace `settings.json`, added
only if nothing already set that setting). A generated stub only tells
Pylance the module exists; it carries no real type information, so the red
squiggle becomes, at worst, a milder "stub only" warning
(`reportMissingModuleSource`) you can safely ignore or suppress — it does not
add real completions or catch real type errors the way an actual
`numpy`-stubs install would.

**A package already resolvable in your local environment is never stubbed.**
Only what the Local comparison section above calls "only on this Viya
profile" gets a generated stub — a package you already have installed
locally keeps its own real type information, never a generic placeholder.
The same protection extends to your own code: a top-level name that is
already a real folder or `.py` file at your workspace root is never stubbed
either, even when nothing local resolves it, since a generated stub would
otherwise take precedence over your own source there.

**Reload the window (or restart the language server) to see the effect.**
Pylance does not notice a changed `stubPath` or a regenerated stub tree on
its own. A notification says when this is worth doing, and offers
**Restart Language Server** first — it restarts only the Python
language-server process, typically a few seconds, versus **Reload Window**'s
~60–90 second full extension-host restart, which also drops your live Viya
connection. Reload is still offered as a fallback, since a restart is not
guaranteed to be registered or to succeed.

**If `python.analysis.stubPath` is already set to something else** in your
workspace — your own hand-authored stubs, say — Python on Viya leaves it
alone rather than overwriting your setup; a notification and a note in the
**Python on Viya** log both say so when it happens. Point it at
`.pythonOnViya/typings` yourself (merged with whatever else you use
`typings/` for) if you want both.

Python on Viya writes its own `.gitignore` inside `.pythonOnViya/`, so you do
not need to add anything to your own — the folder is regenerated on every
refresh and has nothing worth committing.

## Probing does not touch your session

The probe runs a fixed, extension-authored script — never your code — and
writes its answer to a file in the session's working directory rather than
printing it, so a few hundred package names cannot be line-wrapped into
nonsense by the log. It does not restart the interpreter and it does not leave
`sys`, `json` or `importlib` bound in your namespace afterwards. A variable you
set before a refresh is still set after it.

It does share the [one-run-at-a-time](running-python.md#one-run-at-a-time)
rule: triggering **Show Environment** while a run is in flight is refused, the
same way a second run would be. There is simply nothing to cancel a probe with.

## When it does not work

**"The run target is Local Python."** / **"No SAS Viya connection profile is
selected."** Same as for a run — set the target to a Viya profile with
**Select Run Target**.

**The probe fails.** Usually this means `PROC PYTHON` is not available on the
deployment or the context you connected with — a context whose SAS server has
no Python interpreter configured connects happily and then cannot run
anything. The **Python on Viya** log carries the deployment's own wording.

**The document says the environment "has not been probed yet."** The cache was
cleared (the profile was removed and re-added, say). Run **Show Environment**
again to re-probe.

## What is not here yet

**Installing packages.** This is a read-only view. Adding a package to the
environment is your administrator's job, not the extension's.

**Modules that are not distributions.** The list is what `importlib.metadata`
reports as installed distributions. A module that is importable without being
packaged as one will not show up, even though `import` finds it — and the
generated stubs above cover only what the probe reported, for the same
reason.

**Real completions or type-checking from the generated stubs.** A generated
stub only stops Pylance from calling a real import missing; it does not add
real completions, attribute checking, or anything else an actual types
package would. It also cannot make a dotted namespace package's submodule
resolve (`google.protobuf` from a `google`-rooted stub, say) — only the
top-level name.

**A dedicated "Viya" entry in VS Code's own Python environment picker.**
Newer VS Code Python tooling (the `ms-python.vscode-python-envs` extension)
lets a third-party extension register its own environment manager, shown
alongside `venv`/`conda`/`poetry` in the Environments sidebar. That would be
a discoverability improvement — not a way to get real import resolution, since
Pylance still needs a real local `site-packages` to point at, which a Viya
profile does not have — and isn't built here; a possible future enhancement,
not a gap in what this phase set out to do.

## Where the details are

- [Diagnostics](diagnostics.md) — where the `ModuleNotFoundError` pointer that
  sends people here comes from.
- [Capability probing](architecture/capability-probing.md) — the staged
  probing model this is the second stage of.
