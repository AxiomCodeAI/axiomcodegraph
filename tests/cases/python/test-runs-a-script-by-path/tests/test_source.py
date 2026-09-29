import os

HERE = os.path.dirname(os.path.abspath(__file__))


def test_script_is_executable_text():
    with open(os.path.join(HERE, "..", "scripts", "run_report.py")) as fh:
        assert "def main" in fh.read()
