class Service:
    def __init__(
        self,
        repo,
        clock,
    ):
        self.repo = repo

    def get(self, id):
        return self.repo.find(id)
