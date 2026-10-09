# axiomcode

Search with grep and Read as usual; the call graph stays out of the way until you ask it. Ask it directly,
through the axiomcode MCP tools, for what no text search answers — which declaration a call reaches, the callers
that never spell the name:

    impact(name)        who calls it, what a change to it reaches, and its tests;
                        impact() with no name: the same for your uncommitted edits
    path(start, end)    how A reaches B, every hop of the call chain
    tests()             the tests your uncommitted edits reach, and the command that runs them
    context(task)       how something works, as a narrative: the call flow step by step;
                        context(task, source=True) carries each step's code

Without the tools, the same from the shell: `axiomcode impact <name>`,
`axiomcode path <A> <B>`, `axiomcode tests`, `axiomcode context "<task>" --source`.

Every answer is a numbered list of places, each with the code of the function it sits in and the line that
matters marked `→`: answer from that code, and open a file only where a body was cut. A `resolved` place has
already been re-checked in the graph (the `verified:` line); do not re-derive it by grepping. `by name` /
`text` places are leads, not facts. An unresolved call means *unknown*, not *absent*.

Text search is still right for a string, a comment, a config value, or a file you already know.
