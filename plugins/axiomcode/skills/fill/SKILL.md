---
name: fill
description: >-
  Link the call sites the graph could not resolve, after a build. Use when an axiomcode note says the engine left
  unresolved call sites ("To fill them: run /axiomcode:fill"), or when asked to fill, link or complete the call graph.
  Reads each open site's code and records a link only where the code makes the target certain; everything else is
  left open. Returns one line: how many sites were linked, rejected and left open.
context: fork
---

# fill

The engine has done what it can by the end of a build. The sites it could not follow are calls through a value (a
handler table, a callback parameter, `getattr`, reflection) or a member called on a receiver it could not type. You
settle them by reading the code. Every link you make is trusted by every answer after it, so a wrong link is worse
than a missing one.

## The loop

1. Get the next page of open sites: `unresolved(limit=25)`, or `axiomcode unresolved --limit 25` from the shell. Each
   site comes with its `file:line:col`, the line's code, the caller it sits in, the engine's reason and the graph's
   candidates.
2. For each site, read enough code to know what runs there: the caller's body, where the value comes from (the
   parameter's callers, the table's entries, the attribute's assignment). A candidate is a lead, not an answer.
3. Write one decision per site:
   - `<site> <target>` when the code makes the target CERTAIN. The target is a declaration as the graph names it
     (`Owner.method`, `function`) or its `file:line`. A site that reaches two targets (a table of two handlers) gets
     two lines.
   - `<site> not:<target>` when a candidate is wrong (`d.update(x)` on a dict is not the project's `Cache.update`).
   - `<site> ?` when you cannot be certain: the value comes from outside the repository, or it could be any of
     many. This is the right answer for most library calls.
4. Send the page's decisions in one call: `unresolved(decisions="<the lines>")`, which answers with what was taken
   and the next page, or `axiomcode link --batch -` with the lines on stdin. A refused line says why (the target is
   not a declaration, no call is written there); fix it or mark it `?`.
5. Repeat until no site is open or you have done 8 pages, whichever is first.

## Rules

- Never link by name alone, and never link a candidate because it is ranked first.
- Never link a call into a library or the standard library; those are not project code.
- A link adds an edge and never removes one. Do not use it to "correct" an edge the engine resolved.
- Do not edit source files. This pass only reads code and records decisions.

## What to return

One line, nothing else: `fill: linked N, rejected R, left open K; S still open` with the summary line the last batch
printed. The links are kept in `axiomcode-links.tsv` at the repository root, which the user may want to commit.
