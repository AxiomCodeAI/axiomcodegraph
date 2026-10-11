LIMIT = 3; NAME = "x"


class Box:
    size = 1; label = "b"

    def __init__(self):
        self.a = 1; self.b = 2

    def run(self, j):
        con = j.get('contract', []); dr = j.get('direct', []); rc = j.get('reached', [])
        return len(con) + len(dr) + len(rc) + self.a + self.b + self.size + len(self.label) + LIMIT


if __name__ == '__main__':
    j = {}; lo, hi = 0, 10
    con = j.get('contract', []); dr = j.get('direct', []); rc = j.get('reached', []); ts = j.get('tests', [])
    print(len(con), len(dr), len(rc), len(ts), len(NAME))
