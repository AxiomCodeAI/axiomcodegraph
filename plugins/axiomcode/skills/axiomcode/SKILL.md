---
name: axiomcode
description: >-
  Use for any why, what or where question about code — how a codebase works, where something lives, who calls it, what a change to it breaks, which tests cover an edit. Also use when resolving an issue or bug report, which names a symptom rather than a file. Examples: "How does X work?", "Where do I change Y?", "What calls this?", "What breaks if I change Z?", "Which tests do I run?", "Fix this issue". Search with grep as usual; ask the graph for what grep cannot know — which declaration a call reaches and the callers that never spell the name. Answers come from a resolved call graph, so they include callers that never spell the name — through an interface, an override, a callback, dependency injection or a config key — and every place comes with the code of the function it sits in. Call the MCP tools directly, no need to load this skill first: impact(name) for who calls it and what a change reaches (with no name: your uncommitted edits), path(start, end) for how A reaches B, tests() for the tests your edits reach, context(task, source=True) for how something works as a step-by-step call flow with each step's code. Only when those tools are not in your list, the same from the shell: `axiomcode impact <name>`, `axiomcode path <A> <B>`, `axiomcode tests`, `axiomcode context "<task>" --source`. Java, TypeScript, Python, JavaScript, C#.
---

# axiomcode

Search with grep as usual; the graph answers what grep cannot. Use the MCP tools when they are in your list (in Claude Code
`mcp__plugin_axiomcode_axiomcode__impact`, `__path`, `__tests`, `__context`); otherwise run
`<this dir>/scripts/axiomcode <verb>` from the repository root. Same answer either way.

| the question | MCP tool | shell |
|---|---|---|
| where is the code for this task? | your own search (grep), then bring the name here | — |
| who calls X, what does changing it reach, which tests? | `impact(name)` | `axiomcode impact <name>` |
| what is the value of constant X, and who reads it? | `impact(name)` | `axiomcode impact <name>` |
| what do my uncommitted edits reach? | `impact()` | `axiomcode impact` |
| how does A reach B? | `path(start, end)` | `axiomcode path <A> <B>` |
| which tests do my edits need, and how do I run them? | `tests()` | `axiomcode tests` |
| an answer lists an unresolved call I can see the target of | `link(site, target)` | `axiomcode link <file:line> <target>` |
| how does this work, start to finish? | `context(task, source=True)` | `axiomcode context "<task>" --source` |

Names are written as in the code: `Owner.method`, `function`, `Type`, or `file.py:123` for the declaration at that
line. There is no setup step: the first question builds the graph, and it refreshes itself after every edit.

## What an answer looks like

A numbered list of places, most relevant first, each with the code of the function it sits in. `→` marks the line
that matters; a short function is shown whole.

    1. shop/pricing.py:6  [resolved · total]
       ```python
         4  def total(prices):
         5      net = sum(prices)
       → 6      return net * (1 + vat_rate())
       ```
    verified: ✓ (4 edge(s) looked up again)

Answer from the code shown; open a file only for a place whose body was cut (`…`). The tag says how sure the place
is: `resolved` is an edge the engine resolved and re-checked (`verified:`), do not re-derive it by grepping;
`one of a set` is one of several real targets; `by name` and `text` are leads, not facts; `test` marks a test;
`hop N` is how far out it is. A call the graph could not resolve is *unknown*, not absent: never report "no callers"
from an empty answer.

## impact

With a name: who calls it, what depends on it further out, and the tests that exercise it. Example:
`impact(name="PriceService.total")`. With no name: the first line is `your edits:` (each declaration you changed and
how), then the same answer for all of them. A constant answers with its value — `change: const MAX_ITEMS = 5` —
so a limit, a default or a threshold is read off the first line rather than from the file.

## path

How one declaration reaches another: every hop of the call chain, with the code at the line each call is written on.
Example: `path(start="main", end="Ledger.put")`.

## tests

The tests your uncommitted edits reach, each with its code, and a last line `run: <command>` that runs exactly those.
Example: `tests()`. It is a lower bound: a test reached only through reflection or a service loader is not listed.

## link

Answers are in three parts. CONFIRMED places are backed by an edge: `resolved` by the engine, or `asserted` by a link —
act on them. LEADS are reached only through a guess (`by name`, `by key`, `one of a set`, `text`) — check each before
relying on it. TO RESOLVE lists the calls the answer stopped at: the site as `file:line:col`, the call as written, why
the engine could not follow it (a value from `getattr`, a handler table, reflection, a callback) and the graph's
candidate targets with their `file:line`.

When the task depends on one of those sites, read the call. Only if the code makes the target CERTAIN, record it:
`link(site="app/dispatch.py:6:12", target="on_save")`, or `axiomcode link app/dispatch.py:6:12 on_save` from the shell.
A candidate is a lead: confirm it by reading the call, never link one because it is ranked first. From then on impact,
path and tests walk that edge, labelled `[asserted]`, never `resolved`; when the target declares a return type, the
calls made on its result (chained, or on a variable assigned from it) resolve too. When a lead at a site is wrong,
reject it: `link(site, "not:<target>")` — it is no longer walked; only a guess can be rejected, never an edge the
engine resolved. The links are kept in `axiomcode-links.tsv` at the repository root, which is worth committing.
`link()` with no arguments lists them and whether the graph took each one; `axiomcode link <file:line:col> -` removes
one. A link is refused when the call written there names a different declaration, or the target is not one; when
the line it was made on is edited, it is dropped and listed as stale, and the site is to resolve again. Never link a
guess: an asserted edge is trusted by every answer after it.

## context

How something works, from a task in your own words: the files and callables the task touches and, for a
how-does-X-work question, the call flow step by step. Example: `context(task="how is an invoice settled",
source=True)` — source carries each step's code, so the flow is read without opening files. Only English task
words land (the graph's vocabulary is the code's identifiers); any language works once the task includes one
identifier as written in the code.

## index

`axiomcode index` builds the graph explicitly; `--lang` and `--src` narrow it. Never re-run it on an
existing graph: the graph rebuilds itself after edits, and an answer given before that finishes says so on a
`graph refresh:` line.

By default the graph is built without the project's dependencies: a call into one is unresolved or named only as an
external boundary. When better coverage is needed, compile the dependencies and enable them with `--library`, given
once on `index` and kept by every rebuild after it:

    axiomcode index --library auto                                  # the dependencies the project imports
    axiomcode index --library .venv/lib/python3.12/site-packages/requests,/deps/ir/jdk   # or name them

`auto` finds what the project depends on, in every language: a Python package its source imports, in its virtual
environment (`.venv`, `venv`, `$VIRTUAL_ENV`); a JavaScript / TypeScript package it imports, under `node_modules`; a
Java dependency `pom.xml` or `build.gradle` declares, through its `-sources.jar` in the Maven repository or Gradle's
cache, or its class jar decompiled when it ships no sources (needs Vineflower: `mvn dependency:get
-Dartifact=org.vineflower:vineflower:1.10.1`); a NuGet package a `.csproj` references, decompiled from its assembly
(needs `dotnet tool install -g ilspycmd`). Whatever it cannot find (a package never restored, a jar without sources)
it names, with the command that fetches it. A named entry, comma-separated with no spaces, is a dependency's source
directory or a library IR (a directory of the parser's CSV tables, as `axiomcode parser <source> <dir> --library`
writes it). Every library is compiled once into `~/.cache/axiomcode/libir/` and reused until its files change; one no
build has used for 30 days is removed. Entries are relative to the repository or absolute; write `~` out, since one
after a comma is not expanded. `AXIOMCODE_LIBRARY` takes the same list.

The choice is kept with the graph. Every rebuild after it stages the libraries again (`auto` discovers them
again, so a new dependency is picked up), and with libraries on, a dependency change alone (a manifest or lockfile
edit, `pip install -U`, `npm install`, `dotnet restore`, a Maven or Gradle fetch of a dependency that was missing)
also marks the graph stale and rebuilds it. A graph built
without `--library` never gains libraries by itself; `AXIOMCODE_REINDEX=1 axiomcode index` turns them off again.

With them, a call into a dependency resolves to its declaration and a chain is typed through its declared return
types (`client.post(...).json()`). Library bodies are not walked, so a dependency calling back into the project is
not found this way.

## What it cannot see — say so instead of guessing

Reflection, string dispatch, event buses; receivers the engine could not type; callbacks invoked by a library; what a
decoration turns on (proxy, transaction, cache). Text search is still right for a string, a comment or a config value.
