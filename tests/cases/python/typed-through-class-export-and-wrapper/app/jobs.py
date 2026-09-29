async def sync_orders(): return 1
def stream_orders(): yield 1
async def stream_users(): yield 1
def count_orders(): return 1
def outer():
    async def inner(): return 1
    return inner
