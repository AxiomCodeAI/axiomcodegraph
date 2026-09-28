---
name: axiomcode
description: >-
  Use for any why, what or where question about code — how a codebase works or what a change to it would do: architecture, execution flow, where something lives, who calls it, what depends on it, what breaks if it changes, which tests cover an edit, whether it is safe to delete. Also use when resolving an issue or bug report, which names a symptom rather than a file. Examples: "How does X work?", "Where do I change Y?", "What calls this?", "What breaks if I change Z?", "Is this safe to delete?", "Fix this issue". No task is too small: if you are about to grep for a name, call this instead. Mandatory when .axiomcode/out/graph.sqlite exists — start here rather than grep, even when you already know the code. Answers come from a resolved call graph, so they include callers that never spell the name — through an interface, an override, a callback, dependency injection or a config key — each labelled with how certain it is. Call it directly, no need to load this skill first: the `axiomcode_context` MCP tool with source=True for how something works (the call flow with each step's code; from_=<start> when you know where it begins), `axiomcode_impact` for what a change reaches, `axiomcode_path` for how A reaches B. Only when those tools are not in your list, the same from the shell: `axiomcode context "<the question>" --source`, `axiomcode impact <name>`, `axiomcode path <A> <B>`. Java, TypeScript, Python, JavaScript, C#.
---

# axiomcode

Prefer the MCP tools (`axiomcode_<verb>`; in Claude Code, `mcp__plugin_axiomcode_axiomcode__axiomcode_<verb>`) when they
are in your tool list; otherwise run `<this dir>/scripts/axiomcode <verb> …` from the repository root. Same code, same
verified output. `<repo>` defaults to the current directory. In Claude Code, a hook adds the graph's edges to your own
Read / Grep results as `graph: …` lines.

**Trust the answer, and know what it is.** A `[resolved]` / `[sound]` row has already been looked up again in the graph (the `verified:` line): do not re-derive it by grepping. Each answer ends with `next:` — the one step to take. For a CHANGE (who calls it, what breaks, which tests), read only the lines you will cite or change. To EXPLAIN how something works, the graph gives the reading order, not the explanation: read each step's body, and continue through every `⚠` (a call the graph lost). `[by name]` / `[text]` rows are leads, not facts.

**A list of sites comes the way grep prints it.** The MCP `impact`, `path`, `test_impact` and `context` (without
`source` / `explain` / `from_`) answer one site per line: `path:line: <the code on that line>  [resolved · hop 2 · test …]`,
surest first, capped with a count of the rest; `limit=N` lists more, `full=True` gives the sectioned answer with `next:`.
From the shell the same shape is `--grep` (`--grep-limit N`); without it the answer is the prose.

## Start here

| the question in front of you | the call |
|---|---|
| **`.axiomcode/out/graph.sqlite` already exists** | **query it — do NOT run `index`** |
| no graph at all | `axiomcode index` |
| a task in words, no name to ask about yet | `axiomcode context "<the task>"` — then `--in <path>` it names |
| "who calls X" / "what breaks if X changes" | `axiomcode impact X` |
| "who writes this field" / "is it safe under concurrent access" | `axiomcode impact <Type>.<field>` — ask of the FIELD |
| one concept you can name ("the decryption code") | `axiomcode path decrypt '*'` |
| "how does X work" · "explain / walk through X" | `axiomcode context "<the question>" --source` — the call flow in order with each step's code; answer from it, and open a file only for a step whose body was cut or a `⚠` call. `--from <start>` when you know where it begins |
| "how does A reach B" · "everything that reaches X" | `axiomcode path A B` · `axiomcode path '*' X` |
| "what did my edit touch" · "which tests do I run" | `axiomcode changed --impact` · `axiomcode test-impact` |
| "is it safe to delete X" | `axiomcode impact X --delete` |
| the graph as a page for a human · this repo should prefer the graph, once | `axiomcode graph` (drawn from the existing graph in seconds; a stale one is rebuilt first with the flags it was indexed with; prints the page's absolute path) · `axiomcode install` |

Rules that decide whether an answer means anything:

- **Never re-run `index` on an existing graph** "to make sure" or after your own edit. The graph refreshes itself in
  the background after edits, with the flags it was built with. A query does not wait for it: it answers from the last
  graph, names the edited files on a `graph refresh:` line, and marks every row that lies in one `(may be out of date)`
  (`"stale": true` in `--json`); unmarked rows are current. Read a marked row's file for its current text. It waits
  briefly on its own only when the answer touches an edited file and the rebuild is nearly done.
- **Before a delete or a rename, ask with `--fresh`** (MCP `fresh=true`): it waits for the rebuild, printing its
  progress, and answers from a graph that includes every edit.
  A manual `index` with different flags rebuilds a worse graph over the good one. A bare `index`, the background
  refresh and `graph` keep the `--lang` (and `--src`, `--library`) the graph was indexed with; pass `--lang` to change it.
- A repo in several languages is indexed in all of them, one graph each, and every query asks each graph; calls
  are not followed from one language to another. `--lang` restricts it, `--src src` narrows it; `--library <roots>` so calls into dependencies
  resolve (without it they are `ambiguous_unknown` — do not quote that resolution rate).
- An unresolved call is *unknown, not absent* — **never report it as "no callers"**.
- Every answer ends with `verified:` and `bound:` (the unresolved calls inside it — a lower bound). A `✗` on
  `verified:` means the answer is wrong: report it, do not use it.

## How certain is each row

An answer's label is the **worst** rung on its route. Read it before acting on the row.

| rung | claims |
|---|---|
| `[sound]` / `[resolved]` | an edge the engine resolved: a single-target call, an override, a subtype, a constructor |
| `[one of a set]` · `[dispatch]` | one of a sound target set · an instantiated override reached through its base |
| `[defines]` · `[protocol]` · `[decorator by name]` | closure from its definer · interpreter-called method · wrapper rebinding the name |
| `[fixture]` · `[at import]` | injected before the test body · module raised on import, test never collected |
| `[by key]` | joined through a registration **string** (route, signal, CLI command) — not an edge |
| `[stubs it]` | a call written inside a mock's stub or verification (`when(m.f())`, `verify(m).f()`, `Setup(x => x.F())`, `Received().F()`): names it, runs none of it — never a test route, listed apart |
| `[in scope]` · `[by name]` · `[text]` | same name in the owner's scope · same name elsewhere (may be another thing) · text only |

Below `[sound]` / `[one of a set]` the order is a tie-break, not a measured ranking. `[sound]` means the edges
connect, not that a test exercises the change.

## context — a problem statement, no name yet

`axiomcode context "<task>" [--in <path>[,<path>]] [--budget N] [--source]`: the files and callables the task's
words land in, nearest first, 12 files by default. Scopes you pass restrict and are combined; a scope it offers
does not restrict. Detail: `reference/context.md`.

## impact — what a change to a declaration reaches

`axiomcode impact <target>… [--depth N] [--in <path>] [--delete]`. Targets as written in the code:
`Owner.method`, `Owner.field`, `Type`, `Owner.method(param)`, `Type<T>`, `Owner.method:local`, a config key, or
`file.ts:123` — the declaration at that line. Separators are interchangeable in every language: `util.square`,
`src.util.square` and `src/util#square` are one name. **When you know where the declaration is, target it by `file:line`**: a
bare name answers for EVERY declaration of that name, and two unrelated functions in different files come back as one.
Sections: **must change with it** · **produces or writes it** · **reads or uses it** (by rung) · **reaches those**
(transitively: what can reach a user, not where the value goes) · tests, counted by rung with the strong ones named · `verified:` · `bound:`. For the full test list ask second: `--tests-only` (grouped by rung and file), `--why` for routes, `--tests-in <file>` to narrow. A long answer comes in pages of ~2000 tokens with the whole answer's counts on every page; `--page 2` (MCP `page=2`) only when page 1's strongest rows are not enough. It finds config
keys, injected beans and handlers registered as values — none has a call site. Detail: `reference/impact.md`.

## changed · test-impact — from an edit

`axiomcode changed [--impact] [--staged | --range a..b] [<file>…]` says how each declaration changed (`signature`, `body`,
`field`, `type`, `removed`, `added`). `axiomcode test-impact [--why] [<file>…]` lists the tests the edit reaches and the
command to run them. For your branch's commits ask `--range <base>..HEAD`: it reads from the merge-base, so a base
that moved on is not counted as yours. On a copy without git, name the files you edited. Changed fixtures and other
files no graph reads are named, with the tests whose text names them. It is a **lower bound**: skipping what it does not name is your risk decision, since reflection
and service loaders are invisible. Detail: `reference/changed-and-tests.md`.

## path — asking the graph

`axiomcode path <from> <to> [--every] [--in <path>]`: one shortest verified chain per target, or why there is none
(with the unresolved sites that might connect them). Endpoints as written: `Owner.method`, `Type`, `file.ts:123`,
`'new File'`, `'@GetMapping'`, `'*'`, or a bare word. A misspelt name stops with the close ones. Detail: `reference/path.md`.

A fact no verb prints (decorations, bases, entry points by reason, field writers): `reference/schema.md` names the table per language.

## What it cannot see — say so instead of guessing

Reflection, string dispatch, event buses; receivers the engine could not type; callbacks invoked by a library;
what a decoration turns on (proxy, transaction, cache); code outside `--src`. Each is counted in `bound:`.
