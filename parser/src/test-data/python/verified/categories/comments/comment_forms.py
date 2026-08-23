#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Module docstring — a DOCSTRING_MODULE comment."""

# An ordinary LINE_COMMENT.
# A second line, forming a BLOCK_COMMENT_RUN with the first.

import os  # trailing comment on an import


class Documented:
    """Class docstring — DOCSTRING_CLASS."""

    attribute = 1
    """Attribute docstring — DOCSTRING_ATTRIBUTE."""

    def method(self) -> int:
        """Method docstring — DOCSTRING_FUNCTION."""
        # A comment inside a body.
        return 1


def type_commented(a, b):
    # type: (int, int) -> int
    return a + b


def suppressed():
    import sys  # noqa: F401
    return 1  # pragma: no cover


def exercise() -> int:
    return Documented().method() + type_commented(1, 2) + suppressed()
