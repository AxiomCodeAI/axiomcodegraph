import subprocess
import sys

CMD = [sys.executable, "-m", "coverage", "run", "-m", "pkg.tool"]


def test_tool_runs():
    assert subprocess.run(CMD, capture_output=True).returncode == 0
