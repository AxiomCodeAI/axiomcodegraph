class Scaffold:
    def post(self, rule):
        return rule


class Child(Scaffold):
    def post(self, rule):
        return rule.upper()


def handler(scaffold):
    return scaffold.post("/x")


def unused_helper(value):
    return value
