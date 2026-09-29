"""What building a validated model runs: its validators, its post-init hook and its
default factories. None of them has a call site in the client.
"""
from pydantic import (BaseModel, Field, field_serializer, field_validator,
                      model_serializer, root_validator, validator)


def new_id() -> str:
    return "w-1"


def new_tags():
    return []


class Widget(BaseModel):
    id: str = Field(default_factory=new_id)
    size: int

    @field_validator("size")
    @classmethod
    def check_size(cls, v):
        return max(v, 0)

    @validator("id")
    def check_id(cls, v):
        return v.strip()

    @root_validator
    def check_all(cls, values):
        return values

    @field_serializer("size")
    def dump_size(self, v):
        """Runs on dump, not on construction: an entry point, not reached by building."""
        return str(v)

    @model_serializer
    def dump(self):
        return {}

    def model_post_init(self, ctx):
        self.size = self.size or 1


class Gizmo(Widget):
    tags: list = Field(default_factory=new_tags)


class Plain:
    """Not a model: a method of this name is an ordinary method."""

    def model_post_init(self, ctx):
        return ctx


class Gadget:
    def __init__(self, size):
        self.size = self.check_size(size)

    def check_size(self, v):
        return max(v, 0)
