"""FAMILY 04 — classmethod / staticmethod / property.
`Factory.from_config(cfg)` is the AutoModel.from_config shape: 75 of the 492
transformers misses, a classmethod reached through the CLASS OBJECT."""
from tlib import Config, Factory


class LocalCfg:
    @property
    def label(self) -> str:
        return "local"

    @classmethod
    def make(cls) -> "LocalCfg":
        return cls()

    @staticmethod
    def util() -> str:
        return "LocalCfg.util"


def lib_classmethod_on_class() -> str:
    cfg = Config.default()              # classmethod via the class object
    f = Factory.from_config(cfg)        # <- the AutoModel.from_config shape
    return f.build()


def lib_property_read() -> str:
    return Config("x").tag              # property getter on a LIB type


def lib_staticmethod() -> str:
    return Config.helper()


def client_descriptors() -> str:
    return LocalCfg.make().label + LocalCfg.util()
