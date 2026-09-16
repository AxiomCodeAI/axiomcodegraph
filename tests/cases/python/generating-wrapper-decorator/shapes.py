from dataclasses import dataclass

def frozen(cls):
    return dataclass(frozen=True)(cls)

@frozen
class Point:
    x: int
    y: int

def build():
    return Point(1, 2)
