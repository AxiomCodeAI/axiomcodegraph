"""Library-side coroutine functions, so `await` is exercised ACROSS the boundary.

The client half of this is f28_await.py. Two halves are needed because the
annotation that licenses typing an awaited value is read off the callee, and the
callee's provenance decides which relation carries it — expr_type for a client
`async def`, expr_lib_type for one declared here.
"""
from typing import List


class AsyncBox:
    def label(self) -> str:
        return "box"


async def fetch_box() -> AsyncBox:
    return AsyncBox()


async def fetch_boxes() -> List[AsyncBox]:
    return [AsyncBox()]
