"""ax_orphan.py: is the axiomcode running here an orphaned older install? One check, for every long-running path.

An agent session started before an upgrade keeps running the OLD version's MCP server and hooks. A plugin manager that
keeps one directory per version marks the one it replaced with `.orphaned_at` (and deletes its files later); a process
still running out of it is an older axiomcode, and what it wrote into a repository's .axiomcode was the older version's:
it rebuilt the graph back to its own engine after the new one had rebuilt it, every rebuild undoing the last, and it
recreated .axiomcode (its refresh.log, refresh.json) while the user was deleting it, so `rm -rf .axiomcode` failed with
"Directory not empty". So every path that writes there without being asked to (the refresher, the hooks, the MCP server
and its timer, a query's background build) asks orphaned() first, and an orphaned install writes nothing and starts
nothing: the MCP server stops, a hook and a query say so instead.

Its own module, with nothing but os and json, because every hook asks it before anything else: importing ax_fresh for it
cost a hook 20-100 ms on every tool call."""
import json, os

H = os.path.dirname(os.path.abspath(__file__))
ORPHAN_MARK = '.orphaned_at'

def install_dir(scripts=None):
    """the plugin directory a scripts directory belongs to (<plugin>/skills/axiomcode/scripts), these scripts' by default"""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(scripts or H))))

def _install_version(root):
    try: return str(json.load(open(os.path.join(root, '.claude-plugin', 'plugin.json'), encoding='utf-8')).get('version') or '')
    except (OSError, ValueError, AttributeError): pass
    b = os.path.basename(os.path.normpath(root))                    # a versioned plugin cache: <cache>/<marketplace>/<plugin>/<version>
    return b if all(x.isdigit() for x in b.split('.')) else ''

def orphaned(root=None):
    """'' while the install is current, else one line saying this is an orphaned older axiomcode and the agent session
    is to be restarted. root: the plugin directory to judge (the MCP server passes the one it resolved); by default the
    one these scripts belong to. Orphaned: the plugin directory carries ORPHAN_MARK, or its scripts are gone"""
    if root:
        root = os.path.abspath(root)
        gone = not os.path.isfile(os.path.join(root, 'skills', 'axiomcode', 'scripts', 'ax_fresh.py'))
    else:
        # these scripts' own file is what is checked for "gone": an engine that lays them out differently is never orphaned
        root = install_dir(); gone = not os.path.isfile(os.path.join(H, 'ax_fresh.py'))
    if os.path.lexists(os.path.join(root, ORPHAN_MARK)):
        why = f"{root} is marked {ORPHAN_MARK}: a newer version was installed in its place"
    elif gone: why = f"its install directory {root} is gone: a newer version was installed in its place"
    else: return ''
    v = _install_version(root)
    return (f"this is an orphaned older axiomcode{' ' + v if v else ''} ({why}), still running in an agent session started "
            "before the upgrade; it writes nothing into the repository's .axiomcode and rebuilds nothing. Restart the agent "
            "session so that only the installed axiomcode runs")
