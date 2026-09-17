"""The CONTROL. `build` is a real top-level PyPI package name (the PEP 517
build frontend), so a caller can legitimately have a source package called
exactly this. Excluding `build/` by NAME would silently drop it along with the
artifact copy at `build/lib/pkg` below; only that inner SHAPE is excluded
(#564), so this package and `build/frontend.py` stay in the IR like any other
source."""
