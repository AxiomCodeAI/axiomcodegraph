from store.backend.compiler import Where
from store.backend.operations import Connection


class Query:
    compiler = "Compiler"

    def __init__(self):
        self.where = Where()

    # no return annotation: the class is chosen by the string in self.compiler
    def get_compiler(self, connection):
        return connection.ops.compiler(self.compiler)(self, connection)


class InsertQuery(Query):
    compiler = "InsertCompiler"


class RawQuery:
    def fetch(self):
        return []


class BaseIterable:
    def __init__(self, results):
        self.results = results


class RowIterable(BaseIterable):
    def __iter__(self):
        results = self.results
        compiler = results.query.get_compiler(results.connection)
        yield from compiler.execute()


class DictIterable(BaseIterable):
    def __iter__(self):
        yield from self.results.query.get_compiler(self.results.connection).execute()


class RawIterable(BaseIterable):
    def __iter__(self):
        yield from self.results.query.fetch()


class ResultSet:
    def __init__(self):
        self._query = Query()
        self.connection = Connection()
        # the iterable class is held in an attribute and constructed through it
        self._row_class = RowIterable

    @property
    def query(self):
        return self._query

    def values(self):
        self._row_class = DictIterable
        return self

    def fetch_all(self):
        return list(self._row_class(self))


class RawResultSet:
    def __init__(self):
        self.query = RawQuery()

    def iterator(self):
        return RawIterable(self)
