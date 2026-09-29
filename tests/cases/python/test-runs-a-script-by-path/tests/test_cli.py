import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "scripts", "run_report.py")


def test_script_prints_the_report():
    out = subprocess.run([sys.executable, SCRIPT, "q3"], capture_output=True, text=True).stdout
    assert out.strip() == "report for q3"
