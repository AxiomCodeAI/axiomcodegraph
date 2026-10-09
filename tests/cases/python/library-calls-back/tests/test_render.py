from app.render import AppLoader, render


def test_render():
    assert render({"loader": AppLoader()}) == "index"
