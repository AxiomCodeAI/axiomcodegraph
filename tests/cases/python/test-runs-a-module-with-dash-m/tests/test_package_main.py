import subprocess
import sys


def test_module_runs():
    out = subprocess.run([sys.executable, "-m", "pkg", "--help"], capture_output=True, text=True).stdout
    assert out
