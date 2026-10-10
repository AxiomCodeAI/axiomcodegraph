#!/usr/bin/env python3
"""Generate the scale suite's site: N pages sharing S stylesheets with R rules in all.

  gen_scale.py <out-dir> [--pages N] [--rules R] [--sheets S]

Deterministic (no randomness): page i carries classes c<i%97>, c<i%89> ...; rule j selects
.c<j%97> .k<j> or a type/attribute shape, so most rules match nothing and a few match many
elements, as on a real admin template whose vendor sheet dwarfs any one page.
"""
import argparse
import os

ap = argparse.ArgumentParser()
ap.add_argument('out')
ap.add_argument('--pages', type=int, default=2000)
ap.add_argument('--rules', type=int, default=50000)
ap.add_argument('--sheets', type=int, default=10)
a = ap.parse_args()
os.makedirs(os.path.join(a.out, 'css'), exist_ok=True)
os.makedirs(os.path.join(a.out, 'pages'), exist_ok=True)
per = a.rules // a.sheets
for s in range(a.sheets):
    with open(os.path.join(a.out, 'css', f's{s}.css'), 'w') as f:
        for j in range(s * per, (s + 1) * per):
            shape = j % 5
            if shape == 0:
                f.write(f'.c{j % 97} .k{j} {{ margin: {j % 13}px; color: var(--v{j % 11}); }}\n')
            elif shape == 1:
                f.write(f'.c{j % 89} > li:nth-child({j % 7 + 1}) {{ padding: 1px; }}\n')
            elif shape == 2:
                f.write(f'[data-i="{j % 50}"] {{ --v{j % 11}: {j}; }}\n')
            elif shape == 3:
                f.write(f'@media (min-width: {j % 1200}px) {{ .c{j % 97}:hover {{ opacity: .5; }} }}\n')
            else:
                f.write(f'section.c{j % 89} p + p, .k{j} {{ line-height: 1.{j % 9}; }}\n')
for i in range(a.pages):
    links = ''.join(f'<link rel="stylesheet" href="../css/s{(i + k) % a.sheets}.css">' for k in range(2))
    items = ''.join(f'<li class="k{i * 3 + n}">{n}</li>' for n in range(8))
    body = (f'<section class="c{i % 97} c{i % 89}"><ul class="c{i % 89}" data-i="{i % 50}">{items}</ul>'
            f'<p>a</p><p>b</p><a href="p{(i + 1) % a.pages}.html">next</a></section>')
    with open(os.path.join(a.out, 'pages', f'p{i}.html'), 'w') as f:
        f.write(f'<!doctype html>\n<html>\n<head>{links}</head>\n<body>\n{body}\n</body>\n</html>\n')
print(f'{a.pages} pages, {a.rules} rules in {a.sheets} sheets -> {a.out}')
