from dataclasses import dataclass
from pydantic import BaseModel

def frozen(cls):                      # a project-local wrapper over dataclass
    return dataclass(frozen=True)(cls)

@frozen
class Point:
    x: int
    y: int

class User(BaseModel):                # declared by inheritance, not by a decoration
    login: str
    email: str
