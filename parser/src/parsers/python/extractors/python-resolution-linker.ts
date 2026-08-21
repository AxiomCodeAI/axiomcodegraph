import {
  PyBindingRegistry,
  PyCallSiteRegistry,
  PyImportRegistry,
  PyMethodRegistry,
  PyScopeRegistry,
  PyTypeBaseRegistry,
  PyTypeRegistry,
} from '@/analysis-types/python';
import { PythonReceiverKind, PythonResolvedCalleeKind } from '@/enums/python/call-sites';
import { PythonImportTargetKind } from '@/enums/python/imports';
import { PythonMethodKind } from '@/enums/python/methods';

/** One module's facts, for the project-level pass. */
export interface ProjectModuleFacts extends ResolutionInput {
  qualifiedName: string;
  moduleHash: string;
}

export interface ProjectResolutionStats {
  importsResolved: number;
  callSitesResolved: number;
}

/** Everything the linker needs from one module's fact set. */
export interface ResolutionInput {
  scopes: PyScopeRegistry[];
  bindings: PyBindingRegistry[];
  types: PyTypeRegistry[];
  typeBases: PyTypeBaseRegistry[];
  methods: PyMethodRegistry[];
  imports: PyImportRegistry[];
  callSites: PyCallSiteRegistry[];
}

/**
 * Python builtins that are callable and shadow nothing by default.
 *
 * Recorded as `BUILTIN` with an EMPTY hash: there is no `py_method` row for a
 * builtin, so a hash would be a lie, but the kind is a real fact and strictly
 * better than `UNRESOLVED`. A name is only treated as a builtin when no local
 * binding shadows it, which is checked before this set is consulted.
 */
const CALLABLE_BUILTINS: ReadonlySet<string> = new Set([
  'abs', 'aiter', 'all', 'anext', 'any', 'ascii', 'bin', 'bool', 'breakpoint',
  'bytearray', 'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex',
  'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter',
  'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash',
  'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter',
  'len', 'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object',
  'oct', 'open', 'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed',
  'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum',
  'super', 'tuple', 'type', 'vars', 'zip',
]);

/**
 * Names whose presence on a class makes attribute lookup undecidable.
 *
 * A class defining `__getattr__` can answer for attributes that appear nowhere
 * in the source, so "no method of that name" is not a sound conclusion about it.
 */
const ATTRIBUTE_ESCAPE_HATCHES: ReadonlySet<string> = new Set([
  'HAS_GETATTR',
  'HAS_SETATTR',
]);

/**
 * Resolves the parser-local half of call-site and base-class linkage.
 *
 * ## The rule this implements
 *
 * `UNRESOLVED` is the honest default only where resolution is genuinely not
 * derivable. Where a **single** target follows from facts the parser already
 * emits, `UNRESOLVED` is not honesty — it is a dropped fact, and the engine
 * cannot recover it because the parser was the only place that information
 * existed.
 *
 * ## And the harder half: do not over-resolve
 *
 * Naive name-only dispatch measures 24.63 candidate classes per attribute call
 * and 1.22M candidate edges. At that fan-out every sink looks reachable and
 * downstream data flow is worthless. So a hash is emitted **only when exactly
 * one target is derivable**. Where several candidates exist the column stays
 * `UNRESOLVED` — a candidate is never emitted as though it were a resolution,
 * because widening this column's meaning would destroy the precision the whole
 * schema exists to protect.
 *
 * ## Order, cheapest and most certain first
 *
 * 1. A name bound in the enclosing scope chain to a `def` or `class`, via the
 *    `py_binding` rows and `declaringBindingLinkHash` already emitted.
 * 2. A name declared at module level in this module.
 * 3. `self.X` — a method of the enclosing class, then its local MRO.
 * 4. `super().X` and a class-qualified `Type.X` — walked through
 *    `py_type_base.resolvedTypeLinkHash`, which is why bases are resolved first.
 * 5. Builtins, when nothing local shadows the name.
 *
 * Cross-module resolution is deliberately absent here: it needs the module
 * graph, which only the project-level pass has.
 */
export class PythonResolutionLinker {
  /**
   * Cross-module resolution, run once after every module has been extracted.
   *
   * Separate from {@link link} because it needs the **module graph**, which a
   * single-file extraction does not have. Two steps, in order:
   *
   * 1. Resolve `py_import` rows to a module in this analysis, and then to the
   *    specific class or function they bind. `isExternalTarget` becomes an
   *    honest negative rather than a blanket true.
   * 2. Re-run call-site resolution with imported names now visible, so
   *    `build_pipeline(items)` reaches `helpers.build_pipeline` and
   *    `Child.of("x")` reaches `Base.of` through the imported class's own bases.
   *
   * Anything that does not resolve to a module inside this analysis stays
   * external and UNRESOLVED, which is what that column is for.
   */
  linkProject(modules: ProjectModuleFacts[]): ProjectResolutionStats {
    const stats: ProjectResolutionStats = { importsResolved: 0, callSitesResolved: 0 };

    const moduleByQualifiedName = new Map<string, ProjectModuleFacts>();
    for (const module of modules) {
      moduleByQualifiedName.set(module.qualifiedName, module);
    }

    // Module-level entities, per module, for import target lookup. A name maps to
    // an entity only when exactly one entity carries it.
    const exportsByModule = new Map<string, Map<string, PyMethodRegistry | PyTypeRegistry | null>>();
    for (const module of modules) {
      const exported = new Map<string, PyMethodRegistry | PyTypeRegistry | null>();
      const add = (name: string, entity: PyMethodRegistry | PyTypeRegistry) => {
        exported.set(name, exported.has(name) ? null : entity);
      };
      for (const type of module.types) {
        // Module-level classes only: a nested or function-local class is not part
        // of the module namespace and cannot be the target of a from-import.
        if (type.getEnclosingTypeLinkHash() === '' && type.getEnclosingMethodLinkHash() === '') {
          add(type.getName(), type);
        }
      }
      for (const method of module.methods) {
        // Module-level functions only: a method belongs to its class, not to the
        // module namespace.
        if (method.getPyTypeLinkHash() === '' && method.getMethodKind() === PythonMethodKind.FUNCTION) {
          add(method.getName(), method);
        }
      }
      exportsByModule.set(module.qualifiedName, exported);
    }

    // ---- step 1: imports
    /** binding PK -> the entity that import binds, when it resolves in-project. */
    const entityByImportBinding = new Map<string, PyMethodRegistry | PyTypeRegistry>();
    for (const module of modules) {
      for (const record of module.imports) {
        const targetName = this.importTargetModule(record, module.qualifiedName);
        const targetModule = targetName === null ? undefined : moduleByQualifiedName.get(targetName);
        if (!targetModule) {
          continue;
        }
        if (record.getIsWildcard()) {
          // A star import binds names we cannot enumerate. Recorded as a
          // soundness hole rather than expanded — expanding would invent
          // bindings symtable does not have.
          record.setResolution(targetModule.moduleHash, PythonImportTargetKind.MODULE, '');
          stats.importsResolved += 1;
          continue;
        }
        if (record.getIsModuleImport()) {
          record.setResolution(targetModule.moduleHash, PythonImportTargetKind.MODULE, '');
          stats.importsResolved += 1;
          continue;
        }
        const member = record.getOriginalName().split('.').pop() ?? '';
        const entity = exportsByModule.get(targetModule.qualifiedName)?.get(member);
        if (!entity) {
          // The module resolved but the member did not — it may be a variable, a
          // re-export, or genuinely absent. Module link only.
          record.setResolution(targetModule.moduleHash, PythonImportTargetKind.MODULE, '');
          stats.importsResolved += 1;
          continue;
        }
        const isType = entity instanceof PyTypeRegistry;
        record.setResolution(
          targetModule.moduleHash,
          isType ? PythonImportTargetKind.TYPE : PythonImportTargetKind.FUNCTION,
          entity.getHash()
        );
        stats.importsResolved += 1;
        const bindingHash = record.getBindingLinkHash();
        if (bindingHash !== '') {
          entityByImportBinding.set(bindingHash, entity);
        }
      }
    }

    // ---- step 2: call sites, with imported names now visible
    const allTypes = modules.flatMap(m => m.types);
    const allMethods = modules.flatMap(m => m.methods);
    const allTypeBases = modules.flatMap(m => m.typeBases);

    const typesByHash = new Map(allTypes.map(t => [t.getHash(), t]));
    const basesByType = new Map<string, PyTypeBaseRegistry[]>();
    for (const base of allTypeBases) {
      const list = basesByType.get(base.getPyTypeLinkHash()) ?? [];
      list.push(base);
      basesByType.set(base.getPyTypeLinkHash(), list);
    }
    const methodsByTypeAndName = new Map<string, PyMethodRegistry[]>();
    for (const method of allMethods) {
      const key = `${method.getPyTypeLinkHash()}::${method.getName()}`;
      const list = methodsByTypeAndName.get(key) ?? [];
      list.push(method);
      methodsByTypeAndName.set(key, list);
    }

    for (const module of modules) {
      const entityByBinding = new Map<string, PyMethodRegistry | PyTypeRegistry>();
      for (const method of module.methods) {
        if (method.getDeclaringBindingLinkHash() !== '') {
          entityByBinding.set(method.getDeclaringBindingLinkHash(), method);
        }
      }
      for (const type of module.types) {
        if (type.getDeclaringBindingLinkHash() !== '') {
          entityByBinding.set(type.getDeclaringBindingLinkHash(), type);
        }
      }
      // Imported names participate in the same scope-chain lookup as local defs.
      for (const [bindingHash, entity] of entityByImportBinding) {
        entityByBinding.set(bindingHash, entity);
      }

      const bindingByScopeAndName = new Map<string, PyBindingRegistry>();
      for (const binding of module.bindings) {
        bindingByScopeAndName.set(`${binding.getPyScopeLinkHash()}::${binding.getName()}`, binding);
      }
      const parentScopeOf = new Map<string, string>();
      for (const scope of module.scopes) {
        parentScopeOf.set(scope.getHash(), scope.getParentScopeLinkHash());
      }
      const boundNames = new Set(
        module.bindings.filter(b => b.isBound()).map(b => b.getName())
      );
      const importedModuleNames = new Set(
        module.imports.filter(i => i.getIsModuleImport()).map(i => i.getSimpleName())
      );

      // A NAME receiver may name an imported class, so the name->type map spans
      // local classes plus whatever this module imported.
      const typesByName = this.uniqueByName(module.types, t => t.getName());
      for (const record of module.imports) {
        const bindingHash = record.getBindingLinkHash();
        const entity = bindingHash === '' ? undefined : entityByImportBinding.get(bindingHash);
        if (entity instanceof PyTypeRegistry) {
          const bound = record.getSimpleName();
          typesByName.set(bound, typesByName.has(bound) ? null : entity);
        }
      }

      for (const callSite of module.callSites) {
        if (callSite.getResolvedCalleeKind() !== PythonResolvedCalleeKind.UNRESOLVED) {
          continue;
        }
        const target = this.resolveCallSite(callSite, {
          typesByHash,
          typesByName,
          basesByType,
          methodsByTypeAndName,
          entityByBinding,
          bindingByScopeAndName,
          parentScopeOf,
          boundNames,
          importedModuleNames,
        });
        if (target) {
          callSite.setResolvedCallee(target.kind, target.hash);
          stats.callSitesResolved += 1;
        }
      }
    }

    return stats;
  }

  /**
   * The absolute module name an import refers to, or `null` when it cannot be
   * determined.
   *
   * Relative imports are 38% of from-imports, so this is the common path rather
   * than an edge case. `from .helpers import x` inside `pkg.service` resolves
   * against `pkg`; each extra leading dot strips one more package level.
   */
  private importTargetModule(record: PyImportRegistry, importingModule: string): string | null {
    const level = record.getRelativeLevel();
    const stated = record.getIsModuleImport()
      ? record.getImportedPath()
      : record.getPackageOrTypeName();

    if (level === 0) {
      return stated === '' ? null : stated;
    }
    // The importing module's own package, then up (level - 1) more.
    const parts = importingModule.split('.');
    parts.pop();
    for (let i = 1; i < level; i++) {
      parts.pop();
    }
    const base = parts.join('.');
    if (stated === '') {
      return base === '' ? null : base;
    }
    return base === '' ? stated : `${base}.${stated}`;
  }

  /** Resolves within one module. Returns the number of call sites resolved. */
  link(input: ResolutionInput): number {
    const typesByHash = new Map(input.types.map(t => [t.getHash(), t]));
    const typesByName = this.uniqueByName(input.types, t => t.getName());

    // Bases first: MRO resolution depends on them.
    this.resolveTypeBases(input, typesByName);

    const basesByType = new Map<string, PyTypeBaseRegistry[]>();
    for (const base of input.typeBases) {
      const list = basesByType.get(base.getPyTypeLinkHash()) ?? [];
      list.push(base);
      basesByType.set(base.getPyTypeLinkHash(), list);
    }

    // name -> the single method of that name on a given type
    const methodsByTypeAndName = new Map<string, PyMethodRegistry[]>();
    for (const method of input.methods) {
      const key = `${method.getPyTypeLinkHash()}::${method.getName()}`;
      const list = methodsByTypeAndName.get(key) ?? [];
      list.push(method);
      methodsByTypeAndName.set(key, list);
    }

    // A binding's declared entity, so a lexically-bound name resolves to the
    // exact def or class that bound it rather than to a same-named lookalike.
    const entityByBinding = new Map<string, PyMethodRegistry | PyTypeRegistry>();
    for (const method of input.methods) {
      const binding = method.getDeclaringBindingLinkHash();
      if (binding !== '') {
        entityByBinding.set(binding, method);
      }
    }
    for (const type of input.types) {
      const binding = type.getDeclaringBindingLinkHash();
      if (binding !== '') {
        entityByBinding.set(binding, type);
      }
    }

    const bindingByScopeAndName = new Map<string, PyBindingRegistry>();
    for (const binding of input.bindings) {
      bindingByScopeAndName.set(`${binding.getPyScopeLinkHash()}::${binding.getName()}`, binding);
    }
    const parentScopeOf = new Map<string, string>();
    for (const scope of input.scopes) {
      parentScopeOf.set(scope.getHash(), scope.getParentScopeLinkHash());
    }
    // Names this module genuinely BINDS. A merely-referenced name is not a
    // shadow, so `sorted` stays a builtin unless the module really defines one.
    const boundNames = new Set(
      input.bindings.filter(b => b.isBound()).map(b => b.getName())
    );
    const importedModuleNames = new Set(
      input.imports.filter(i => i.getIsModuleImport()).map(i => i.getSimpleName())
    );

    let resolved = 0;
    for (const callSite of input.callSites) {
      const target = this.resolveCallSite(callSite, {
        typesByHash,
        typesByName,
        basesByType,
        methodsByTypeAndName,
        entityByBinding,
        bindingByScopeAndName,
        parentScopeOf,
        boundNames,
        importedModuleNames,
      });
      if (target) {
        callSite.setResolvedCallee(target.kind, target.hash);
        resolved += 1;
      }
    }
    return resolved;
  }

  /**
   * `py_type_base.resolvedTypeLinkHash` for bases naming a class in this module.
   *
   * Only a name-shaped base with exactly one same-named class in the module
   * resolves. A computed base (`class D(factory())`) or an ambiguous name does
   * not, which keeps `isResolvedLocally` meaning what it says.
   */
  private resolveTypeBases(
    input: ResolutionInput,
    typesByName: Map<string, PyTypeRegistry | null>
  ): void {
    for (const base of input.typeBases) {
      if (base.getKeywordName() !== '' || base.getIsDynamic()) {
        continue;
      }
      const simpleName = base.getBaseSimpleName();
      if (simpleName === '') {
        continue;
      }
      // A dotted base (`pkg.mod.Cls`) names something outside this module even
      // when its rightmost segment collides with a local class.
      const dotted = base.getBaseDottedPath();
      if (dotted.includes('.')) {
        continue;
      }
      const target = typesByName.get(simpleName);
      if (target && target.getHash() !== base.getPyTypeLinkHash()) {
        base.setResolution(target.getHash(), true);
      }
    }
  }

  private resolveCallSite(
    callSite: PyCallSiteRegistry,
    ctx: {
      typesByHash: Map<string, PyTypeRegistry>;
      typesByName: Map<string, PyTypeRegistry | null>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      methodsByTypeAndName: Map<string, PyMethodRegistry[]>;
      entityByBinding: Map<string, PyMethodRegistry | PyTypeRegistry>;
      bindingByScopeAndName: Map<string, PyBindingRegistry>;
      parentScopeOf: Map<string, string>;
      boundNames: Set<string>;
      importedModuleNames: Set<string>;
    }
  ): { kind: PythonResolvedCalleeKind; hash: string } | null {
    const name = callSite.getCalleeName();
    if (name === '') {
      return null;
    }

    switch (callSite.getReceiverKind()) {
      case PythonReceiverKind.NONE: {
        // A bare name: the scope chain decides, and it decides exactly.
        const entity = this.lookupInScopeChain(name, callSite.getPyScopeLinkHash(), ctx);
        if (entity) {
          return this.describeEntity(entity);
        }
        // Only a builtin if nothing in this module binds the name at all —
        // otherwise a local `def list(...)` would be mistaken for the builtin.
        if (!ctx.boundNames.has(name) && CALLABLE_BUILTINS.has(name)) {
          return { kind: PythonResolvedCalleeKind.BUILTIN, hash: '' };
        }
        return null;
      }

      case PythonReceiverKind.SELF:
      case PythonReceiverKind.CLS: {
        const owner = callSite.getPyTypeLinkHash();
        if (owner === '') {
          return null;
        }
        const method = this.lookupMethodOnTypeAndBases(owner, name, ctx);
        return method ? { kind: PythonResolvedCalleeKind.METHOD, hash: method.getHash() } : null;
      }

      case PythonReceiverKind.SUPER: {
        // `super()` starts AFTER the enclosing class in the MRO, so the
        // enclosing class's own method of that name is deliberately skipped —
        // that is the whole point of super() and why `Child.describe` calling
        // `super().describe()` must land on `Base.describe`, not itself.
        const owner = callSite.getPyTypeLinkHash();
        if (owner === '') {
          return null;
        }
        const method = this.lookupMethodOnBasesOnly(owner, name, ctx);
        return method ? { kind: PythonResolvedCalleeKind.METHOD, hash: method.getHash() } : null;
      }

      case PythonReceiverKind.NAME: {
        // A receiver that names a class in this module: `Base.make_default()`.
        // The method may be inherited, so the local MRO is walked.
        const receiver = callSite.getReceiverText();
        const type = receiver === '' ? null : ctx.typesByName.get(receiver);
        if (!type) {
          // A receiver naming an imported MODULE — `functools.wraps(...)`. The
          // target is outside this analysis, so no hash exists, but "reached
          // through an import" is a real fact and strictly better than silence.
          if (receiver !== '' && ctx.importedModuleNames.has(receiver)) {
            return { kind: PythonResolvedCalleeKind.IMPORTED, hash: '' };
          }
          return null;
        }
        const method = this.lookupMethodOnTypeAndBases(type.getHash(), name, ctx);
        return method ? { kind: PythonResolvedCalleeKind.METHOD, hash: method.getHash() } : null;
      }

      // An ATTRIBUTE or CALL_RESULT receiver needs the receiver's TYPE, which
      // comes from attribute typing (py_field) or return typing — both in the
      // deferred set. Left UNRESOLVED deliberately: guessing by name alone is
      // exactly the 24-candidate fan-out this column exists to avoid.
      default: {
        return null;
      }
    }
  }

  /**
   * Walks the scope chain for a name bound to a `def` or `class`.
   *
   * Uses the emitted `py_binding` rows and `declaringBindingLinkHash` rather
   * than a name match, so a nested `def inner` resolves to THAT `inner` and not
   * to another of the same name elsewhere in the module.
   */
  private lookupInScopeChain(
    name: string,
    scopeHash: string,
    ctx: {
      entityByBinding: Map<string, PyMethodRegistry | PyTypeRegistry>;
      bindingByScopeAndName: Map<string, PyBindingRegistry>;
      parentScopeOf: Map<string, string>;
    }
  ): PyMethodRegistry | PyTypeRegistry | null {
    let current: string | undefined = scopeHash;
    let guard = 0;
    while (current !== undefined && current !== '') {
      if (++guard > 200) {
        return null;
      }
      const binding = ctx.bindingByScopeAndName.get(`${current}::${name}`);
      // A binding row exists for any name a scope MENTIONS, including one it only
      // reads — symtable emits a GLOBAL_IMPLICIT Symbol for that. Only a row that
      // genuinely binds may stop the walk; otherwise the first mention of a
      // module-level function inside a nested scope looks like a shadow and halts
      // the lookup one scope too early. That single mistake limited resolution to
      // zero-hop lookups.
      if (binding?.isBound()) {
        // Bound here. A def or class gives an exact target; anything else
        // (parameter, import, plain variable) shadows any outer definition, so
        // the answer is "not derivable" rather than "keep looking".
        return ctx.entityByBinding.get(binding.getHash()) ?? null;
      }
      current = ctx.parentScopeOf.get(current);
    }
    return null;
  }

  /** The single method of this name on a type, or inherited through its bases. */
  private lookupMethodOnTypeAndBases(
    typeHash: string,
    name: string,
    ctx: {
      typesByHash: Map<string, PyTypeRegistry>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      methodsByTypeAndName: Map<string, PyMethodRegistry[]>;
    }
  ): PyMethodRegistry | null {
    const own = this.singleMethodOn(typeHash, name, ctx);
    if (own) {
      return own;
    }
    return this.lookupMethodOnBasesOnly(typeHash, name, ctx);
  }

  /**
   * Walks the resolved bases in MRO order, skipping the type itself.
   *
   * Depth-first in `position` order, which is C3's own starting order for
   * single inheritance and for the common multiple-inheritance shapes. If more
   * than one base offers the name, nothing is returned: that is a genuine
   * diamond ambiguity and picking one would be a guess.
   */
  private lookupMethodOnBasesOnly(
    typeHash: string,
    name: string,
    ctx: {
      typesByHash: Map<string, PyTypeRegistry>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      methodsByTypeAndName: Map<string, PyMethodRegistry[]>;
    }
  ): PyMethodRegistry | null {
    const type = ctx.typesByHash.get(typeHash);
    if (type && this.hasEscapeHatch(type)) {
      // __getattr__ can answer for anything, so absence proves nothing and
      // presence is not exclusive.
      return null;
    }

    const bases = [...(ctx.basesByType.get(typeHash) ?? [])]
      .filter(b => b.getKeywordName() === '' && b.getIsResolvedLocally())
      .sort((a, b) => Number(a.getPosition()) - Number(b.getPosition()));

    // An unresolved base means the chain is incomplete: a method might exist
    // out there that we cannot see, so a hit further down is not provably THE
    // target. Only claim a resolution when every base is accounted for.
    const allBasesResolved = (ctx.basesByType.get(typeHash) ?? [])
      .filter(b => b.getKeywordName() === '')
      .every(b => b.getIsResolvedLocally());
    if (!allBasesResolved) {
      return null;
    }

    const found: PyMethodRegistry[] = [];
    for (const base of bases) {
      const baseHash = base.getResolvedTypeLinkHash();
      const direct = this.singleMethodOn(baseHash, name, ctx);
      if (direct) {
        found.push(direct);
        continue;
      }
      const inherited = this.lookupMethodOnBasesOnly(baseHash, name, ctx);
      if (inherited) {
        found.push(inherited);
      }
    }
    // Depth-first, position order: the first base that offers the name wins,
    // which is what C3 does when the bases are unrelated. Two DIFFERENT targets
    // from two bases is a real ambiguity, so nothing is claimed.
    const distinct = new Set(found.map(m => m.getHash()));
    if (distinct.size !== 1) {
      return found.length > 0 && distinct.size > 1 ? null : null;
    }
    return found[0] ?? null;
  }

  /**
   * The one method of this name declared directly on a type.
   *
   * `@overload` stubs are excluded: the schema says they are declarations and
   * must never be call targets, so a name with two overload stubs and one real
   * implementation resolves to the implementation rather than being treated as
   * ambiguous.
   */
  private singleMethodOn(
    typeHash: string,
    name: string,
    ctx: { methodsByTypeAndName: Map<string, PyMethodRegistry[]> }
  ): PyMethodRegistry | null {
    const candidates = (ctx.methodsByTypeAndName.get(`${typeHash}::${name}`) ?? []).filter(
      m =>
        m.getMethodKind() !== PythonMethodKind.OVERLOAD_STUB &&
        !m.getBodyIsStub() &&
        // A function nested inside a method is not reachable as `self.name`,
        // even though it carries the enclosing class in pyTypeLinkHash.
        m.isClassBodyMember()
    );
    return candidates.length === 1 ? candidates[0]! : null;
  }

  private hasEscapeHatch(type: PyTypeRegistry): boolean {
    for (const modifier of type.getModifiers()) {
      if (ATTRIBUTE_ESCAPE_HATCHES.has(modifier)) {
        return true;
      }
    }
    return false;
  }

  private describeEntity(
    entity: PyMethodRegistry | PyTypeRegistry
  ): { kind: PythonResolvedCalleeKind; hash: string } {
    if (entity instanceof PyTypeRegistry) {
      // Calling a class constructs an instance of it.
      return { kind: PythonResolvedCalleeKind.TYPE, hash: entity.getHash() };
    }
    // A nested def is a plain function, not a bound method, even though it
    // records the class it is lexically inside.
    return {
      kind: entity.isClassBodyMember()
        ? PythonResolvedCalleeKind.METHOD
        : PythonResolvedCalleeKind.MODULE_FUNCTION,
      hash: entity.getHash(),
    };
  }

  /** A name maps to an entity only when exactly one entity carries that name. */
  private uniqueByName<T>(items: T[], nameOf: (item: T) => string): Map<string, T | null> {
    const byName = new Map<string, T | null>();
    for (const item of items) {
      const name = nameOf(item);
      byName.set(name, byName.has(name) ? null : item);
    }
    return byName;
  }
}
