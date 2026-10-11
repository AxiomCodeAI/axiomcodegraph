USAGE = "run it with: python -m pkg"


def test_usage_mentions_the_module():
    assert "-m pkg" in USAGE
