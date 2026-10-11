class Service:
    def __init__(
        self,
        repo,
        clock,
        gateway,
    ):
        self.repo = repo
        self.gateway = gateway

    def get(self, id):
        return self.repo.find(id)

    async def pay(self, n) -> int:
        total = n
        return await self.gateway.pay(total)


def report(event):
    base = {"id": event.id}
    return base
