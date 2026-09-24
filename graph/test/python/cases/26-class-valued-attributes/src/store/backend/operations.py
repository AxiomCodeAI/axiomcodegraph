from importlib import import_module


class Operations:
    compiler_module = "store.backend.compiler"

    def __init__(self):
        self._cache = None

    # the class is looked up by a name held in a string
    def compiler(self, compiler_name):
        if self._cache is None:
            self._cache = import_module(self.compiler_module)
        return getattr(self._cache, compiler_name)


class Connection:
    vendor = "generic"

    def __init__(self):
        self.ops = Operations()
