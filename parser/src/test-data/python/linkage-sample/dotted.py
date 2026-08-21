"""Dotted `module.Class` bases — asyncio's house style. All internal."""
from . import models


class DottedChild(models.Base):          # DOTTED_NAME, in-project        MUST resolve
    def describe(self):
        return super().describe()        # -> models.Base.describe        MUST resolve


class DottedDeep(models.Child):          # DOTTED_NAME, in-project        MUST resolve
    def merge(self, *items, **meta):
        return super().merge(*items, **meta)   # -> models.Child.merge    MUST resolve
