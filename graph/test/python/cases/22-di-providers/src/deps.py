"""Providers in their own module, which is where a real application puts them.

A handler imports the provider and names it in the marker: `from deps import
get_repo` then `repo = Depends(get_repo)`. The provider is never in the same file as
every handler that uses it.
"""


def Depends(fn=None):
    return fn


def open_repo():
    return "repo"


def get_repo():
    return open_repo()


def get_page_size(repo=Depends(get_repo)):
    """A provider depending on another, across the boundary once imported."""
    return repo
