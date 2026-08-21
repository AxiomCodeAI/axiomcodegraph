from typing import Optional, Dict


def add(a: int, b: int) -> int:
    return a + b


def fetch(url: str, *, timeout: Optional[float] = None, headers: Dict[str, str] = {}) -> "Response":
    return url


class Repo:
    def get(self, key: str, default: int = 0) -> Optional[str]:
        return default
