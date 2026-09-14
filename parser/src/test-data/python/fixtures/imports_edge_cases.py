"""`from __future__ import annotations` (PEP 563 — flips every annotation
in the module to a string, load-bearing for py_module.futureImports and
for isStringForwardRef), a function-local (deferred) import whose binding
lives in the function's scope rather than the module's, a try/except
ImportError polyfill that defines a *function* as the fallback rather than
importing one, conditional class redefinition (the same name bound by two
different class objects depending on a branch), a dotted import that binds
only its top-level segment, and a parenthesized multi-line from-import.
"""

from __future__ import annotations

import os.path
import xml.etree.ElementTree as ET

if True:
    class Widget:
        kind = "new"
else:
    # Same name, same module scope, a second class_def for `Widget` — the
    # binding is MULTIPLE origins for one name, not a redeclaration error;
    # only the branch that actually executes wins at runtime.
    class Widget:
        kind = "old"


def use_os_path_dotted_import():
    # `import os.path` binds only the top-level segment `os` in this
    # module's scope; `os.path` is reached by attribute access afterward,
    # never a direct binding of `path`.
    return os.path.join("a", "b")


def use_aliased_dotted_import(xml_text):
    return ET.fromstring(xml_text)


def deferred_import_inside_function():
    # `json` is bound in THIS function's own scope, not the module's —
    # a classic lazy/deferred import used to avoid a module-level cost or
    # break an import cycle.
    import json

    return json.dumps({"deferred": True})


try:
    from ujson import dumps
except ImportError:
    # The fallback branch does not import a replacement name — it DEFINES
    # one. Both branches bind the same name `dumps` at module scope, but
    # via completely different binding origins (IMPORT vs FUNCTION_DEF).
    def dumps(obj):
        import json as _json

        return _json.dumps(obj)


from pkg.sub import (
    first_symbol,
    second_symbol as aliased_symbol,
    third_symbol,
)


def annotated_with_future_import(widget: Widget) -> Widget:
    # Because of `from __future__ import annotations`, both annotations
    # above are unevaluated strings at runtime ("Widget"), even though
    # `Widget` is a perfectly real, already-bound name at module scope.
    return widget
