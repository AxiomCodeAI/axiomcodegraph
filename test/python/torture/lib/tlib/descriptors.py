"""FAMILY: classmethod / staticmethod / property.
`Factory.from_config(...)` is the AutoModel.from_config shape -- 75 misses on
transformers, a classmethod reached through the CLASS OBJECT."""


class Config:
    def __init__(self, tag: str = "cfg") -> None:
        self._tag = tag

    @property
    def tag(self) -> str:
        return self._tag

    @staticmethod
    def helper() -> str:
        return "Config.helper"

    @classmethod
    def default(cls) -> "Config":
        return cls("default")


class Factory:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg

    @classmethod
    def from_config(cls, cfg: Config) -> "Factory":
        return cls(cfg)

    def build(self) -> str:
        return "Factory(" + self.cfg.tag + ")"
