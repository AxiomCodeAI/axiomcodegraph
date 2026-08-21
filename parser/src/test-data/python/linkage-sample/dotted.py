"""Dotted base references — `module.Class`, the axis NAME-style bases cannot reach.

This is asyncio's house style (`from . import futures` then `futures.Future`) and it
accounts for 50 of 99 base edges there. A sample built only from `from .x import Y`
imports produces zero DOTTED_NAME bases and is blind to it.
"""
import threading

from . import models


class DottedChild(models.Base):          # DOTTED_NAME, in-corpus         MUST resolve
    def describe(self):
        return super().describe()        # -> models.Base.describe        MUST resolve


class DottedDeep(models.Child):          # DOTTED_NAME, in-corpus         MUST resolve
    def merge(self, *items, **meta):
        return super().merge(*items, **meta)   # -> models.Child.merge    MUST resolve


class DottedExternal(threading.Thread):  # DOTTED_NAME, outside the root
    def run(self):
        return super().run()             # external base       MUST STAY UNRESOLVED
