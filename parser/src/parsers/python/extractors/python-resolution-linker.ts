import {
  PyBindingRegistry,
  PyCallSiteRegistry,
  PyExpressionRegistry,
  PyImportRegistry,
  PyMethodParameterRegistry,
  PyMethodRegistry,
  PyScopeRegistry,
  PyTypeBaseRegistry,
  PyTypeRegistry,
} from '@/analysis-types/python';
import { PythonReceiverKind, PythonResolvedCalleeKind } from '@/enums/python/call-sites';
import {
  PythonExpressionKind,
  PythonReferencedEntityKind,
} from '@/enums/python/expressions';
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

/** Shared lookup context for MRO-based resolution, with the MRO memoised. */
interface MroContext {
  typesByHash: Map<string, PyTypeRegistry>;
  basesByType: Map<string, PyTypeBaseRegistry[]>;
  methodsByTypeAndName: Map<string, PyMethodRegistry[]>;
  /** typeHash -> its C3 linearisation, or null when it cannot be computed. */
  mroCache: Map<string, string[] | null>;
}

/** Everything the linker needs from one module's fact set. */
export interface ResolutionInput {
  scopes: PyScopeRegistry[];
  bindings: PyBindingRegistry[];
  types: PyTypeRegistry[];
  typeBases: PyTypeBaseRegistry[];
  methods: PyMethodRegistry[];
  methodParameters: PyMethodParameterRegistry[];
  imports: PyImportRegistry[];
  callSites: PyCallSiteRegistry[];
  expressions: PyExpressionRegistry[];
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
 * Names whose presence on a class makes a NEGATIVE attribute conclusion unsound.
 *
 * A class defining `__getattr__` can answer for attributes that appear nowhere
 * in the source, so "no method of that name" proves nothing about it. It does
 * NOT undermine a positive finding: `__getattr__` is consulted only after normal
 * lookup fails, so an explicitly declared method always wins. (`__getattribute__`
 * does intercept unconditionally; the schema's position is to MARK that on the
 * type via HAS_GETATTR rather than redesign around it, and the engine can act on
 * the marker.)
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
        let targetModule =
          targetName === null ? undefined : this.findModule(targetName, moduleByQualifiedName);

        // `from . import protocols` and `from pkg import submodule` bind a
        // MODULE, not a member of one. Without this the target is looked for as a
        // class or function inside the package and never found — and because
        // sibling references are then unresolvable, every base spelled
        // `protocols.Protocol` stays unresolved too, which in turn blocks super()
        // and self.X resolution on those classes. It cascades from one missing
        // case, which is why it accounted for the largest single bucket.
        if (!record.getIsModuleImport() && !record.getIsWildcard()) {
          const member = record.getOriginalName().split('.').pop() ?? '';
          const asModule = targetName === null || targetName === ''
            ? member
            : `${targetName}.${member}`;
          const memberModule = this.findModule(asModule, moduleByQualifiedName);
          if (memberModule) {
            record.setResolution(memberModule.moduleHash, PythonImportTargetKind.MODULE, '');
            stats.importsResolved += 1;
            continue;
          }
        }

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

    // ---- step 2: bases, now that imports are resolved
    // Per-module views of what each module's imports brought into scope.
    const importedTypeByName = new Map<string, Map<string, PyTypeRegistry | null>>();
    const importedModuleByName = new Map<string, Map<string, ProjectModuleFacts>>();
    for (const module of modules) {
      const types = new Map<string, PyTypeRegistry | null>();
      const mods = new Map<string, ProjectModuleFacts>();
      for (const record of module.imports) {
        const bindingHash = record.getBindingLinkHash();
        const entity = bindingHash === '' ? undefined : entityByImportBinding.get(bindingHash);
        if (entity instanceof PyTypeRegistry) {
          const bound = record.getSimpleName();
          types.set(bound, types.has(bound) ? null : entity);
        }
        if (record.getResolvedTargetKind() === PythonImportTargetKind.MODULE) {
          // The bound name refers to a module. Find which one by matching the
          // resolved module hash, so `from . import protocols` and
          // `import pkg.protocols` are handled by the same lookup.
          const target = modules.find(m => m.moduleHash === record.getResolvedModuleLinkHash());
          if (target) {
            mods.set(record.getSimpleName(), target);
          }
        }
      }
      importedTypeByName.set(module.qualifiedName, types);
      importedModuleByName.set(module.qualifiedName, mods);
    }

    for (const module of modules) {
      const localTypes = this.uniqueByName(module.types, t => t.getName());
      const imported = importedTypeByName.get(module.qualifiedName)!;
      const importedModules = importedModuleByName.get(module.qualifiedName)!;
      for (const base of module.typeBases) {
        if (
          base.getKeywordName() !== '' ||
          base.getIsDynamic() ||
          base.getIsResolvedLocally()
        ) {
          continue;
        }
        const simpleName = base.getBaseSimpleName();
        if (simpleName === '') {
          continue;
        }
        const dotted = base.getBaseDottedPath();
        if (dotted.includes('.')) {
          // A dotted base such as `protocols.Protocol`: the leading segment names
          // a module. In a package this is the ordinary way to reference a
          // sibling, so skipping dotted bases — correct for a single-module pass,
          // since the prefix is meaningless there — loses most of them. 44 of 60
          // unresolved bases in asyncio are exactly this shape.
          const prefix = dotted.slice(0, dotted.lastIndexOf('.'));
          const targetModule = importedModules.get(prefix.split('.')[0]!);
          if (!targetModule) {
            continue;
          }
          const candidates = targetModule.types.filter(
            t =>
              t.getName() === simpleName &&
              t.getEnclosingTypeLinkHash() === '' &&
              t.getEnclosingMethodLinkHash() === ''
          );
          if (candidates.length === 1) {
            base.setResolution(candidates[0]!.getHash(), true);
          }
          continue;
        }
        // A bare name: local first, then whatever an import bound.
        const target = localTypes.get(simpleName) ?? imported.get(simpleName);
        if (target && target.getHash() !== base.getPyTypeLinkHash()) {
          base.setResolution(target.getHash(), true);
        }
      }
    }

    // ---- step 3: call sites, with imported names now visible
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

    // One cache for the whole project: an MRO does not change per module.
    const mroCache = new Map<string, string[] | null>();

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

      // Annotations get a second pass too: `a: CustomTypeA` where CustomTypeA is
      // imported can only resolve once the import graph exists.
      this.resolveAnnotations(module, typesByName);
      this.linkNameReferences(module, {
        entityByBinding,
        bindingByScopeAndName,
        parentScopeOf,
      });

      for (const callSite of module.callSites) {
        if (callSite.getResolvedCalleeKind() !== PythonResolvedCalleeKind.UNRESOLVED) {
          continue;
        }
        const target = this.resolveCallSite(callSite, {
          typesByHash,
          typesByName,
          basesByType,
          methodsByTypeAndName,
          mroCache,
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
   * Links every NAME REFERENCE to the entity it names.
   *
   * This is what makes a *use* of a type reach the type's hash — the job Java's
   * `java_type_reference` does. `py_type_reference` is in the deferred eleven, so
   * until it lands `py_expression.referencedEntityKind` / `referencedEntityHash`
   * (frozen columns c14/c15) are where that link lives, and leaving them empty
   * forced the engine to re-derive names from text.
   *
   * It matters most for NESTED annotations. `y: Optional[CustomTypeB]` resolves
   * its BASE to `Optional`, which is external, so `potentialQualifiedName` is
   * legitimately empty — but the inner `CustomTypeB` is a NAME_REFERENCE in the
   * annotation subtree, and this gives it a direct FK to `models.CustomTypeB`.
   * Going through `bindingLinkHash` instead does not work from inside a class or
   * method: the binding there is the LOCAL reference row, not the module-level
   * import that defined the name, so the join dead-ends exactly where it is most
   * needed.
   */
  private linkNameReferences(
    input: ResolutionInput,
    ctx: {
      entityByBinding: Map<string, PyMethodRegistry | PyTypeRegistry>;
      bindingByScopeAndName: Map<string, PyBindingRegistry>;
      parentScopeOf: Map<string, string>;
    }
  ): void {
    for (const expression of input.expressions) {
      if (expression.getKind() !== PythonExpressionKind.NAME_REFERENCE) {
        continue;
      }
      if (expression.getReferencedEntityHash() !== '') {
        continue;
      }
      const name = expression.getLiteralValue();
      if (name === '') {
        continue;
      }
      const entity = this.lookupInScopeChain(name, expression.getPyScopeLinkHash(), ctx);
      if (!entity) {
        continue;
      }
      const described = this.describeEntity(entity);
      expression.setReferencedEntity(
        described.kind === PythonResolvedCalleeKind.TYPE
          ? PythonReferencedEntityKind.TYPE
          : PythonReferencedEntityKind.METHOD,
        described.hash
      );
    }
  }

  /**
   * Resolves annotation text to an in-project type, filling
   * `potentialQualifiedName` on parameters and bindings.
   *
   * These are spine columns that exist for exactly this, and leaving them empty
   * is the same defect as an UNRESOLVED call site: the answer is derivable and
   * the engine cannot recover it, because re-deriving a type from annotation
   * TEXT is precisely what the schema forbids it to do.
   *
   * Resolution is on the annotation's BASE name — `Optional[CustomTypeB]`
   * resolves `Optional` — which matches `declaredBaseType`'s stated meaning and
   * Java's behaviour for `List<String>`. The inner type is not lost: the
   * annotation is also emitted as a py_expression subtree whose NAME_REFERENCE
   * nodes carry `bindingLinkHash`, so `CustomTypeB` is reachable by joining that
   * binding to the `py_import` row that bound it.
   *
   * `isAmbiguous` is set when a wildcard import is in scope, because a
   * same-named class could then come from somewhere unenumerable and the
   * resolution is a best guess rather than a fact.
   */
  private resolveAnnotations(
    input: ResolutionInput,
    typeByName: Map<string, PyTypeRegistry | null>
  ): void {
    const wildcardScopes = new Set(
      input.imports.filter(i => i.getIsWildcard()).map(i => i.getPyScopeLinkHash())
    );
    const anyWildcard = wildcardScopes.size > 0;

    const baseNameOf = (annotation: string): string => {
      // Strip subscripts, then take the rightmost dotted segment: `a.b.C[int]`
      // resolves on `C`.
      const withoutSubscript = annotation.split('[')[0]!.trim();
      const parts = withoutSubscript.split('.');
      return parts[parts.length - 1]!.trim();
    };

    const methodsByHash = new Map(input.methods.map(m => [m.getHash(), m]));

    for (const parameter of input.methodParameters ?? []) {
      const annotation = parameter.getParameterTypeName();
      if (annotation === '') {
        continue;
      }
      const target = typeByName.get(baseNameOf(annotation));
      if (target) {
        parameter.setResolvedAnnotation(target.getQualifiedName(), anyWildcard);
      } else if (anyWildcard) {
        // Unresolved AND a wildcard import is present: the name may well be a
        // class we cannot see, so mark the imprecision rather than implying none.
        parameter.setResolvedAnnotation('', true);
      }
      void methodsByHash;
    }

    for (const binding of input.bindings) {
      const annotation = binding.getDeclaredTypeName();
      if (annotation === '') {
        continue;
      }
      const baseName = baseNameOf(annotation);
      const target = typeByName.get(baseName);
      binding.setResolvedAnnotation(
        baseName,
        target ? target.getQualifiedName() : '',
        anyWildcard
      );
    }
  }

  /**
   * The absolute module name an import refers to, or `null` when it cannot be
   * determined.
   *
   * Relative imports are 38% of from-imports, so this is the common path rather
   * than an edge case. `from .helpers import x` inside `pkg.service` resolves
   * against `pkg`; each extra leading dot strips one more package level.
   */
  /**
   * Finds a module by name, tolerating an analysis root placed INSIDE the
   * package.
   *
   * Module names are relative to the analysis root, so analysing `.../email`
   * directly gives modules `parser`, `message` — while the source says
   * `from email.parser import Parser`. Progressively dropping leading segments
   * recovers that, and a candidate is accepted only when exactly ONE module
   * matches, so an ambiguous suffix resolves to nothing rather than to a guess.
   */
  private findModule(
    name: string,
    moduleByQualifiedName: Map<string, ProjectModuleFacts>
  ): ProjectModuleFacts | undefined {
    const exact = moduleByQualifiedName.get(name);
    if (exact) {
      return exact;
    }
    const parts = name.split('.');
    for (let drop = 1; drop < parts.length; drop++) {
      const candidate = parts.slice(drop).join('.');
      const matches = [...moduleByQualifiedName.entries()].filter(([q]) => q === candidate);
      if (matches.length === 1) {
        return matches[0]![1];
      }
    }
    return undefined;
  }

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
    this.resolveAnnotations(input, typesByName);

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

    this.linkNameReferences(input, {
      entityByBinding,
      bindingByScopeAndName,
      parentScopeOf,
    });

    const mroCache = new Map<string, string[] | null>();

    let resolved = 0;
    for (const callSite of input.callSites) {
      const target = this.resolveCallSite(callSite, {
        typesByHash,
        typesByName,
        basesByType,
        methodsByTypeAndName,
        mroCache,
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
      mroCache: Map<string, string[] | null>;
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

  /**
   * The method this name resolves to on a type, following the **C3 MRO**.
   *
   * Not depth-first. The two differ, and the difference is not academic:
   *
   * ```python
   * class A:      def m(self): ...
   * class B(A):   pass
   * class C(A):   def m(self): ...
   * class D(B, C):
   *     def m(self): return super().m()     # CPython: C.m
   * ```
   *
   * Depth-first through B reaches `A.m` and stops. CPython's MRO is
   * `D, B, C, A`, so the answer is `C.m` — C comes before A because A is in C's
   * tail. An earlier version of this resolver used depth-first and got exactly
   * that case wrong while looking correct on simpler ones, which is the worst
   * shape for a defect.
   */
  private lookupMethodOnTypeAndBases(
    typeHash: string,
    name: string,
    ctx: MroContext
  ): PyMethodRegistry | null {
    return this.lookupAlongMro(typeHash, name, ctx, 0);
  }

  /**
   * The same lookup, starting **after** the class itself.
   *
   * `super()` is not virtual dispatch: it is an MRO-ordered lookup beginning at
   * the position after the enclosing class, which is why `Child.describe`
   * calling `super().describe()` must reach `Base.describe` and never itself.
   */
  private lookupMethodOnBasesOnly(
    typeHash: string,
    name: string,
    ctx: MroContext
  ): PyMethodRegistry | null {
    return this.lookupAlongMro(typeHash, name, ctx, 1);
  }

  private lookupAlongMro(
    typeHash: string,
    name: string,
    ctx: MroContext,
    startIndex: number
  ): PyMethodRegistry | null {
    // A class is always FIRST in its own MRO, so a declaration on the class
    // itself needs no linearisation and cannot be shadowed by an opaque base.
    // Requiring the MRO here refused every `self.m()` in a class with an
    // external base even when the class declared `m` directly — 1,549 of them
    // across 400 stdlib files.
    if (startIndex === 0) {
      const own = this.singleMethodOn(typeHash, name, ctx);
      if (own) {
        return own;
      }
    }

    const mro = this.linearize(typeHash, ctx, new Set());
    if (mro !== null) {
      for (let i = Math.max(startIndex, 1); i < mro.length; i++) {
        const found = this.singleMethodOn(mro[i]!, name, ctx);
        if (found) {
          return found;
        }
      }
      return null;
    }

    // Full linearisation failed, but that does not always matter. What a claim
    // actually needs is the MRO PREFIX up to the declaring class — every class
    // before it must be known and must not declare the name. Anything after is
    // irrelevant, because the first declaration wins.
    //
    // Under SINGLE inheritance the prefix is just the chain, so it is walkable
    // without knowing the rest: `_SelectorSocketTransport(_SelectorTransport)`
    // resolves `_fatal_error` to `_SelectorTransport` even when THAT class's own
    // bases lie outside the analysis, because `_SelectorTransport` precedes them.
    // With multiple bases the prefix order genuinely depends on C3, so nothing
    // is claimed.
    return this.lookupAlongSingleInheritanceChain(typeHash, name, ctx, startIndex);
  }

  private lookupAlongSingleInheritanceChain(
    typeHash: string,
    name: string,
    ctx: MroContext,
    startIndex: number
  ): PyMethodRegistry | null {
    let current = typeHash;
    let depth = 0;
    const seen = new Set<string>();

    while (depth++ < 100 && !seen.has(current)) {
      seen.add(current);
      if (depth > startIndex) {
        const found = this.singleMethodOn(current, name, ctx);
        if (found) {
          return found;
        }
      }
      const bases = [...(ctx.basesByType.get(current) ?? [])]
        .filter(b => b.getKeywordName() === '')
        .filter(b => !(b.getBaseSimpleName() === 'object' && !b.getIsResolvedLocally()));
      if (bases.length === 0) {
        // Reached the implicit root without finding it.
        return null;
      }
      if (bases.length > 1) {
        // The prefix beyond this point depends on a linearisation that failed —
        // but the FIRST base's head is still provably MRO index 1. C3 always
        // takes it first: it could only be deferred if it appeared in a later
        // base's tail, and a later base inheriting from an earlier one is
        // precisely the inconsistent hierarchy CPython refuses to create. So a
        // declaration on base 0 itself is certain; anything deeper is not.
        const first = bases[0]!;
        if (!first.getIsResolvedLocally()) {
          return null;
        }
        return this.singleMethodOn(first.getResolvedTypeLinkHash(), name, ctx);
      }
      const base = bases[0]!;
      if (!base.getIsResolvedLocally()) {
        // Opaque position, and it comes BEFORE anything further up.
        return null;
      }
      current = base.getResolvedTypeLinkHash();
    }
    return null;
  }

  /**
   * C3 linearisation of a type, or `null` when it cannot be computed.
   *
   * `null` for two distinct reasons, both of which must block a resolution
   * claim: a base outside the analysis (its own MRO is unknown, and it could
   * declare the name), or a genuinely inconsistent hierarchy — the same
   * condition under which CPython itself raises `TypeError` at class creation.
   *
   * Memoised per type: without it the MRO is recomputed for every call site on
   * the class.
   */
  private linearize(
    typeHash: string,
    ctx: MroContext,
    visiting: Set<string>
  ): string[] | null {
    const cached = ctx.mroCache.get(typeHash);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(typeHash)) {
      // A cycle cannot occur in valid Python, but malformed or partially
      // resolved input must not hang.
      return null;
    }
    visiting.add(typeHash);

    const bases = [...(ctx.basesByType.get(typeHash) ?? [])]
      .filter(b => b.getKeywordName() === '')
      // An explicit `object` base is the implicit root written out longhand, and
      // `class X(object)` is very common in older code. It is NOT opaque: its
      // member set is fixed and entirely dunder, so it cannot be the target of
      // any ordinary name and cannot shadow one. Treating it as an unknown base
      // refused every inherited lookup under `class X(object)` — which is what
      // blocked argparse.ArgumentParser, whose two bases both spell it out.
      .filter(b => !(b.getBaseSimpleName() === 'object' && !b.getIsResolvedLocally()))
      .sort((a, b) => Number(a.getPosition()) - Number(b.getPosition()));

    let result: string[] | null = [typeHash];
    if (bases.length > 0) {
      if (bases.some(b => !b.getIsResolvedLocally())) {
        result = null;
      } else {
        const baseHashes = bases.map(b => b.getResolvedTypeLinkHash());
        const sequences: string[][] = [];
        for (const baseHash of baseHashes) {
          const linear = this.linearize(baseHash, ctx, visiting);
          if (linear === null) {
            result = null;
            break;
          }
          sequences.push([...linear]);
        }
        if (result !== null) {
          // The direct base list is itself a constraint sequence, which is what
          // makes C3 preserve the order bases were written in.
          sequences.push([...baseHashes]);
          const merged = this.c3Merge(sequences);
          result = merged === null ? null : [typeHash, ...merged];
        }
      }
    }

    visiting.delete(typeHash);
    ctx.mroCache.set(typeHash, result);
    return result;
  }

  /**
   * The C3 merge: repeatedly take the head of the first sequence that appears in
   * no other sequence's TAIL.
   *
   * "Appears in a tail" is the whole rule — it is what makes `C` precede `A` in
   * `D(B, C)`, since `A` sits in `C`'s tail and so cannot be taken first.
   * Returning `null` when no candidate qualifies mirrors CPython refusing to
   * create the class.
   */
  private c3Merge(sequences: string[][]): string[] | null {
    const pending = sequences.map(s => [...s]).filter(s => s.length > 0);
    const result: string[] = [];

    while (pending.length > 0) {
      let taken: string | null = null;
      for (const sequence of pending) {
        const head = sequence[0]!;
        const inSomeTail = pending.some(other => other.indexOf(head) > 0);
        if (!inSomeTail) {
          taken = head;
          break;
        }
      }
      if (taken === null) {
        return null;
      }
      result.push(taken);
      for (const sequence of pending) {
        if (sequence[0] === taken) {
          sequence.shift();
        }
      }
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i]!.length === 0) {
          pending.splice(i, 1);
        }
      }
    }
    return result;
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
