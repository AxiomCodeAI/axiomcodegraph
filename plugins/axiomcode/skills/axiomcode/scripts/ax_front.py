#!/usr/bin/env python3
"""ax_front.py — what an answer at the front door may say: the four questions and index, never an option.

At the front door (the installed `axiomcode`, the skill's own entry and the MCP tools, asked with no flag; the
dispatcher sets AXIOMCODE_FRONT_ANSWER) there are no options to pass and only find, impact, path, tests and index to
ask. The notes the verbs and the refresher add (a stale graph, a refresh in flight, a page left) were written for the
full command and named --fresh, --no-refresh, --in, --page, test-impact and context. plain() keeps what each note says
and drops the clause that tells the reader to pass an option; a verb that has a front-door name is called by it.
Code blocks are the file's own text and are never touched. The MCP server's own filter (server.py `plain`) does the
same for its answers; this one is for the shell.
"""
import os, re

# an option to pass, a parameter to set, an environment variable to export
OPTION = re.compile(r"(?<![\w-])--[a-z][a-z-]*|\b[a-z_]+=(?:True|False|N\b|<|\d|\"|')|\bAXIOMCODE_[A-Z_]+\b|\bMCP [a-z_]+=")
# a verb of the full command, as the front door asks it
VERB = [(re.compile(r'`(axiomcode )?test-impact(`| )'), r'`\1tests\2'), (re.compile(r'\btest-impact\b'), 'tests'),
        (re.compile(r'`(axiomcode )?context '), r'`\1find '), (re.compile(r'`(axiomcode )?context`'), r'`\1find`'),
        (re.compile(r'`(axiomcode )?changed`'), r'`\1impact`')]
# a verb the front door does not have: a clause that sends the reader there is dropped
GONE = re.compile(r'`(axiomcode )?(changed|graph|diff|install|context)\b[^`]*`')


def active():
    return bool(os.environ.get('AXIOMCODE_FRONT_ANSWER'))


def line(text):
    for rx, to in VERB: text = rx.sub(to, text)
    bad = lambda c: OPTION.search(c) or GONE.search(c)
    if not bad(text): return text
    # a parenthesis that names an option goes, with the space before it
    prev = None
    while prev != text:
        prev = text; text = re.sub(r'\s*\(([^()]*)\)', lambda m: '' if bad(m.group(1)) else m.group(0), text)
    # then each clause (cut at `; `, ` — ` and a sentence end, the cuts kept) that still names one
    parts = re.split(r'(;\s+|\s+—\s+|(?<=\.)\s+)', text)
    out = ''
    for i in range(0, len(parts), 2):
        c = parts[i]
        if bad(c): continue
        out += (parts[i - 1] if i and out else '') + c
    return out.rstrip(' ;,—')


def plain(text):
    out = []; code = False
    for l in (text or '').split('\n'):
        if l.strip().startswith('```'): code = not code; out.append(l); continue
        if code: out.append(l); continue
        p = line(l)
        if p.strip() or not l.strip(): out.append(p)
    return '\n'.join(out)


class Plain:
    """a text stream whose every line is written through plain(): what the refresher prints on stderr before the answer"""
    def __init__(self, raw): self.raw, self.buf, self.code = raw, '', False
    def write(self, s):
        self.buf += s
        while '\n' in self.buf:
            l, self.buf = self.buf.split('\n', 1)
            if l.strip().startswith('```'): self.code = not self.code; self.raw.write(l + '\n'); continue
            if self.code: self.raw.write(l + '\n'); continue                 # a code block is the file's own text
            p = line(l)
            if p.strip() or not l.strip(): self.raw.write(p + '\n')
        return len(s)
    def flush(self):
        if self.buf: p = line(self.buf); self.buf = ''; p and self.raw.write(p)
        self.raw.flush()
    def __getattr__(self, k): return getattr(self.raw, k)
