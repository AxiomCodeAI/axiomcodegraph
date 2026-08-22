"""
An INDEPENDENT static resolver, for comparing against our own.

Python has no linker, so there is no javac-equivalent to hand us ground truth for
call targets. The closest available thing is a mature third-party static
analysis engine solving the same problem by a different method, which is what
`jedi` is — it is the engine behind most Python editor "go to definition".

What this gives that our own gates cannot: our Gate 1 proves the SCOPE TREE is
right and Gate 2 proves the DECLARATIONS are right, but neither says anything
about whether a call reaches the correct callee. Comparing two independent
resolvers splits the unresolved population into three genuinely different groups:

  BOTH      — jedi and we agree on a target. Confirms we are right.
  JEDI_ONLY — jedi resolves and we do not.  FIXABLE, and jedi shows the shape.
  NEITHER   — neither resolves.             Not statically resolvable at all.
  OURS_ONLY — we resolve and jedi does not. Either we are ahead, or over-reaching.

The last two are the interesting ones. NEITHER is the honest ceiling for static
analysis on this corpus; OURS_ONLY needs inspecting rather than celebrating.

Reads call-site positions produced by our parser and asks jedi about each one.
"""
import json
import sys

import jedi


def main(project_root: str, sites_path: str) -> None:
    project = jedi.Project(project_root)
    sites = json.load(open(sites_path, encoding="utf-8"))

    by_file: dict[str, list] = {}
    for site in sites:
        by_file.setdefault(site["filePath"], []).append(site)

    out = []
    for path, group in by_file.items():
        try:
            source = open(path, encoding="utf-8", errors="replace").read()
            script = jedi.Script(source, path=path, project=project)
        except Exception:
            continue
        for site in group:
            record = {"id": site["id"], "jedi": "ERROR", "target": ""}
            try:
                # jedi is 1-based on lines and 0-based on columns, matching the
                # parser's startLine/startColumn once the line is offset.
                names = script.goto(
                    site["line"], site["column"], follow_imports=True, follow_builtin_imports=True
                )
                if not names:
                    record["jedi"] = "UNRESOLVED"
                else:
                    first = names[0]
                    record["jedi"] = "BUILTIN" if first.in_builtin_module() else "RESOLVED"
                    record["target"] = f"{first.module_name}.{first.full_name or first.name}"
            except Exception:
                record["jedi"] = "ERROR"
            out.append(record)

    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
