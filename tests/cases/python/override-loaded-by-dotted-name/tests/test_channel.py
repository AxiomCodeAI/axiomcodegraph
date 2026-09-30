from shop.channel import Channel


def test_send():
    assert Channel("pager", "ops").send("hi") == "hi"
