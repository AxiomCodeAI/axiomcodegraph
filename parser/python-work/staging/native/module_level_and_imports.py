"""Module-level executable code, conditional imports, relative imports at
varying levels, and a star import — all purely syntactic, so this parses
cleanly under CPython even though the relative targets are not real
packages on disk."""

import sys
import os.path as ospath
from typing import TYPE_CHECKING

try:
    import ujson as json_backend
except ImportError:
    import json as json_backend

if sys.version_info >= (3, 8):
    from functools import cached_property
else:
    cached_property = property

if TYPE_CHECKING:
    from .models import User

from . import sibling_module
from .. import package_level_module
from ...deep import buried_module
from .utils import helper, other_helper as oh
from .constants import *

__all__ = ["Config", "load_config"]

_PLATFORM = sys.platform
_CONFIG_PATH = ospath.join("etc", "app.conf")

if _PLATFORM.startswith("win"):
    _LINE_ENDING = "\r\n"
else:
    _LINE_ENDING = "\n"

for _flag_name in ("DEBUG", "VERBOSE", "STRICT"):
    globals()[f"FLAG_{_flag_name}"] = False

print(f"module initialized with backend={json_backend!r}")


class Config:
    def __init__(self, path=_CONFIG_PATH):
        self.path = path


def load_config():
    return Config()
