"""15 -- a setuptools `build/lib` copy sits beside real source with the same
importable names, and a *different*, unrelated package is legitimately named
`build`.

INTENT: `build/lib/pkg` is BYTE-IDENTICAL to `pkg` -- exactly what a
`pyproject.toml` project has lying around after `python -m build` runs in
place. Before #564, that made every module, type and call site in `pkg` exist
TWICE under the identical `qualifiedName`, invisibly. It must not mint a
second `pkg` / `pkg.core`, and the site count below must match a project that
never had a `build/` directory at all.

`build/__init__.py` and `build/frontend.py` are the control: a real package
literally named `build`, so the fix cannot be "exclude anything named
`build`" -- that drops this package's own call into `pkg.core.greet` along
with the artifact.
"""
from pkg.core import Greeter
from build.frontend import run


def main():
    print(Greeter("world").greet())
    print(run("world"))


if __name__ == "__main__":
    main()
