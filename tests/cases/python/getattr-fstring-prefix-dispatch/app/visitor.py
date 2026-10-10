from functools import update_wrapper


class NodeVisitor:
    def get_visitor(self, node):
        return getattr(self, f"visit_{type(node).__name__}", None)

    def visit(self, node):
        f = self.get_visitor(node)
        if f is not None:
            return f(node)
        return self.generic_visit(node)

    def generic_visit(self, node):
        return None


def traced(f):
    def new_func(self, node):
        return f(self, node)

    return update_wrapper(new_func, f)
