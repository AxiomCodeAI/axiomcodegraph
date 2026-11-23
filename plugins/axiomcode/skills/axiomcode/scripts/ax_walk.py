"""ax_walk.py: which way a walk over the call graph follows a call edge. One definition, for every surface.

A call edge points from caller to callee. A walk FORWARD reaches what a declaration calls; a walk BACKWARD reaches
what calls it. A direction is a set of ways, so a new one (say, a type's implementers) is one more entry here, not a
new branch in each verb.

Its own module, with nothing imported, because the MCP server checks a direction before it runs the CLI (the CLI's
refusal names its flag, which the server's answer drops) and the context verb walks by it: a second list in either
would be one that drifts.
"""

FORWARD, BACKWARD = 'forward', 'backward'
DIRECTIONS = {'callees': {FORWARD}, 'callers': {BACKWARD}, 'both': {FORWARD, BACKWARD}}
DEFAULT_DIRECTION = 'both'
