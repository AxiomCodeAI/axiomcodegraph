"""A real submodule of the CONTROL `build` package. Calls into `pkg.core`
exactly like `main.py` does, so a resolver that keyed on directory NAME instead
of the artifact shape would have nothing left to call once `build/` was
excluded wholesale."""
from pkg.core import greet


def run(name):
    return greet(name)
