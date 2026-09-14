#!/usr/bin/env python3
"""Score the engine's bean/DI model against a LIVE SPRING CONTEXT.

The oracle (tools/spring_oracle.sh -> spring-oracle/DumpContext.java) is Spring's own
answer, produced by a different toolchain. This compares it to what the engine derived
and prints precision/recall PER MECHANISM — an aggregate would hide which one is broken.

  beans         bean_def          (beanName, class)  vs Spring's getBeanDefinitionNames()
  field_inject  di_edge/known_bean(site, beanName)   vs the object actually in the field
  ctor_inject   di_edge/known_bean(site, beanName)   vs the object Spring passed the ctor
  factory_param di_edge/known_bean(site, beanName)   vs what Spring passed a @Bean method
  value_keys    config_binding    (site, key)        vs the @Value strings Spring saw

A COMMITTED engine answer that Spring contradicts is a false positive. An engine answer
of "several candidates" (multi_bean) where Spring committed is NOT scored as wrong — it
is scored as a RECALL miss, because the sound superset is a legitimate answer that just
carries less information. Both numbers are printed, so trading one for the other is
visible rather than hidden.

usage: spring_oracle_diff.py <oracle.tsv> <IR-dir> <OUT-dir>
exit 0 always — this is a REPORT; run-tests.sh pins the report itself as a golden.
"""
import csv, os, sys
csv.field_size_limit(10**9)   # an IR literalValue can be a base64 asset; see test/tools/csv-limit-test.sh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_edges import rows


def strip_proxy(cn):
    """Spring hands back a CGLIB subclass for @Configuration classes; the bean's
    real type is the class it was generated from."""
    for marker in ('$$SpringCGLIB$$', '$$EnhancerBySpringCGLIB$$', '$HibernateProxy$'):
        if marker in cn:
            cn = cn.split(marker)[0]
    return cn


def load_csv(p):
    if not os.path.exists(p):
        return []
    with open(p, newline='', encoding='utf-8', errors='replace') as f:
        return [r for r in csv.reader(f, delimiter='\t', quoting=csv.QUOTE_NONE) if r]


def score(name, got, want):
    tp = len(got & want)
    prec = tp / len(got) if got else (1.0 if not want else 0.0)
    rec = tp / len(want) if want else 1.0
    print(f"{name:<14} precision {prec:.3f}  recall {rec:.3f}"
          f"   (engine {len(got)}, spring {len(want)}, agree {tp})")
    for x in sorted(want - got):
        print(f"    MISS  {x}")
    for x in sorted(got - want):
        print(f"    FALSE {x}")
    return prec, rec


def main():
    oracle_path, ir, out = sys.argv[1], sys.argv[2], sys.argv[3]

    types = {t['typeRegistryUniqueHash']: t['qualifiedName'] for t in rows(f'{ir}/all-types.csv')}
    fields = {}
    for r in rows(f'{ir}/all-fields.csv'):
        owner = r.get('ownerQualifiedName') or r.get('ownerTypeName') or '?'
        fields[r['fieldRegistryUniqueHash']] = f"{owner}#{r['name']}"
    methods = {m['methodRegistryUniqueHash']: m for m in rows(f'{ir}/all-methods.csv')}
    # Spring's reflection reports parameters as arg0, arg1, … unless the class was
    # compiled with -parameters, so POSITION is the only stable key. A constructor
    # parameter keys on the owning CLASS; a @Bean method parameter keys on the class
    # AND the method, because one @Configuration class has many factory methods.
    ctor_params, factory_params = {}, {}
    for p in rows(f'{ir}/all-method-parameters.csv'):
        m = methods.get(p['methodRegistryLinkHash'])
        if not m:
            continue
        owner = m.get('ownerQualifiedName') or m.get('ownerTypeName') or '?'
        pos = p.get('position', '0')
        ctor_params[p['methodParameterUniqueHash']] = f"{owner}#arg{pos}"
        factory_params[p['methodParameterUniqueHash']] = f"{owner}#{m.get('name')}#arg{pos}"

    # ── the oracle ───────────────────────────────────────────────────────────
    o_beans, o_field, o_ctor, o_fact, o_value = set(), set(), set(), set(), set()
    for line in open(oracle_path, encoding='utf-8'):
        f = line.rstrip('\n').split('\t')
        if f[0] == 'BEAN':
            o_beans.add((f[1], strip_proxy(f[2])))
        elif f[0] == 'INJECT':
            o_field.add((f[1], f[2]))
        elif f[0] == 'CTORP':
            o_ctor.add((f[1], f[2]))
        elif f[0] == 'FACTP':
            o_fact.add((f[1], f[2]))
        elif f[0] == 'VALUE':
            o_value.add((f[1], f[2]))

    # ── the engine ───────────────────────────────────────────────────────────
    e_beans = {(r[0], types.get(r[1], r[1])) for r in load_csv(f'{out}/config-bean-def.csv')}
    e_field, e_ctor, e_fact, e_multi = set(), set(), set(), set()
    for r in load_csv(f'{out}/config-di-edge.csv'):
        site, kind, _dt, bean, _bt, status = r[0], r[1], r[2], r[3], r[4], r[5]
        if status == 'known_bean':
            if kind == 'field' and site in fields:
                e_field.add((fields[site], bean))
            elif kind == 'ctor_param' and site in ctor_params:
                e_ctor.add((ctor_params[site], bean))
            elif kind == 'factory_param' and site in factory_params:
                e_fact.add((factory_params[site], bean))
        elif status == 'multi_bean':
            e_multi.add(fields.get(site, ctor_params.get(site, site)))

    e_value = set()
    for r in load_csv(f'{out}/config-binding.csv'):
        key, mech, tkind, target = r[0], r[1], r[2], r[3]
        if mech == 'value_annotation' and tkind == 'field' and target in fields:
            e_value.add((fields[target], '${' + key + '}'))

    print("── validated against a LIVE SPRING CONTEXT (independent toolchain) ──")
    score("beans", e_beans, o_beans)
    score("field_inject", e_field, o_field)
    score("ctor_inject", e_ctor, o_ctor)
    score("factory_param", e_fact, o_fact)
    # @Value strings carry defaults (${k:d}); compare on the KEY only.
    score("value_keys",
          {(s, v.split(':')[0] + '}' if ':' in v else v) for s, v in e_value},
          {(s, v.split(':')[0] + '}' if ':' in v else v) for s, v in o_value})
    if e_multi:
        print(f"uncommitted    {len(e_multi)} injection point(s) left as multi_bean "
              f"(sound superset, counted as a recall miss above)")
        for x in sorted(e_multi):
            print(f"    MULTI {x}")


if __name__ == '__main__':
    main()
