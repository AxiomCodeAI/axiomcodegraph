from pkg import demo


def test_render():
    assert demo.render(2) == "2"
