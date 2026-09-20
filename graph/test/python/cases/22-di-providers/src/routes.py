"""Handlers in a second module, naming imported providers in their markers."""
from deps import Depends, get_repo, get_page_size


class _Router:
    def get(self, path):
        return lambda f: f


router = _Router()


@router.get("/pages")
def list_pages(repo=Depends(get_repo), size=Depends(get_page_size)):
    return (repo, size)
