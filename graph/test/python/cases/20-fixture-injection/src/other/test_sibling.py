"""A sibling test module with its OWN `client`, and the negative the name match missed.

`client` here and `client` in ../main.py are different fixtures with one name. A test in
this module must reach THIS one and never the sibling's, and `pkg/test_nested.py` must
reach neither. Measured on a public project, the unrestricted rule wired 32 tests to
four same-named fixtures each and fabricated 19% of the relation.
"""


def fixture(*a, **kw):
    if len(a) == 1 and not kw and callable(a[0]):
        return a[0]
    return lambda f: f


def build_client():
    return "sibling-client"


@fixture
def client():
    return build_client()


def test_sibling(client):
    return client
