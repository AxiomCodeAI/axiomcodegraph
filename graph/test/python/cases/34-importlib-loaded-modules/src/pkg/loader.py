import importlib
import importlib.util
import os
from importlib.machinery import SourceFileLoader

HERE = os.path.dirname(os.path.abspath(__file__))

# spec_from_file_location + module_from_spec + exec_module, the path a literal file name
_spec = importlib.util.spec_from_file_location('graph_core', os.path.join(HERE, 'graph-core.py'))
core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(core)
G, H = core.G, core.H

# spec_from_loader over a SourceFileLoader
_tspec = importlib.util.spec_from_loader('tools_mod', SourceFileLoader('tools_mod', os.path.join(HERE, 'tools-mod.py')))
tools = importlib.util.module_from_spec(_tspec); _tspec.loader.exec_module(tools)

# import_module with a literal dotted name
named = importlib.import_module('pkg.named')

# CONTROL: the name is not a literal, so which module it is cannot be known
which = os.environ.get('WHICH', 'pkg.other')
dyn = importlib.import_module(which)

# CONTROL: a literal path that names no file beside this one
_mspec = importlib.util.spec_from_file_location('missing', os.path.join(HERE, 'no-such-file.py'))
missing = importlib.util.module_from_spec(_mspec)


class Changed:
    # the receiver is an attribute assigned from a class the loaded module declares
    def __init__(self, repo):
        self.g = G(repo); self.repo = self.g.repo

    def file_changes(self):
        return self.g.lambda_label(1)


class Impact:
    # an annotated parameter whose annotation is that same module-level alias
    def __init__(self, g: G):
        self.g = g

    def show(self):
        return self.g.lambda_label(2)


class Rebound:
    # CONTROL: the attribute is reassigned to a different type, so the call stays a set
    def __init__(self, repo):
        self.g = G(repo)

    def swap(self):
        self.g = H()

    def show(self):
        return self.g.lambda_label(3)


class UsesTools:
    def __init__(self):
        self.t = tools.Tool()
        self.u = tools.make_tool()

    def go(self):
        return self.t.run()


def use_named():
    return named.helper(), named.Named().ping()


def use_dyn():
    return dyn.helper()


def use_missing():
    return missing.helper()



def use_core_directly():
    return core.G(0).lambda_label(0)


# CONTROL: a starred target is not paired by position, so neither name is typed from it
*RestK, LastK = core.H, core.G


def use_starred():
    return LastK(0).lambda_label(0)
