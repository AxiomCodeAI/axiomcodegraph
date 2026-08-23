"""
Records the call edges CPython ACTUALLY takes, as ground truth for linking.

A closed-world corpus makes "every call site must link" a mechanical claim, but
it says nothing about whether each site links to the RIGHT target. Only running
the program does. sys.settrace fires on every function entry with the frame of
the caller, so each event yields

    (caller file, caller line) -> callee qualified name

which is exactly the shape of a py_call_site row plus its resolvedCalleeHash.
That makes CPython the oracle rather than the author of the corpus, which
matters here because the corpus and the parser share an author.

Only edges whose CALLER is inside the corpus are kept: a call out to the runtime
has no py_call_site row and would be a false miss.

Emits JSONL on stdout, one edge per line, deduplicated.
"""
import json
import os
import sys


def main():
    root = os.path.abspath(sys.argv[1])
    entry = os.path.abspath(sys.argv[2])
    edges = set()

    def inside(path):
        return path is not None and os.path.abspath(path).startswith(root)

    def tracer(frame, event, _arg):
        if event != 'call':
            return None
        caller = frame.f_back
        if caller is None:
            return None
        caller_file = caller.f_code.co_filename
        callee_file = frame.f_code.co_filename
        if not inside(caller_file) or not inside(callee_file):
            return None
        # A CLASS BODY and a MODULE body are both 'call' events with a frame, but
        # neither is a call in the sense py_call_site models -- executing
        # `class Base00:` is not an invocation of anything. Only optimised code
        # objects (CO_OPTIMIZED) are real function frames; class and module
        # bodies are not.
        if not frame.f_code.co_flags & 0x1:
            return None
        # The callee's qualified name as CPython knows it. co_qualname exists
        # from 3.11; on 3.10 co_name plus the defining module is enough to
        # identify the function unambiguously within a closed corpus.
        callee = getattr(frame.f_code, 'co_qualname', frame.f_code.co_name)
        module = os.path.relpath(callee_file, root)[:-3].replace(os.sep, '.')
        if module.endswith('.__init__'):
            module = module[: -len('.__init__')]
        edges.add(
            json.dumps(
                {
                    'callerFile': os.path.relpath(caller_file, root),
                    'callerLine': caller.f_lineno,
                    'calleeModule': module,
                    'calleeName': frame.f_code.co_name,
                    'calleeQual': callee,
                },
                sort_keys=True,
            )
        )
        return None

    sys.path.insert(0, root)
    source = open(entry).read()
    globals_dict = {'__name__': '__main__', '__file__': entry}
    sys.settrace(tracer)
    try:
        exec(compile(source, entry, 'exec'), globals_dict)
    finally:
        sys.settrace(None)

    for edge in sorted(edges):
        sys.stdout.write(edge + '\n')


if __name__ == '__main__':
    main()
