# A hyphenated file name is not importable with `import`; importlib loads it by path.
class G:
    def __init__(self, repo):
        self.repo = repo

    def lambda_label(self, i):
        return str(i)


class H:
    def lambda_label(self, i):
        return i
