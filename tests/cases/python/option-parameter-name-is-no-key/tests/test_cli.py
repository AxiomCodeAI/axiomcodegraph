from cli import main


def test_level_flag():
    args = ["--level", "2"]
    assert main(int(args[1])) == 2
