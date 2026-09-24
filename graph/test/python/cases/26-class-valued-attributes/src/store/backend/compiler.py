class Node:
    def as_sql(self, compiler, connection):
        return "node", []


class Where(Node):
    def as_sql(self, compiler, connection):
        return "where", []

    def as_generic(self, compiler, connection):
        return "where-generic", []

    def split(self):
        return self, None


class Compiler:
    def __init__(self, query, connection):
        self.query = query
        self.connection = connection
        self.where = None

    def setup(self):
        self.where, having = self.query.where.split()

    # dispatch by a name built at run time, falling back to the plain method
    def compile(self, node):
        vendor_impl = getattr(node, "as_" + self.connection.vendor, None)
        if vendor_impl:
            sql, params = vendor_impl(self, self.connection)
        else:
            sql, params = node.as_sql(self, self.connection)
        return sql, params

    def as_sql(self):
        self.setup()
        return self.compile(self.where)

    def where_sql(self):
        return self.compile(Where())

    def execute(self):
        sql, params = self.as_sql()
        extra, more = self.where_sql()
        return [sql, extra]


class InsertCompiler(Compiler):
    def execute(self):
        return []
