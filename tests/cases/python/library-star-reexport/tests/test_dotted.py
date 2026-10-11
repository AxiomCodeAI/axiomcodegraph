from app.dotted import DottedStore


def test_dotted_get():
    assert DottedStore().get("a") == "a"
