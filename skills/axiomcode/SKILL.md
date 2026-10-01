---
name: axiomcode
description: >-
  Use for any why, what or where question about code — how a codebase works, where something lives, who calls it, what a change to it breaks, which tests cover an edit. Also use when resolving an issue or bug report, which names a symptom rather than a file. Examples: "How does X work?", "Where do I change Y?", "What calls this?", "What breaks if I change Z?", "Which tests do I run?", "Fix this issue". Search with grep as usual: after a grep the graph adds only what grep cannot know — which declaration each match reaches and the callers that never spell the name. Answers come from a resolved call graph, so they include callers that never spell the name — through an interface, an override, a callback, dependency injection or a config key — and every place comes with the code of the function it sits in. Call the MCP tools directly, no need to load this skill first: impact(name) for who calls it and what a change reaches (with no name: your uncommitted edits), path(start, end) for how A reaches B, tests() for the tests your edits reach. Only when those tools are not in your list, the same from the shell: `axiomcode impact <name>`, `axiomcode path <A> <B>`, `axiomcode tests`. Java, TypeScript, Python, JavaScript, C#.
---

# axiomcode

Four questions, asked of the repository's call graph. Use the MCP tools when they are in your list (in Claude Code
`mcp__plugin_axiomcode_axiomcode__impact`, `__path`, `__tests`); otherwise run
`<this dir>/../../plugins/axiomcode/skills/axiomcode/scripts/axiomcode <verb>` from the repository root. Same answer either way.

| the question | MCP tool | shell |
|---|---|---|
| where is the code for this task? | grep; or, shell only | `axiomcode find "<question>"` |
| who calls X, what does changing it reach, which tests? | `impact(name)` | `axiomcode impact <name>` |
| what do my uncommitted edits reach? | `impact()` | `axiomcode impact` |
| how does A reach B? | `path(start, end)` | `axiomcode path <A> <B>` |
| which tests do my edits need, and how do I run them? | `tests()` | `axiomcode tests` |

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

## find

Where the code for a task lives, when you have a task in words and no name yet: the functions involved, most
relevant first, each with its code. A name the code calls but nothing declares is listed with its call sites — that is
code you have to write. Shell only: `axiomcode find "how is the invoice total computed"`.

## impact

With a name: who calls it, what depends on it further out, and the tests that exercise it. Example:
`impact(name="PriceService.total")`. With no name: the first line is `your edits:` (each declaration you changed and
how), then the same answer for all of them.

## path

How one declaration reaches another: every hop of the call chain, with the code at the line each call is written on.
Example: `path(start="main", end="Ledger.put")`.

## tests

The tests your uncommitted edits reach, each with its code, and a last line `run: <command>` that runs exactly those.
Example: `tests()`. It is a lower bound: a test reached only through reflection or a service loader is not listed.

## index

`axiomcode index` builds the graph explicitly; `--lang`, `--src` and `--library` narrow it. Never re-run it on an
existing graph: the graph rebuilds itself after edits, and an answer given before that finishes says so on a
`graph refresh:` line.

## What it cannot see — say so instead of guessing

Reflection, string dispatch, event buses; receivers the engine could not type; callbacks invoked by a library; what a
decoration turns on (proxy, transaction, cache). Text search is still right for a string, a comment or a config value.
