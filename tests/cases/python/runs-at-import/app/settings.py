"""A settings object built while the module is being imported."""
import os


def endpoint():
    """Read once, at import, by the line below. Break this and no module that imports
    this one can be imported at all."""
    return os.getenv("ENDPOINT", "http://localhost")


class Settings:
    def __init__(self):
        self.url = endpoint()


settings = Settings()
