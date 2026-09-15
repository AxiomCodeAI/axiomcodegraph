#!/usr/bin/env python3
"""Append one skill invocation to <repo>/.axiomcode/queries.jsonl: the tool, its arguments, and every
file path its output mentioned. The enforcement hook reads this — an edit to a file is allowed once a
graph query has named that file, so the record has to come from the skill's own output, not from the
agent's say-so.   usage: _log_query.py <tool> <args...> < output"""
import sys, json, re, os, time
tool, args = sys.argv[1], sys.argv[2:]
out = sys.stdin.read()
files = sorted(set(re.findall(r'(?<![\w/])((?:[\w.-]+/)*[\w.-]+\.(?:py|java|ts|tsx|js|jsx|kt|scala|go|rs|rb|php))(?=[:\s\]\)|,]|$)', out)))
root = os.environ.get('AXIOMCODE_GRAPH') or os.path.join(os.getcwd(), '.axiomcode')
os.makedirs(root, exist_ok=True)
with open(os.path.join(root, 'queries.jsonl'), 'a') as f:
    f.write(json.dumps(dict(t=time.time(), tool=tool, args=args, files=files, rows=out.count('\n'))) + '\n')
sys.stdout.write(out)
