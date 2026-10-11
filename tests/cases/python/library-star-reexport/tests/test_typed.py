from app.typed import TypedStore


def test_typed_get():
    assert TypedStore().get("a") == "a"
