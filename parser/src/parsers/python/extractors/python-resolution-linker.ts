import {
  PyBindingRegistry,
  PyCallSiteRegistry,
  PyExpressionRegistry,
  PyFieldRegistry,
  PyImportRegistry,
  PyMethodParameterRegistry,
  PyMethodRegistry,
  PyScopeRegistry,
  PyTypeBaseRegistry,
  PyTypeReferenceRegistry,
  PyTypeRegistry,
} from '@/analysis-types/python';
import { PYTHON_BUILTIN_TYPE_METHODS } from '@/constants/python-constants';
import { PythonReceiverKind, PythonResolvedCalleeKind } from '@/enums/python/call-sites';
import { PythonInitializerKind } from '@/enums/python/fields';
import {
  PythonEdgeRole,
  PythonExpressionKind,
  PythonReferencedEntityKind,
  PythonRootContext,
} from '@/enums/python/expressions';
import { PythonImportTargetKind } from '@/enums/python/imports';
import { PythonMethodKind } from '@/enums/python/methods';

/** One module's facts, for the project-level pass. */
export interface ProjectModuleFacts extends ResolutionInput {
  qualifiedName: string;
  moduleHash: string;
  /**
   * Whether this module is a package's `__init__.py`.
   *
   * Needed for relative imports, and the distinction is not cosmetic. For a
   * submodule `unittest.case`, `from .x import y` means `unittest.x` — drop the
   * last segment to get the package. For the package's own `__init__.py`,
   * qualified name `unittest`, the current package IS `unittest`, so dropping a
   * segment walks one level too far and every `from .case import TestCase`
   * re-export fails to resolve.
   */
  isPackage?: boolean;
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
  typeReferences: PyTypeReferenceRegistry[];
  fields: PyFieldRegistry[];
  /** Assignment target byte range -> value byte range, from the expression stage. */
  assignedValueByTargetRange?: Map<string, string>;
  /** Byte range -> expression PK. */
  expressionByByteRange?: Map<string, string>;
  /** Expression PK -> byte range, the inverse. */
  byteRangeByExpression?: Map<string, string>;
  /** `(pyTypeLinkHash, attributeName)` -> `py_field` PK. */
  fieldHashByTypeAndName: Map<string, string>;
  /** `py_method` PK -> its receiver parameter name. */
  receiverNameByMethodHash: Map<string, string>;
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
   * Dotted-suffix and per-module type indexes for the pass in flight.
   *
   * Held on the instance because the dotted resolver is reached from several
   * places — bases, type references, annotations — and threading two more
   * parameters through each of them would obscure the rule rather than clarify
   * it. Both are rebuilt at the start of every pass, so no state survives a call.
   */
  private qualifiedSuffixIndex = new Map<string, PyTypeRegistry | null>();
  /** Dotted suffix -> module, for import discovery. See {@link findModule}. */
  private moduleSuffixIndex = new Map<string, ProjectModuleFacts>();
  private typesByNameByModuleName = new Map<string, Map<string, PyTypeRegistry | null>>();

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

    this.buildModuleSuffixIndex(modules);

    // ---- step 1: imports
    /** binding PK -> the entity that import binds, when it resolves in-project. */
    const entityByImportBinding = new Map<string, PyMethodRegistry | PyTypeRegistry>();
    for (const module of modules) {
      for (const record of module.imports) {
        const targetName = this.importTargetModule(record, module.qualifiedName, module.isPackage === true);
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
        const entity =
          exportsByModule.get(targetModule.qualifiedName)?.get(member) ??
          this.followReExport(member, targetModule, exportsByModule, moduleByQualifiedName);
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

    // Project-wide dotted resolution, built BEFORE bases are resolved because
    // bases are the first thing that needs it. The suffix index answers nested
    // and module-qualified names directly; the per-module map answers
    // RE-EXPORTS, where `unittest.TestCase` is not a suffix of
    // `unittest.case.TestCase` because `unittest/__init__.py` imports the name
    // rather than declaring it.
    this.qualifiedSuffixIndex = this.buildQualifiedSuffixIndex(modules.flatMap(m => m.types));
    this.typesByNameByModuleName = new Map();
    for (const module of modules) {
      const names = this.uniqueByName(module.types, t => t.getName());
      for (const record of module.imports) {
        const bindingHash = record.getBindingLinkHash();
        const entity = bindingHash === '' ? undefined : entityByImportBinding.get(bindingHash);
        if (entity instanceof PyTypeRegistry) {
          const bound = record.getSimpleName();
          names.set(bound, names.has(bound) ? null : entity);
        }
      }
      this.typesByNameByModuleName.set(module.qualifiedName, names);
      const last = module.qualifiedName.split('.').pop() ?? '';
      if (last !== '' && !this.typesByNameByModuleName.has(last)) {
        this.typesByNameByModuleName.set(last, names);
      }
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
            continue;
          }
          // The prefix did not name an imported module in THIS file — the usual
          // reason being a re-export (`import unittest` then
          // `class T(unittest.TestCase)`, where TestCase is declared in
          // unittest/case.py). Walk the segments instead of giving up.
          const walked = this.resolveDottedTypeName(dotted, {
            typesByName: localTypes,
            qualifiedSuffixIndex: this.qualifiedSuffixIndex,
            typesByNameByModuleName: this.typesByNameByModuleName,
          });
          if (walked && walked.getHash() !== base.getPyTypeLinkHash()) {
            base.setResolution(walked.getHash(), true);
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
    const projectReturnTypes = new Map<string, PyTypeRegistry | null>();

    // Attributes and receiver names, project-wide. Both keys are global — a
    // `py_type` PK and a `py_method` PK are unique across the analysis — so one
    // map serves every module, which is what makes a CROSS-MODULE attribute
    // resolve: `self.transport.close()` where `transport` is annotated with a
    // class imported from elsewhere.
    const fieldByTypeAndName = new Map<string, PyFieldRegistry>();
    // EVERY row for a name, not just the preferred one. An attribute routinely
    // exists twice — `dialect: Dialect` in the class body and
    // `self.dialect = ...` in `__init__` — and those are two py_field rows by
    // design, since fieldOrigin is part of identity. Preferring the instance row
    // is right for deciding WHICH ROW A READ REACHES and wrong for deciding
    // WHERE THE TYPE COMES FROM, because the annotation is on the other row.
    // Keeping only the preferred row is why ATTRIBUTE resolution read 0 of 227
    // on SQLAlchemy's engine package while an independent resolver got 97.
    const fieldsByTypeAndName = new Map<string, PyFieldRegistry[]>();
    const receiverNameByMethodHash = new Map<string, string>();
    for (const module of modules) {
      for (const field of module.fields) {
        const key = `${field.getPyTypeLinkHash()}||${field.getName()}`;
        fieldsByTypeAndName.set(key, [...(fieldsByTypeAndName.get(key) ?? []), field]);
        const incumbent = fieldByTypeAndName.get(key);
        if (!incumbent || incumbent.getFieldModifier().includes('CLASS_VAR')) {
          fieldByTypeAndName.set(key, field);
        }
      }
      for (const [methodHash, receiverName] of module.receiverNameByMethodHash) {
        receiverNameByMethodHash.set(methodHash, receiverName);
      }
    }

    // A field's annotation must resolve in the namespace of the module that
    // DECLARES the field, not the one calling through it — `self.q: Queue` means
    // whatever `Queue` meant where the class was written. So the name->type map
    // is built per module first, and the attribute type is settled before any
    // cross-module call site consults it.
    const typesByNameByModule = new Map<string, Map<string, PyTypeRegistry | null>>();
    for (const module of modules) {
      const names = this.uniqueByName(module.types, t => t.getName());
      for (const record of module.imports) {
        const bindingHash = record.getBindingLinkHash();
        const entity = bindingHash === '' ? undefined : entityByImportBinding.get(bindingHash);
        if (entity instanceof PyTypeRegistry) {
          const bound = record.getSimpleName();
          names.set(bound, names.has(bound) ? null : entity);
        }
      }
      typesByNameByModule.set(module.moduleHash, names);
    }
    // Module-level functions by name, for factory typing. Ambiguous names map to
    // null: two functions called `make` in one module cannot settle a type.
    const moduleMethodsByNameByModule = new Map<string, Map<string, PyMethodRegistry | null>>();
    for (const module of modules) {
      moduleMethodsByNameByModule.set(
        module.moduleHash,
        this.uniqueByName(
          module.methods.filter(m => m.getPyTypeLinkHash() === ''),
          m => m.getName()
        )
      );
    }
    const parametersByMethod = new Map<string, PyMethodParameterRegistry[]>();
    for (const module of modules) {
      for (const parameter of module.methodParameters) {
        const list = parametersByMethod.get(parameter.getPyMethodLinkHash()) ?? [];
        list.push(parameter);
        parametersByMethod.set(parameter.getPyMethodLinkHash(), list);
      }
    }
    const fieldTypeByHash = new Map<string, PyTypeRegistry>();
    for (const module of modules) {
      const names = typesByNameByModule.get(module.moduleHash)!;
      for (const field of module.fields) {
        const resolved = this.typeOfField(field, {
          typesByName: names,
          parametersByMethod,
          moduleMethodsByName: moduleMethodsByNameByModule.get(module.moduleHash),
        });
        if (resolved) {
          fieldTypeByHash.set(field.getHash(), resolved);
        }
      }
    }

    // Two passes over the modules for return typing: the first types what each
    // module can see on its own, the second lets a factory returning another
    // factory's result resolve once the first is known.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const module of modules) {
        const scopedBindings = new Map<string, PyBindingRegistry>();
        for (const binding of module.bindings) {
          scopedBindings.set(`${binding.getPyScopeLinkHash()}::${binding.getName()}`, binding);
        }
        const scopedParents = new Map<string, string>();
        for (const scope of module.scopes) {
          scopedParents.set(scope.getHash(), scope.getParentScopeLinkHash());
        }
        const scopedEntities = new Map<string, PyMethodRegistry | PyTypeRegistry>();
        for (const method of module.methods) {
          if (method.getDeclaringBindingLinkHash() !== '') {
            scopedEntities.set(method.getDeclaringBindingLinkHash(), method);
          }
        }
        for (const type of module.types) {
          if (type.getDeclaringBindingLinkHash() !== '') {
            scopedEntities.set(type.getDeclaringBindingLinkHash(), type);
          }
        }
        for (const [bindingHash, entity] of entityByImportBinding) {
          scopedEntities.set(bindingHash, entity);
        }
        const found = this.buildReturnTypeIndex(module, {
          entityByBinding: scopedEntities,
          bindingByScopeAndName: scopedBindings,
          parentScopeOf: scopedParents,
          typesByName: typesByNameByModule.get(module.moduleHash) ?? new Map(),
          moduleMethodsByName: moduleMethodsByNameByModule.get(module.qualifiedName),
          methodsByTypeAndName,
          typesByHash,
          basesByType,
          mroCache,
          returnedTypeByMethod: projectReturnTypes,
        });
        for (const [methodHash, resolved] of found) {
          if (resolved) {
            projectReturnTypes.set(methodHash, resolved);
          }
        }
      }
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

      // Annotations get a second pass too: `a: CustomTypeA` where CustomTypeA is
      // imported can only resolve once the import graph exists.
      this.resolveAnnotations(module, typesByName);
      this.resolveTypeReferences(module, typesByName);
      this.linkNameReferences(module, {
        entityByBinding,
        bindingByScopeAndName,
        parentScopeOf,
      });

      // The return index is PROJECT-WIDE, merged below, because a factory is
      // usually imported: `reg = make_registry()` in one module needs the return
      // type of a function declared in another. A per-module index answers
      // nothing for exactly the calls that cross a file boundary, which is most
      // of them.
      const localTypeByBinding = this.buildLocalTypeIndex(module, {
        entityByBinding,
        bindingByScopeAndName,
        parentScopeOf,
        returnedTypeByMethod: projectReturnTypes,
        typesByName,
        moduleMethodsByName: moduleMethodsByNameByModule.get(module.qualifiedName),
        methodsByTypeAndName,
        typesByHash,
        basesByType,
        mroCache,
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
          fieldByTypeAndName,
          fieldsByTypeAndName,
          receiverNameByMethodHash,
          fieldTypeByHash,
          parametersByMethod,
          moduleMethodsByName: moduleMethodsByNameByModule.get(module.moduleHash),
          importedModules: importedModuleByName.get(module.qualifiedName),
          exportsByModule,
          moduleByQualifiedName,
          localTypeByBinding,
        });
        if (target) {
          callSite.setResolvedCallee(target.kind, target.hash);
          stats.callSitesResolved += 1;
        }
      }
    }

    // Second pass for CALL_RESULT chains. The inner call has to be resolved
    // before its return type can be read, so this cannot happen in one sweep.
    // Bounded to a single retry: one hop is the parser's share, and a longer
    // chain is the engine's to walk.
    const methodByHash = new Map(allMethods.map(m => [m.getHash(), m]));
    for (const module of modules) {
      const innerCallReturnType = this.buildInnerCallReturnIndex(
        module,
        methodByHash,
        projectReturnTypes,
        typesByHash
      );
      if (innerCallReturnType.size === 0) {
        continue;
      }
      const typesByName = typesByNameByModule.get(module.moduleHash) ?? new Map();
      const bindingByScopeAndName = new Map<string, PyBindingRegistry>();
      for (const binding of module.bindings) {
        bindingByScopeAndName.set(`${binding.getPyScopeLinkHash()}::${binding.getName()}`, binding);
      }
      const parentScopeOf = new Map<string, string>();
      for (const scope of module.scopes) {
        parentScopeOf.set(scope.getHash(), scope.getParentScopeLinkHash());
      }
      for (const callSite of module.callSites) {
        if (callSite.getResolvedCalleeKind() !== PythonResolvedCalleeKind.UNRESOLVED) {
          continue;
        }
        if (callSite.getReceiverKind() !== PythonReceiverKind.CALL_RESULT) {
          continue;
        }
        const target = this.resolveCallSite(callSite, {
          typesByHash,
          typesByName,
          basesByType,
          methodsByTypeAndName,
          mroCache,
          entityByBinding: new Map(),
          bindingByScopeAndName,
          parentScopeOf,
          boundNames: new Set(),
          importedModuleNames: new Set(),
          fieldByTypeAndName: new Map(),
          receiverNameByMethodHash: new Map(),
          innerCallReturnType,
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
   * Resolves `py_type_reference.referencedTypeLinkHash`.
   *
   * Every node in the tree resolves independently, which is the point: for
   * `Dict[TypeA, TypeB]` the `Dict` row stays unresolved (external) while the two
   * argument rows each reach their own `py_type`. A single slot on the parameter
   * could only ever have recorded one of the three.
   */

  /**
   * Builds a lookup from every dotted SUFFIX of a type's qualified name to that
   * type, with collisions mapped to `null`.
   *
   * A nested class `TopOne.Inner` in module `pkg.nest` has qualified name
   * `pkg.nest.TopOne.Inner`, so it is registered under `Inner`,
   * `TopOne.Inner`, `nest.TopOne.Inner` and the full name. That single structure
   * answers all three shapes a dotted reference takes — a nested class named from
   * its outer class, a class named through its module, and a fully qualified
   * name — without special-casing any of them.
   *
   * Collisions map to `null` rather than to a first hit. Two classes named
   * `Inner` in different outer classes make the bare name ambiguous, and
   * answering it would be a guess; the longer, unambiguous suffix still resolves.
   */
  private buildQualifiedSuffixIndex(
    types: PyTypeRegistry[]
  ): Map<string, PyTypeRegistry | null> {
    const index = new Map<string, PyTypeRegistry | null>();
    for (const type of types) {
      const qualified = type.getQualifiedName();
      if (qualified === '') {
        continue;
      }
      const segments = qualified.split('.');
      for (let start = segments.length - 1; start >= 0; start -= 1) {
        const suffix = segments.slice(start).join('.');
        if (index.has(suffix)) {
          const incumbent = index.get(suffix);
          if (incumbent !== type) {
            index.set(suffix, null);
          }
          continue;
        }
        index.set(suffix, type);
      }
    }
    return index;
  }

  /**
   * Resolves a possibly-dotted type name to a single class.
   *
   * Dotted names were previously skipped outright, on the correct reasoning that
   * `pkg.mod.Cls` names something outside this module even when its last segment
   * collides with a local class. That reasoning is sound and the conclusion was
   * still wrong: the fix is to walk the segments, not to refuse the name. The
   * measured cost of refusing was large — `unittest.TestCase` alone went
   * unresolved 244 times, taking 3,201 `self.assertEqual`-style calls with it,
   * because a method reachable through the MRO is only reachable once the base
   * resolves.
   *
   * Two grounds, tried in order of certainty:
   *
   * 1. A unique qualified-name suffix. This covers `TopOne.Inner` in the same
   *    file and `models.Base` across modules, and it is unambiguous by
   *    construction because a colliding suffix was mapped to `null`.
   * 2. A module binding. `unittest.TestCase` is not `unittest.case.TestCase` by
   *    suffix — `unittest/__init__.py` RE-EXPORTS it — so the module is found
   *    first and the name looked up in what that module binds, imports included.
   */
  private resolveDottedTypeName(
    raw: string,
    ctx: {
      typesByName: Map<string, PyTypeRegistry | null>;
      qualifiedSuffixIndex?: Map<string, PyTypeRegistry | null>;
      typesByNameByModuleName?: Map<string, Map<string, PyTypeRegistry | null>>;
    }
  ): PyTypeRegistry | null {
    // A PEP 484 forward reference carries its quotes into the complete name:
    // `-> "TopOne.Inner.Deepest"`. The single-segment path already strips them,
    // so a dotted forward reference was the ONLY shape that failed — the quotes
    // made every segment walk miss.
    const dotted = raw.replace(/^['"]|['"]$/g, '').trim();
    if (dotted === '') {
      return null;
    }
    if (!dotted.includes('.')) {
      return ctx.typesByName.get(dotted) ?? null;
    }

    const bySuffix = ctx.qualifiedSuffixIndex?.get(dotted);
    if (bySuffix) {
      return bySuffix;
    }

    const segments = dotted.split('.');
    const memberName = segments[segments.length - 1]!;
    const modulePath = segments.slice(0, -1).join('.');
    const moduleTypes =
      ctx.typesByNameByModuleName?.get(modulePath) ??
      ctx.typesByNameByModuleName?.get(segments[segments.length - 2]!);
    if (moduleTypes) {
      return moduleTypes.get(memberName) ?? null;
    }
    return null;
  }

  private resolveTypeReferences(
    input: ResolutionInput,
    typeByName: Map<string, PyTypeRegistry | null>
  ): void {
    for (const reference of input.typeReferences) {
      if (reference.getReferencedTypeLinkHash() !== '') {
        continue;
      }
      // The COMPLETE name first: `TopOne.Inner` must reach the nested class, not
      // the outer one that its first segment happens to name.
      const complete = reference.getCompleteTypeName();
      const target =
        (complete.includes('.')
          ? this.resolveDottedTypeName(complete, {
              typesByName: typeByName,
              qualifiedSuffixIndex: this.qualifiedSuffixIndex,
              typesByNameByModuleName: this.typesByNameByModuleName,
            })
          : null) ?? typeByName.get(reference.getTypeName()) ?? null;
      if (target) {
        reference.setReferencedTypeLinkHash(target.getHash());
      }
    }
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
  /**
   * The class a local variable holds, when the source settles it.
   *
   * Looks up the binding the receiver name resolves to, then the assignment that
   * gave it its value. Three grounds, in order of certainty and each refusing
   * rather than guessing:
   *
   *   `x = Foo()`            a constructor naming a class in scope
   *   `x = make_foo()`       a function whose `-> Foo` says what it returns
   *   `x = self.make_foo()`  a method on this class, same reasoning
   *
   * Deliberately refuses when the name is assigned MORE THAN ONCE with different
   * types, and when the assignment is a bare name or a call it cannot type. A
   * local rebound in a loop or reassigned on a branch is not reliably one type,
   * and claiming otherwise would produce exactly the confident wrong edge this
   * column exists to avoid.
   */
  private typeOfLocalReceiver(
    callSite: PyCallSiteRegistry,
    ctx: {
      receiverOverride?: string;
      typesByHash: Map<string, PyTypeRegistry>;
      typesByName: Map<string, PyTypeRegistry | null>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      methodsByTypeAndName: Map<string, PyMethodRegistry[]>;
      mroCache: Map<string, string[] | null>;
      localTypeByBinding?: Map<string, PyTypeRegistry | null>;
      bindingByScopeAndName: Map<string, PyBindingRegistry>;
      parentScopeOf: Map<string, string>;
    },
    nameOverride?: string
  ): PyTypeRegistry | null {
    if (!ctx.localTypeByBinding) {
      return null;
    }
    const receiver = nameOverride ?? callSite.getReceiverText();
    if (receiver === '' || receiver.includes('.')) {
      return null;
    }
    // Walk the scope chain so a local declared in an enclosing function is found
    // where the language would find it.
    let scope: string | undefined = callSite.getPyScopeLinkHash();
    let guard = 0;
    while (scope !== undefined && scope !== '' && guard < 200) {
      guard += 1;
      const binding = ctx.bindingByScopeAndName.get(`${scope}::${receiver}`);
      if (binding?.isBound()) {
        return ctx.localTypeByBinding.get(binding.getHash()) ?? null;
      }
      scope = ctx.parentScopeOf.get(scope);
    }
    return null;
  }

  /**
   * The class a PARAMETER receiver holds, from its annotation.
   *
   * `def run(self, case: TestCase)` then `case.setup()`. The annotation is the
   * programmer stating the type, and it is the one place a caller's value is
   * described without any inference at all — which is why it resolves here while
   * the same receiver in unannotated code correctly does not.
   */
  private typeOfParameterReceiver(
    callSite: PyCallSiteRegistry,
    ctx: {
      typesByName: Map<string, PyTypeRegistry | null>;
      parametersByMethod?: Map<string, PyMethodParameterRegistry[]>;
    },
    nameOverride?: string
  ): PyTypeRegistry | null {
    const receiver = nameOverride ?? callSite.getReceiverText();
    if (receiver === '' || receiver.includes('.') || !ctx.parametersByMethod) {
      return null;
    }
    const parameters = ctx.parametersByMethod.get(callSite.getPyMethodLinkHash()) ?? [];
    for (const parameter of parameters) {
      if (parameter.getParamName() !== receiver) {
        continue;
      }
      const annotation = parameter.getParameterTypeName();
      if (annotation === '') {
        return null;
      }
      for (const candidate of this.namedTypesIn(annotation)) {
        const resolved = ctx.typesByName.get(candidate);
        if (resolved) {
          return resolved;
        }
      }
      return null;
    }
    return null;
  }

  /**
   * Types every local that is assigned exactly one derivable type.
   *
   * Built once per module from the expression tree: an `ASSIGNMENT_VALUE` whose
   * parent statement targets a single name. A name assigned two different types
   * maps to `null` and stays unresolved — that refusal is the point, since a
   * variable reused for two purposes has no single callee.
   */
  private buildLocalTypeIndex(
    module: ResolutionInput,
    ctx: {
      entityByBinding?: Map<string, PyMethodRegistry | PyTypeRegistry>;
      bindingByScopeAndName?: Map<string, PyBindingRegistry>;
      parentScopeOf?: Map<string, string>;
      returnedTypeByMethod?: Map<string, PyTypeRegistry | null>;
      typesByName: Map<string, PyTypeRegistry | null>;
      moduleMethodsByName?: Map<string, PyMethodRegistry | null>;
      methodsByTypeAndName: Map<string, PyMethodRegistry[]>;
      typesByHash: Map<string, PyTypeRegistry>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      mroCache: Map<string, string[] | null>;
    }
  ): Map<string, PyTypeRegistry | null> {
    const byBinding = new Map<string, PyTypeRegistry | null>();
    const expressionByHash = new Map<string, PyExpressionRegistry>();
    for (const expression of module.expressions) {
      expressionByHash.set(expression.getHash(), expression);
    }

    for (const expression of module.expressions) {
      if (expression.getEdgeRole() !== PythonEdgeRole.ASSIGNMENT_TARGET) {
        continue;
      }
      if (expression.getKind() !== PythonExpressionKind.NAME_REFERENCE) {
        continue;
      }
      // Depth 1, not 0: an assignment target is now a CHILD of the ASSIGNMENT
      // node rather than a root of its own. A depth-0 filter silently matched
      // nothing after that change and every local went untyped — the kind of
      // regression a resolution count catches and a structural invariant does
      // not, since the tree was still perfectly well-formed.
      if (expression.getDepth() !== 1) {
        continue;
      }
      const binding = expression.getBindingLinkHash();
      if (binding === '') {
        continue;
      }
      const value = this.assignedValueFor(expression, module, expressionByHash);
      const resolved = value ? this.typeOfAssignedValue(value, ctx) : null;
      if (byBinding.has(binding)) {
        // A second assignment. Agreeing is fine; disagreeing makes the name
        // untyped rather than whichever came first.
        if (byBinding.get(binding) !== resolved) {
          byBinding.set(binding, null);
        }
        continue;
      }
      byBinding.set(binding, resolved);
    }
    return byBinding;
  }

  /** The `ASSIGNMENT_VALUE` sibling of an assignment target. */
  /**
   * The `ASSIGNMENT_VALUE` expression whose value flows into this target.
   *
   * Uses the EXACT pairing the expression stage recorded while both nodes were
   * in hand. The previous version matched on (scope, line), which is a guess:
   * `a = f(); b = g()` on one line pairs both targets with the first value, and
   * a value continued onto the next line pairs with nothing.
   */
  private assignedValueFor(
    target: PyExpressionRegistry,
    module: ResolutionInput,
    expressionByHash: Map<string, PyExpressionRegistry>
  ): PyExpressionRegistry | null {
    const pairing = module.assignedValueByTargetRange;
    const byRange = module.expressionByByteRange;
    if (!pairing || !byRange) {
      return null;
    }
    const targetRange = module.byteRangeByExpression?.get(target.getHash());
    if (!targetRange) {
      return null;
    }
    const valueRange = pairing.get(targetRange);
    if (!valueRange) {
      return null;
    }
    const valueHash = byRange.get(valueRange);
    return valueHash ? expressionByHash.get(valueHash) ?? null : null;
  }

  /**
   * Infers each method's return type from its `return` statements.
   *
   * Only when EVERY return whose type is derivable agrees on one class. A
   * function with `return Registry()` on one branch and `return None` on another
   * is not a `Registry`, and a caller that treats it as one gets a wrong edge on
   * exactly the path where the value is absent — so disagreement refuses.
   *
   * Two passes, because a factory frequently returns the result of another
   * factory. Two is enough for the common chain and stops well short of the
   * whole-program fixpoint that belongs to the engine.
   */
  private buildReturnTypeIndex(
    module: ResolutionInput,
    ctx: {
      returnedTypeByMethod?: Map<string, PyTypeRegistry | null>;
      entityByBinding?: Map<string, PyMethodRegistry | PyTypeRegistry>;
      bindingByScopeAndName?: Map<string, PyBindingRegistry>;
      parentScopeOf?: Map<string, string>;
      typesByName: Map<string, PyTypeRegistry | null>;
      moduleMethodsByName?: Map<string, PyMethodRegistry | null>;
      methodsByTypeAndName: Map<string, PyMethodRegistry[]>;
      typesByHash: Map<string, PyTypeRegistry>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      mroCache: Map<string, string[] | null>;
    }
  ): Map<string, PyTypeRegistry | null> {
    const byMethod = new Map<string, PyTypeRegistry | null>();
    const returnValues = module.expressions.filter(
      expression =>
        expression.getRootContext() === PythonRootContext.RETURN_VALUE &&
        expression.getDepth() === 0
    );
    for (let pass = 0; pass < 2; pass += 1) {
      const working = new Map(byMethod);
      for (const value of returnValues) {
        const owner = value.getExpressionOwnerHash();
        if (owner === '') {
          continue;
        }
        const resolved = this.typeOfAssignedValue(value, {
          ...ctx,
          returnedTypeByMethod: working,
        });
        if (resolved === null) {
          // A return this pass cannot type says nothing either way; only a
          // CONFLICT between two typed returns makes the method untyped.
          continue;
        }
        if (byMethod.has(owner) && byMethod.get(owner) !== resolved) {
          byMethod.set(owner, null);
          continue;
        }
        byMethod.set(owner, resolved);
      }
    }
    return byMethod;
  }

  /** The class an assigned expression produces, or `null`. */
  private typeOfAssignedValue(
    value: PyExpressionRegistry,
    ctx: {
      entityByBinding?: Map<string, PyMethodRegistry | PyTypeRegistry>;
      bindingByScopeAndName?: Map<string, PyBindingRegistry>;
      parentScopeOf?: Map<string, string>;
      typesByName: Map<string, PyTypeRegistry | null>;
      moduleMethodsByName?: Map<string, PyMethodRegistry | null>;
      methodsByTypeAndName: Map<string, PyMethodRegistry[]>;
      typesByHash: Map<string, PyTypeRegistry>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      mroCache: Map<string, string[] | null>;
      returnedTypeByMethod?: Map<string, PyTypeRegistry | null>;
    }
  ): PyTypeRegistry | null {
    // `return self` types the method as its own class. This is the fluent-API
    // shape — `def add(self, x): ...; return self` — and without it a chained
    // call like `node.add(x).count()` has no receiver type even though the
    // answer is written in the method.
    if (value.getKind() === PythonExpressionKind.SELF_REFERENCE) {
      const enclosing = value.getPyTypeLinkHash();
      return enclosing === '' ? null : ctx.typesByHash.get(enclosing) ?? null;
    }
    if (value.getKind() !== PythonExpressionKind.CALL) {
      return null;
    }
    const callee = value.getLiteralValue();
    if (callee === '') {
      return null;
    }
    // `cls(...)` inside a classmethod constructs the class it was called on,
    // which for a single-class analysis is the enclosing class. This is how a
    // classmethod factory is written — `return cls(name)` — so without it every
    // `Builder.of(...)` result stays untyped and the call on it unresolved.
    if (callee === 'cls' && value.getPyTypeLinkHash() !== '') {
      return ctx.typesByHash.get(value.getPyTypeLinkHash()) ?? null;
    }

    // `x = Foo()` — calling a class yields an instance of it.
    const asClass = this.resolveDottedTypeName(callee, {
      typesByName: ctx.typesByName,
      qualifiedSuffixIndex: this.qualifiedSuffixIndex,
      typesByNameByModuleName: this.typesByNameByModuleName,
    });
    if (asClass) {
      return asClass;
    }
    // `x = make_foo()` — a factory. Resolved through the SCOPE CHAIN rather than
    // the current module's functions, because the factory is usually imported:
    // `from core.base import make_registry` binds it here, and a module-local
    // lookup finds nothing. The scope chain already knows about import bindings,
    // so this reuses the same path a bare call would take.
    const viaScope =
      ctx.entityByBinding && ctx.bindingByScopeAndName && ctx.parentScopeOf
        ? this.lookupInScopeChain(callee, value.getPyScopeLinkHash(), {
            entityByBinding: ctx.entityByBinding,
            bindingByScopeAndName: ctx.bindingByScopeAndName,
            parentScopeOf: ctx.parentScopeOf,
          })
        : null;
    if (viaScope instanceof PyTypeRegistry) {
      return viaScope;
    }
    if (viaScope) {
      return this.returnedTypeOf(viaScope, ctx);
    }
    const factory = ctx.moduleMethodsByName?.get(callee.split('.').pop() ?? '');
    if (factory) {
      return this.returnedTypeOf(factory, ctx);
    }
    const segments = value.getDottedPath().split('.');
    const bare = callee.split('.').pop() ?? '';

    // `x = self.make_foo()` / `x = cls.make_foo()` — a method on the enclosing
    // class. A factory method is the usual way a class hands out helpers.
    const ownerType = value.getPyTypeLinkHash();
    if (ownerType !== '' && segments.length === 2) {
      const receiver = segments[0] ?? '';
      // `cls(...)` constructs the enclosing class itself.
      if (receiver === 'cls' && bare === 'cls') {
        return ctx.typesByHash.get(ownerType) ?? null;
      }
      const method = this.lookupMethodOnTypeAndBases(ownerType, bare, ctx);
      if (method) {
        return this.returnedTypeOf(method, ctx);
      }
    }

    // `x = Builder.of(...)` — a classmethod on a NAMED class. Its return is
    // typed the same way any other method's is.
    if (segments.length === 2) {
      const onClass = this.resolveDottedTypeName(segments[0] ?? '', {
        typesByName: ctx.typesByName,
        qualifiedSuffixIndex: this.qualifiedSuffixIndex,
        typesByNameByModuleName: this.typesByNameByModuleName,
      });
      if (onClass) {
        const method = this.lookupMethodOnTypeAndBases(onClass.getHash(), bare, ctx);
        if (method) {
          // A classmethod returning `cls(...)` returns the class it was called
          // ON, which is what makes `Builder.of(...)` a Builder.
          return this.returnedTypeOf(method, ctx) ?? null;
        }
      }
    }
    return null;
  }

  /**
   * Follows a RE-EXPORT to the module that actually declares the name.
   *
   * A package `__init__.py` that says `from .runner import Runner` does not
   * declare `Runner`; it re-binds it. So `from framework import Runner`
   * elsewhere resolves to a module and stops, and every call through that name
   * stays unresolved even though the class is right there in the analysis. This
   * is the same shape as `unittest.TestCase`, and it is how most packages present
   * their public API.
   *
   * The walk is bounded and refuses on a cycle rather than looping, since
   * `a` importing from `b` importing from `a` is legal enough to parse.
   */
  private followReExport(
    member: string,
    fromModule: ProjectModuleFacts,
    exportsByModule: Map<string, Map<string, PyMethodRegistry | PyTypeRegistry>>,
    moduleByQualifiedName: Map<string, ProjectModuleFacts>
  ): PyMethodRegistry | PyTypeRegistry | undefined {
    let current: ProjectModuleFacts | undefined = fromModule;
    const visited = new Set<string>();
    for (let hop = 0; hop < 8 && current; hop += 1) {
      if (visited.has(current.qualifiedName)) {
        return undefined;
      }
      visited.add(current.qualifiedName);

      const record = current.imports.find(
        candidate =>
          !candidate.getIsModuleImport() &&
          !candidate.getIsWildcard() &&
          candidate.getSimpleName() === member
      );
      if (!record) {
        return undefined;
      }
      const nextName = this.importTargetModule(
        record,
        current.qualifiedName,
        current.isPackage === true
      );
      const next = nextName === null ? undefined : this.findModule(nextName, moduleByQualifiedName);
      if (!next) {
        return undefined;
      }
      const original = record.getOriginalName().split('.').pop() ?? member;
      const found = exportsByModule.get(next.qualifiedName)?.get(original);
      if (found) {
        return found;
      }
      current = next;
    }
    return undefined;
  }

  /**
   * Finds the module an import names — the package-discovery step.
   *
   * Python resolves `import framework` against `sys.path`, so the name is
   * relative to wherever the package ROOT sits. The analyser has no sys.path, and
   * a module's qualified name depends on where analysis started: rooting at a
   * directory that is itself a package makes every module carry that package's
   * name, so `framework` is registered as `myproject.framework` and an exact
   * match fails. That single mismatch left the base of every cross-package
   * subclass unresolved, and with it every `self.method()` inherited from it.
   *
   * The fix mirrors what already works for types: match on any dotted SUFFIX of
   * a module's qualified name, with collisions refusing rather than guessing.
   * `framework` finds `myproject.framework`; `case` finds
   * `myproject.framework.case`; and if two packages both contain `utils`, the
   * bare name refuses while `framework.utils` still resolves.
   *
   * Dropping leading segments of the SEARCHED name is kept as a second step, for
   * the mirror-image case where the import is more qualified than the module —
   * `import myproject.framework` when analysis was rooted inside `myproject`.
   */
  private findModule(
    name: string,
    moduleByQualifiedName: Map<string, ProjectModuleFacts>
  ): ProjectModuleFacts | undefined {
    const exact = moduleByQualifiedName.get(name);
    if (exact) {
      return exact;
    }

    const bySuffix = this.moduleSuffixIndex.get(name);
    if (bySuffix) {
      return bySuffix;
    }

    const parts = name.split('.');
    for (let drop = 1; drop < parts.length; drop++) {
      const candidate = parts.slice(drop).join('.');
      const direct = moduleByQualifiedName.get(candidate);
      if (direct) {
        return direct;
      }
      const suffixed = this.moduleSuffixIndex.get(candidate);
      if (suffixed) {
        return suffixed;
      }
    }
    return undefined;
  }

  /**
   * Registers every module under every dotted suffix of its qualified name.
   *
   * Collisions map to `null` so an ambiguous short name refuses while the longer,
   * unambiguous one still resolves — the same rule the type index uses, for the
   * same reason: a guess here silently attaches a subclass to the wrong base.
   */
  private buildModuleSuffixIndex(modules: ProjectModuleFacts[]): void {
    this.moduleSuffixIndex = new Map();
    const seen = new Map<string, ProjectModuleFacts | null>();
    for (const module of modules) {
      const segments = module.qualifiedName.split('.');
      for (let start = segments.length - 1; start >= 0; start -= 1) {
        const suffix = segments.slice(start).join('.');
        if (seen.has(suffix)) {
          if (seen.get(suffix) !== module) {
            seen.set(suffix, null);
          }
          continue;
        }
        seen.set(suffix, module);
      }
    }
    for (const [suffix, module] of seen) {
      if (module) {
        this.moduleSuffixIndex.set(suffix, module);
      }
    }
  }

  private importTargetModule(
    record: PyImportRegistry,
    importingModule: string,
    importingIsPackage = false
  ): string | null {
    const level = record.getRelativeLevel();
    const stated = record.getIsModuleImport()
      ? record.getImportedPath()
      : record.getPackageOrTypeName();

    if (level === 0) {
      return stated === '' ? null : stated;
    }
    // The importing module's own package, then up (level - 1) more. A package's
    // `__init__.py` IS its package, so nothing is dropped for it.
    const parts = importingModule.split('.');
    if (!importingIsPackage) {
      parts.pop();
    }
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
    // Single-file: only this module's types are visible, so the suffix index
    // answers nested names (`TopOne.Inner`) and nothing cross-module.
    this.qualifiedSuffixIndex = this.buildQualifiedSuffixIndex(input.types);
    this.typesByNameByModuleName = new Map();

    // Bases first: MRO resolution depends on them.
    this.resolveTypeBases(input, typesByName);
    this.resolveAnnotations(input, typesByName);
    this.resolveTypeReferences(input, typesByName);

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

    // Attributes, indexed the way the schema says to join them: §2.10 deleted
    // `py_field_write` on the grounds that linking a write to its merged field
    // row is a resolution rule over `(pyTypeLinkHash, name)`, not a stored fact.
    const fieldByTypeAndName = new Map<string, PyFieldRegistry>();
    // See the project pass: an attribute usually has more than one row, and the
    // annotation may be on a different row from the assignment.
    const fieldsByTypeAndName = new Map<string, PyFieldRegistry[]>();
    for (const field of input.fields) {
      const key = `${field.getPyTypeLinkHash()}||${field.getName()}`;
      fieldsByTypeAndName.set(key, [...(fieldsByTypeAndName.get(key) ?? []), field]);
      const incumbent = fieldByTypeAndName.get(key);
      // A class attribute and an instance attribute can share a name. The
      // instance one wins, because that is what a read through a receiver
      // actually reaches once `__init__` has run.
      if (!incumbent || incumbent.getFieldModifier().includes('CLASS_VAR')) {
        fieldByTypeAndName.set(key, field);
      }
    }

    // Parameter flow and factory returns must work in single-file extraction too,
    // not only in the project pass. They were project-only, which meant the
    // commonest attribute shape of all — `self.pool = pool` with `pool: Pool` one
    // line above — resolved for a directory and not for a file.
    const parametersByMethod = new Map<string, PyMethodParameterRegistry[]>();
    for (const parameter of input.methodParameters) {
      const list = parametersByMethod.get(parameter.getPyMethodLinkHash()) ?? [];
      list.push(parameter);
      parametersByMethod.set(parameter.getPyMethodLinkHash(), list);
    }
    const moduleMethodsByName = this.uniqueByName(
      input.methods.filter(m => m.getPyTypeLinkHash() === ''),
      m => m.getName()
    );

    this.linkAttributeExpressionsToFields(input, {
      typesByHash,
      basesByType,
      mroCache,
      fieldByTypeAndName,
    });

    const returnedTypeByMethod = this.buildReturnTypeIndex(input, {
      entityByBinding,
      bindingByScopeAndName,
      parentScopeOf,
      typesByName,
      moduleMethodsByName,
      methodsByTypeAndName,
      typesByHash,
      basesByType,
      mroCache,
    });
    const localTypeByBinding = this.buildLocalTypeIndex(input, {
      entityByBinding,
      bindingByScopeAndName,
      parentScopeOf,
      returnedTypeByMethod,
      typesByName,
      moduleMethodsByName,
      methodsByTypeAndName,
      typesByHash,
      basesByType,
      mroCache,
    });

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
        fieldByTypeAndName,
        fieldsByTypeAndName,
        receiverNameByMethodHash: input.receiverNameByMethodHash,
        parametersByMethod,
        moduleMethodsByName,
        localTypeByBinding,
        returnedTypeByMethod,
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
      // A dotted base (`class T(unittest.TestCase)`) is resolved by WALKING the
      // segments, not by matching its rightmost one against local classes —
      // which would claim a local `TestCase` that has nothing to do with it. This
      // used to be skipped outright, and the cost was measured: `unittest.TestCase`
      // unresolved 244 times, taking 3,201 self.assertEqual-style calls with it,
      // since a method is only reachable through the MRO once the base resolves.
      const dotted = base.getBaseDottedPath();
      const target = dotted.includes('.')
        ? this.resolveDottedTypeName(dotted, {
            typesByName,
            qualifiedSuffixIndex: this.qualifiedSuffixIndex,
            typesByNameByModuleName: this.typesByNameByModuleName,
          })
        : typesByName.get(simpleName);
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
      fieldByTypeAndName: Map<string, PyFieldRegistry>;
      receiverNameByMethodHash: Map<string, string>;
      fieldTypeByHash?: Map<string, PyTypeRegistry>;
      parametersByMethod?: Map<string, PyMethodParameterRegistry[]>;
      moduleMethodsByName?: Map<string, PyMethodRegistry | null>;
      /** Bound module name -> that module's facts, for in-project imports. */
      importedModules?: Map<string, ProjectModuleFacts>;
      exportsByModule?: Map<string, Map<string, PyMethodRegistry | PyTypeRegistry>>;
      moduleByQualifiedName?: Map<string, ProjectModuleFacts>;
      localTypeByBinding?: Map<string, PyTypeRegistry | null>;
      returnedTypeByMethod?: Map<string, PyTypeRegistry | null>;
      innerCallReturnType?: Map<string, PyTypeRegistry>;
    }
  ): { kind: PythonResolvedCalleeKind; hash: string } | null {
    const name = callSite.getCalleeName();
    if (name === '') {
      return null;
    }

    switch (callSite.getReceiverKind()) {
      case PythonReceiverKind.NONE: {
        // `cls(...)` inside a classmethod constructs the enclosing class.
        if (name === 'cls' && callSite.getPyTypeLinkHash() !== '') {
          const enclosing = ctx.typesByHash.get(callSite.getPyTypeLinkHash());
          if (enclosing) {
            return { kind: PythonResolvedCalleeKind.TYPE, hash: enclosing.getHash() };
          }
        }

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
        // A receiver that names a LOCAL VARIABLE: `runner = Runner()` then
        // `runner.run()`. The local's type comes from what was assigned to it,
        // which is the same three grounds an attribute uses — a constructor, a
        // factory's return annotation, or an annotation. This is the single
        // largest unresolved bucket in real code, because most receivers are
        // ordinary locals rather than `self` or a module.
        const localType =
          this.typeOfLocalReceiver(callSite, ctx) ??
          this.typeOfParameterReceiver(callSite, ctx);
        if (localType) {
          const onLocal = this.lookupMethodOnTypeAndBases(localType.getHash(), name, ctx);
          if (onLocal) {
            return { kind: PythonResolvedCalleeKind.METHOD, hash: onLocal.getHash() };
          }
        }

        // A receiver that names a class in this module: `Base.make_default()`.
        // The method may be inherited, so the local MRO is walked.
        const receiver = callSite.getReceiverText();
        const type = receiver === '' ? null : ctx.typesByName.get(receiver);
        if (!type) {
          // A receiver naming a module. If that module is IN THIS ANALYSIS the
          // target is a real entity, so the call gets a concrete hash rather than
          // a bare `IMPORTED` — `events.get_event_loop()` inside asyncio reaches
          // the actual function. Only when the module is genuinely outside does
          // `IMPORTED` with an empty hash remain the honest answer: the fact that
          // it is reached through an import is real, and a hash would be invented.
          const inProject = receiver === '' ? undefined : ctx.importedModules?.get(receiver);
          if (inProject) {
            const member = this.lookupModuleMember(
              inProject,
              name,
              ctx.exportsByModule,
              ctx.moduleByQualifiedName
            );
            if (member) {
              return this.describeEntity(member);
            }
          }
          if (receiver !== '' && ctx.importedModuleNames.has(receiver)) {
            return { kind: PythonResolvedCalleeKind.IMPORTED, hash: '' };
          }
          return null;
        }
        // A NESTED CLASS constructor: `TopOne.Inner()` names a type, not a
        // method, so looking only for methods missed it entirely even though the
        // same dotted name resolves fine in an annotation.
        const nested = this.lookupNestedType(type, name, ctx);
        if (nested) {
          return { kind: PythonResolvedCalleeKind.TYPE, hash: nested.getHash() };
        }
        const method = this.lookupMethodOnTypeAndBases(type.getHash(), name, ctx);
        return method ? { kind: PythonResolvedCalleeKind.METHOD, hash: method.getHash() } : null;
      }

      case PythonReceiverKind.ATTRIBUTE: {
        return this.resolveAttributeReceiver(callSite, name, ctx);
      }

      case PythonReceiverKind.CALL_RESULT: {
        return this.resolveCallResultReceiver(callSite, name, ctx);
      }

      // A SUBSCRIPT or UNKNOWN receiver needs an element type, which nothing in
      // the emitted set carries: `handlers[key]()` reaches whatever was put into
      // the container, and the container's writes are not tracked per element.
      default: {
        return null;
      }
    }
  }


  /**
   * Resolves `self.conn.send()` — an ATTRIBUTE receiver.
   *
   * This was 0/2,537 before `py_field` existed, and the reason is worth stating
   * precisely: the call is not hard to resolve, it was *missing a fact*. Reaching
   * `send` needs the type of `conn`, and no relation carried it.
   *
   * The chain is three joins, and it refuses at every one it cannot make:
   *
   * 1. The receiver must be rooted at THIS method's receiver parameter, so
   *    `self.conn` counts and `other.conn` does not — the latter is an attribute
   *    of a class this call site knows nothing about.
   * 2. The attribute must resolve to one `py_field` on the enclosing class or its
   *    MRO, which is where an inherited attribute is found.
   * 3. That field must name exactly one type IN THIS MODULE, from its annotation
   *    or from a constructor initialiser.
   *
   * A receiver whose head is an imported module (`os.path.join`) is reported as
   * `IMPORTED` with no hash, matching how a NAME receiver on a module is handled:
   * the target is outside the analysis, so a hash would be invented, but "reached
   * through an import" is a fact and beats silence.
   */
  private resolveAttributeReceiver(
    callSite: PyCallSiteRegistry,
    calleeName: string,
    ctx: {
      typesByHash: Map<string, PyTypeRegistry>;
      typesByName: Map<string, PyTypeRegistry | null>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      methodsByTypeAndName: Map<string, PyMethodRegistry[]>;
      mroCache: Map<string, string[] | null>;
      importedModuleNames: Set<string>;
      fieldByTypeAndName: Map<string, PyFieldRegistry>;
      fieldsByTypeAndName?: Map<string, PyFieldRegistry[]>;
      receiverNameByMethodHash: Map<string, string>;
      fieldTypeByHash?: Map<string, PyTypeRegistry>;
      parametersByMethod?: Map<string, PyMethodParameterRegistry[]>;
      moduleMethodsByName?: Map<string, PyMethodRegistry | null>;
      importedModules?: Map<string, ProjectModuleFacts>;
      exportsByModule?: Map<string, Map<string, PyMethodRegistry | PyTypeRegistry>>;
      moduleByQualifiedName?: Map<string, ProjectModuleFacts>;
    }
  ): { kind: PythonResolvedCalleeKind; hash: string } | null {
    const receiverText = callSite.getReceiverText();
    if (receiverText === '') {
      return null;
    }
    const segments = receiverText.split('.');

    // A dotted receiver naming a TYPE: `TopOne.Inner.Deepest()` constructs a
    // doubly-nested class. The annotation path already walked these names; the
    // CALL path did not, so the same name resolved in one position and not the
    // other.
    const receiverType = this.resolveDottedTypeName(receiverText, {
      typesByName: ctx.typesByName,
      qualifiedSuffixIndex: this.qualifiedSuffixIndex,
      typesByNameByModuleName: this.typesByNameByModuleName,
    });
    if (receiverType) {
      const nested = this.lookupNestedType(receiverType, calleeName, ctx);
      if (nested) {
        return { kind: PythonResolvedCalleeKind.TYPE, hash: nested.getHash() };
      }
      const onType = this.lookupMethodOnTypeAndBases(receiverType.getHash(), calleeName, ctx);
      if (onType) {
        return { kind: PythonResolvedCalleeKind.METHOD, hash: onType.getHash() };
      }
    }

    // A dotted receiver whose head names an IN-PROJECT module:
    // `pkg.mod.function()`. Resolvable to a real entity, unlike a stdlib path.
    const headModule = ctx.importedModules?.get(segments[0] ?? '');
    if (headModule && segments.length === 2) {
      const member = this.lookupModuleMember(
        headModule,
        segments[1] ?? '',
        ctx.exportsByModule,
        ctx.moduleByQualifiedName
      );
      if (member instanceof PyTypeRegistry) {
        const onMember = this.lookupMethodOnTypeAndBases(member.getHash(), calleeName, ctx);
        if (onMember) {
          return { kind: PythonResolvedCalleeKind.METHOD, hash: onMember.getHash() };
        }
      }
    }

    // `os.path.join(...)` — the head names a module outside the analysis.
    if (ctx.importedModuleNames.has(segments[0] ?? '')) {
      return { kind: PythonResolvedCalleeKind.IMPORTED, hash: '' };
    }

    if (segments.length !== 2) {
      // `self.a.b.c()` needs the type of `self.a.b`, which needs `self.a` first.
      // Each hop multiplies the chance of a wrong answer, and the schema asks for
      // a single DERIVABLE target — so the parser stops and the engine chains,
      // which it can do because every individual hop is linked.
      return null;
    }

    // The type the receiver PREFIX holds. `self.x` uses the enclosing class;
    // `builder.x` uses the type of the local `builder`, which is the same
    // question one step removed. Handling only `self` meant an attribute of any
    // other typed receiver was unreachable even when both hops were known.
    const receiverName = ctx.receiverNameByMethodHash.get(callSite.getPyMethodLinkHash());
    const prefix = segments[0] ?? '';
    let ownerType = '';
    if (receiverName !== undefined && prefix === receiverName) {
      ownerType = callSite.getPyTypeLinkHash();
    } else {
      const prefixType =
        this.typeOfLocalReceiver(callSite, ctx, prefix) ??
        this.typeOfParameterReceiver(callSite, ctx, prefix);
      ownerType = prefixType ? prefixType.getHash() : '';
    }
    if (ownerType === '') {
      return null;
    }

    const rows = this.lookupFieldRowsOnTypeAndBases(ownerType, segments[1] ?? '', ctx);
    const field = rows[0] ?? this.lookupFieldOnTypeAndBases(ownerType, segments[1] ?? '', ctx);
    if (!field) {
      return null;
    }
    // Prefer the type settled in the DECLARING module's namespace; fall back to
    // this module's only when the project pass has not run. Every row for the
    // name is tried, because the annotation and the assignment are different
    // rows and either may carry the answer.
    let fieldType: PyTypeRegistry | null = null;
    for (const row of rows.length > 0 ? rows : [field]) {
      fieldType = ctx.fieldTypeByHash?.get(row.getHash()) ?? this.typeOfField(row, ctx);
      if (fieldType) {
        break;
      }
    }
    if (fieldType) {
      const method = this.lookupMethodOnTypeAndBases(fieldType.getHash(), calleeName, ctx);
      return method ? { kind: PythonResolvedCalleeKind.METHOD, hash: method.getHash() } : null;
    }

    // No project class, but the attribute may still hold a BUILTIN whose method
    // set is known exactly.
    // An attribute written with two different builtin types is not either of
    // them. `self.result = []` here and `self.result = None` there means
    // `self.result.append(x)` may well be an AttributeError at runtime, and
    // reporting it as `list.append` would launder a bug into a fact.
    const builtinType = field.getIsAmbiguous()
      ? ''
      : this.builtinTypeOfField(field, this.annotationFlowingInto(field, ctx));
    if (builtinType !== '') {
      const members = PYTHON_BUILTIN_TYPE_METHODS.get(builtinType);
      if (members?.has(calleeName)) {
        return { kind: PythonResolvedCalleeKind.BUILTIN, hash: '' };
      }
    }
    return null;
  }

  /**
   * Maps each CALL_RESULT call site to the return type of its INNER call.
   *
   * Built after a first resolution pass, because it depends on the inner call
   * already being resolved. The join is structural: the inner call is the
   * RECEIVER child of the outer call in the expression tree, so this never
   * matches on receiver text, which would conflate two identical calls on one
   * line.
   *
   * This is the parser doing exactly ONE hop — inner callee to its declared or
   * inferred return type — and no more. A longer chain stays for the engine,
   * which can walk it precisely because each hop is linked.
   */
  private buildInnerCallReturnIndex(
    module: ResolutionInput,
    methodByHash: Map<string, PyMethodRegistry>,
    returnedTypeByMethod: Map<string, PyTypeRegistry | null>,
    typesByHash: Map<string, PyTypeRegistry>
  ): Map<string, PyTypeRegistry> {
    const index = new Map<string, PyTypeRegistry>();
    const callSiteByExpression = new Map<string, PyCallSiteRegistry>();
    for (const site of module.callSites) {
      callSiteByExpression.set(site.getPyExpressionLinkHash(), site);
    }
    // `reg.first().label()` nests as CALL -> ATTRIBUTE_ACCESS(RECEIVER) ->
    // CALL(ATTRIBUTE_OBJECT), so the inner call is a GRANDCHILD, not a child.
    // Looking only one level down found nothing and the whole index came back
    // empty — the rule was right and the tree walk was wrong.
    const childrenByParent = new Map<string, PyExpressionRegistry[]>();
    for (const expression of module.expressions) {
      const parent = expression.getParentExpressionHash();
      if (parent === '') {
        continue;
      }
      const list = childrenByParent.get(parent) ?? [];
      list.push(expression);
      childrenByParent.set(parent, list);
    }
    const innerCallOf = (outerHash: string): PyExpressionRegistry | undefined => {
      for (const child of childrenByParent.get(outerHash) ?? []) {
        if (child.getEdgeRole() !== PythonEdgeRole.RECEIVER) {
          continue;
        }
        if (child.getKind() === PythonExpressionKind.CALL) {
          return child;
        }
        if (child.getKind() === PythonExpressionKind.ATTRIBUTE_ACCESS) {
          for (const inner of childrenByParent.get(child.getHash()) ?? []) {
            if (inner.getKind() === PythonExpressionKind.CALL) {
              return inner;
            }
          }
        }
      }
      return undefined;
    };

    for (const site of module.callSites) {
      if (site.getReceiverKind() !== PythonReceiverKind.CALL_RESULT) {
        continue;
      }
      const inner = innerCallOf(site.getPyExpressionLinkHash());
      if (!inner) {
        continue;
      }
      const innerSite = callSiteByExpression.get(inner.getHash());
      const innerTarget = innerSite?.getResolvedCalleeHash() ?? '';
      if (innerTarget === '') {
        continue;
      }
      // The inner call may construct a class, in which case the receiver IS that
      // class; otherwise it is a method and the receiver is its return type.
      const constructed = typesByHash.get(innerTarget);
      if (constructed) {
        index.set(site.getHash(), constructed);
        continue;
      }
      const method = methodByHash.get(innerTarget);
      if (!method) {
        continue;
      }
      const returned = this.returnedTypeOf(method, {
        typesByName: new Map(),
        returnedTypeByMethod,
      });
      if (returned) {
        index.set(site.getHash(), returned);
      }
    }
    return index;
  }

  /**
   * Resolves `make_conn().send()` — a CALL_RESULT receiver.
   *
   * Needs no relation that does not already exist: the inner call's callee has a
   * `-> T` annotation, and `T` names a class. So the rule is to resolve the inner
   * call FIRST, read its return annotation, and look the method up on that.
   *
   * The inner callee is resolved through the same machinery as any other name
   * rather than matched textually, so `make_conn` means the `make_conn` this
   * scope actually sees. If the callee has no return annotation the answer is
   * refused: a function returning an unannotated value could return anything, and
   * inferring it would require the whole-body return analysis that belongs to the
   * engine.
   */
  private resolveCallResultReceiver(
    callSite: PyCallSiteRegistry,
    calleeName: string,
    ctx: {
      typesByHash: Map<string, PyTypeRegistry>;
      typesByName: Map<string, PyTypeRegistry | null>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      methodsByTypeAndName: Map<string, PyMethodRegistry[]>;
      mroCache: Map<string, string[] | null>;
      entityByBinding: Map<string, PyMethodRegistry | PyTypeRegistry>;
      bindingByScopeAndName: Map<string, PyBindingRegistry>;
      parentScopeOf: Map<string, string>;
      innerCallReturnType?: Map<string, PyTypeRegistry>;
    }
  ): { kind: PythonResolvedCalleeKind; hash: string } | null {
    const receiverText = callSite.getReceiverText();

    // `self._get_loop().create_future()` — the receiver is a call on THIS class,
    // which is the commonest shape of all: 6 of asyncio's 12 CALL_RESULT sites.
    // The inner method is found on the MRO, so an inherited one works too.
    const selfMethod = /^(?:self|cls)\.([A-Za-z_][A-Za-z0-9_]*)\(/.exec(receiverText);
    if (selfMethod) {
      const owner = callSite.getPyTypeLinkHash();
      if (owner === '') {
        return null;
      }
      const innerMethod = this.lookupMethodOnTypeAndBases(owner, selfMethod[1]!, ctx);
      if (!innerMethod) {
        return null;
      }
      const returnedFromSelf = this.returnedTypeOf(innerMethod, ctx);
      if (!returnedFromSelf) {
        return null;
      }
      const found = this.lookupMethodOnTypeAndBases(returnedFromSelf.getHash(), calleeName, ctx);
      return found ? { kind: PythonResolvedCalleeKind.METHOD, hash: found.getHash() } : null;
    }

    // The receiver is a call that THIS analysis already resolved: `reg.first()`
    // in `reg.first().label()`. Rather than re-deriving the receiver's type,
    // take the inner call's own resolved callee and read its return type — one
    // hop off a link that already exists. The inner site is found through the
    // expression tree, where it is the RECEIVER child of the outer call, so the
    // join is structural rather than a text match on the receiver.
    if (ctx.innerCallReturnType) {
      const chained = ctx.innerCallReturnType.get(callSite.getHash());
      if (chained) {
        const found = this.lookupMethodOnTypeAndBases(chained.getHash(), calleeName, ctx);
        if (found) {
          return { kind: PythonResolvedCalleeKind.METHOD, hash: found.getHash() };
        }
        return null;
      }
    }

    // Otherwise only a direct `name()` receiver. `a.b()` and `f()()` need a
    // receiver type this rule has not established, and each extra hop compounds
    // the chance of a wrong answer.
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\(/.exec(receiverText);
    if (!match) {
      return null;
    }
    const innerName = match[1]!;
    const inner = this.lookupInScopeChain(innerName, callSite.getPyScopeLinkHash(), ctx);
    if (!inner) {
      return null;
    }
    // `Conn().send()` — the inner name is a CLASS, so the receiver is an instance
    // of it. This is the one case needing no return annotation at all, because
    // calling a class always yields an instance of that class.
    if (inner instanceof PyTypeRegistry) {
      const method = this.lookupMethodOnTypeAndBases(inner.getHash(), calleeName, ctx);
      return method ? { kind: PythonResolvedCalleeKind.METHOD, hash: method.getHash() } : null;
    }
    const returned = this.returnedTypeOf(inner, ctx);
    if (!returned) {
      return null;
    }
    const method = this.lookupMethodOnTypeAndBases(returned.getHash(), calleeName, ctx);
    return method ? { kind: PythonResolvedCalleeKind.METHOD, hash: method.getHash() } : null;
  }

  /**
   * The class a method's `-> T` annotation names, when it names one.
   *
   * `Optional[Conn]` and `Conn | None` both resolve to `Conn`: a call on the
   * result may raise at runtime if it is `None`, but the only class involved is
   * `Conn`, and refusing here would lose the common annotated case for a reason
   * that belongs to null analysis rather than to type resolution.
   */
  private returnedTypeOf(
    method: PyMethodRegistry,
    ctx: {
      typesByName: Map<string, PyTypeRegistry | null>;
      returnedTypeByMethod?: Map<string, PyTypeRegistry | null>;
    }
  ): PyTypeRegistry | null {
    const annotation = method.getReturnTypeName();
    if (annotation === '') {
      // No `-> T`. The RETURN STATEMENT can still settle it: `def make_registry():
      // return Registry()` says what it hands back as plainly as an annotation
      // would. This matters far more than the annotated case on real code — the
      // CPython stdlib annotates 0.0% of returns, so annotation-only return
      // typing reads nothing there.
      return ctx.returnedTypeByMethod?.get(method.getHash()) ?? null;
    }
    for (const candidate of this.namedTypesIn(annotation)) {
      const resolved = ctx.typesByName.get(candidate);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }

  /**
   * The class names in an annotation, outermost first.
   *
   * `Optional[Conn]` yields `Optional`, `Conn`; the first that resolves to a real
   * class wins, which lands on `Conn` because `Optional` is not a class in the
   * analysed code. A container annotation such as `List[Conn]` correctly yields
   * nothing: the call is on the LIST, not on a `Conn`.
   */
  private namedTypesIn(annotation: string): string[] {
    const heads = annotation
      .split(/[\[\],|]/)
      .map(part => (part.split('.').pop() ?? '').trim())
      .filter(part => part !== '' && part !== 'None');
    const containers = new Set([
      'List', 'Dict', 'Set', 'Tuple', 'FrozenSet', 'Sequence', 'Iterable',
      'Iterator', 'Generator', 'Mapping', 'MutableMapping', 'Awaitable',
      'Coroutine', 'AsyncIterator', 'AsyncGenerator',
      'list', 'dict', 'set', 'tuple', 'frozenset',
    ]);
    if (heads.length > 0 && containers.has(heads[0]!)) {
      return [];
    }
    return heads;
  }

  /**
   * A module-level function or class of the given name, when exactly one exists.
   *
   * Only module-level entities count: a method of some class in that module is
   * not reachable as `module.name`, and a nested function is not either.
   */
  private lookupModuleMember(
    module: ProjectModuleFacts,
    name: string,
    exportsByModule?: Map<string, Map<string, PyMethodRegistry | PyTypeRegistry>>,
    moduleByQualifiedName?: Map<string, ProjectModuleFacts>
  ): PyMethodRegistry | PyTypeRegistry | null {
    const methods = module.methods.filter(
      m =>
        m.getName() === name &&
        m.getPyTypeLinkHash() === '' &&
        m.getEnclosingMemberLinkHash() === ''
    );
    const types = module.types.filter(
      t =>
        t.getName() === name &&
        t.getEnclosingTypeLinkHash() === '' &&
        t.getEnclosingMethodLinkHash() === ''
    );
    if (methods.length + types.length === 1) {
      return methods[0] ?? types[0] ?? null;
    }
    if (methods.length + types.length > 1) {
      return null;
    }
    // Nothing DECLARED under that name — but a package almost never declares its
    // public API, it re-exports it. `util.warn(...)` reaches
    // sqlalchemy/util/__init__.py, which imports `warn` from langhelpers, so a
    // declaration-only lookup finds nothing for the commonest shape in a large
    // codebase. This is the same re-export walk imports already use; it simply
    // was not reached from here.
    if (exportsByModule && moduleByQualifiedName) {
      return (
        this.followReExport(name, module, exportsByModule, moduleByQualifiedName) ?? null
      );
    }
    return null;
  }

  /**
   * A class nested directly inside another, by name.
   *
   * `TopOne.Inner()` is a constructor call on a nested class. The qualified-name
   * suffix index answers it directly, but the enclosing-type check is what keeps
   * it honest: it must be nested in THIS class, not merely share a suffix with
   * something else.
   */
  private lookupNestedType(
    outer: PyTypeRegistry,
    name: string,
    ctx: { typesByHash: Map<string, PyTypeRegistry> }
  ): PyTypeRegistry | null {
    for (const candidate of ctx.typesByHash.values()) {
      if (
        candidate.getName() === name &&
        candidate.getEnclosingTypeLinkHash() === outer.getHash()
      ) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Finds an attribute on a class or anything it inherits from.
   *
   * Walks the MRO rather than the class alone, because an attribute set in a
   * base's `__init__` is every subclass's attribute too — that is the ordinary
   * case in a class hierarchy, not an edge one.
   */
  private lookupFieldOnTypeAndBases(
    typeHash: string,
    attributeName: string,
    ctx: {
      typesByHash: Map<string, PyTypeRegistry>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      mroCache: Map<string, string[] | null>;
      fieldByTypeAndName: Map<string, PyFieldRegistry>;
    }
  ): PyFieldRegistry | null {
    if (attributeName === '') {
      return null;
    }
    // A class is always first in its own MRO — see lookupFieldRowsOnTypeAndBases.
    const own = ctx.fieldByTypeAndName.get(`${typeHash}||${attributeName}`);
    if (own) {
      return own;
    }
    const mro = this.linearize(typeHash, ctx, new Set<string>());
    if (!mro) {
      return null;
    }
    for (const candidate of mro) {
      const field = ctx.fieldByTypeAndName.get(`${candidate}||${attributeName}`);
      if (field) {
        return field;
      }
    }
    return null;
  }

  /**
   * Every `py_field` row for an attribute name, nearest declaring class first.
   *
   * An attribute commonly has more than one row, because `fieldOrigin` is part
   * of its identity: `dialect: Dialect` in the class body and
   * `self.dialect = ...` in `__init__` are two facts about one attribute. Typing
   * has to see BOTH — the annotation is on one and the assignment on the other —
   * so a lookup that returns only the preferred row can find an attribute and
   * still fail to type it.
   */
  private lookupFieldRowsOnTypeAndBases(
    typeHash: string,
    attributeName: string,
    ctx: {
      typesByHash: Map<string, PyTypeRegistry>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      mroCache: Map<string, string[] | null>;
      fieldsByTypeAndName?: Map<string, PyFieldRegistry[]>;
    }
  ): PyFieldRegistry[] {
    if (attributeName === '' || !ctx.fieldsByTypeAndName) {
      return [];
    }
    // A class is always FIRST in its own MRO, so its own attributes need no
    // linearisation and cannot be shadowed by an opaque base. Requiring the MRO
    // here refused every `self.<attr>.m()` in a class with ANY unresolvable base
    // — and `class Connection(ConnectionEventsTarget, inspection.Inspectable["Inspector"])`
    // is the ordinary shape in real code, not an edge case. The identical fix
    // was already made for METHOD lookup; fields never got it, which is why
    // ATTRIBUTE resolution read 0 of 227 on SQLAlchemy's engine package.
    const own = ctx.fieldsByTypeAndName.get(`${typeHash}||${attributeName}`);
    if (own && own.length > 0) {
      return this.annotatedFirst(own);
    }

    const mro = this.linearize(typeHash, ctx, new Set<string>());
    if (!mro) {
      return [];
    }
    for (const candidate of mro) {
      const rows = ctx.fieldsByTypeAndName.get(`${candidate}||${attributeName}`);
      if (rows && rows.length > 0) {
        return this.annotatedFirst(rows);
      }
    }
    return [];
  }

  /**
   * Orders field rows so an ANNOTATED one is tried first.
   *
   * Which row a READ reaches at runtime is a different question from which row
   * states the type. `dialect: Dialect` in the class body says what the
   * attribute holds; `self.dialect = ...` in `__init__` says when it is set.
   */
  private annotatedFirst(rows: PyFieldRegistry[]): PyFieldRegistry[] {
    return [...rows].sort((left, right) => {
      const l = left.getFieldTypeName() === '' ? 1 : 0;
      const r = right.getFieldTypeName() === '' ? 1 : 0;
      return l - r;
    });
  }

  /**
   * The type an attribute holds, when the source says so unambiguously.
   *
   * Two grounds are admitted, in order of strength. An ANNOTATION is the
   * programmer stating the type. A CONSTRUCTOR INITIALISER is stronger still in
   * one respect — `self.buf = Buffer()` cannot hold anything else at that
   * point — but only if the name resolves to a class in this module; if it
   * resolves to nothing, or to a function, it is a factory whose return type is
   * unknown and this refuses.
   *
   * A literal initialiser (`self.items = []`) types the attribute as a BUILTIN,
   * which is real information and is recorded on the expression row, but it
   * yields no `py_type` to look a method up on, so it cannot resolve a call here.
   */
  private typeOfField(
    field: PyFieldRegistry,
    ctx: {
      typesByName: Map<string, PyTypeRegistry | null>;
      parametersByMethod?: Map<string, PyMethodParameterRegistry[]>;
      moduleMethodsByName?: Map<string, PyMethodRegistry | null>;
    }
  ): PyTypeRegistry | null {
    // `Optional[Conn]` and `Conn | None` must reach `Conn`, so the whole
    // annotation is scanned rather than just its head. A container annotation
    // such as `List[Conn]` correctly yields nothing here: a call on the attribute
    // is a call on the LIST, not on a `Conn`.
    const annotation = field.getFieldTypeName();
    if (annotation !== '') {
      for (const candidate of this.namedTypesIn(annotation)) {
        const byAnnotation = ctx.typesByName.get(candidate);
        if (byAnnotation) {
          return byAnnotation;
        }
      }
    }
    if (field.getInitializerKind() === PythonInitializerKind.CALL) {
      const calleeText = field.getInitializerText().split('(')[0] ?? '';
      const calleeName = (calleeText.split('.').pop() ?? '').trim();
      // A dotted callee names something outside this module even when its last
      // segment collides with a local class.
      if (calleeName !== '' && !calleeText.includes('.')) {
        const byConstructor = ctx.typesByName.get(calleeName);
        if (byConstructor) {
          return byConstructor;
        }
        // Not a class — but a FACTORY function with a `-> T` annotation says what
        // it hands back, so `self.pool = make_pool()` types the attribute too.
        const factory = ctx.moduleMethodsByName?.get(calleeName);
        if (factory) {
          const returned = this.returnedTypeOf(factory, ctx);
          if (returned) {
            return returned;
          }
        }
      }
    }
    // `self._loop = loop` in `def __init__(self, loop: AbstractEventLoop)`.
    // The attribute holds whatever was PASSED IN, so the parameter's annotation
    // is the attribute's type — the single largest bucket in the measurement,
    // and the one place where argument flow already carries the answer. Only the
    // declaring method's own parameters are consulted: a same-named parameter on
    // a different method says nothing about this attribute.
    if (
      field.getInitializerKind() === PythonInitializerKind.NAME &&
      ctx.parametersByMethod !== undefined
    ) {
      const parameters = ctx.parametersByMethod.get(field.getDeclaringMethodLinkHash()) ?? [];
      const source = field.getInitializerText();
      for (const parameter of parameters) {
        if (parameter.getParamName() !== source) {
          continue;
        }
        const annotationText = parameter.getParameterTypeName();
        if (annotationText === '') {
          return null;
        }
        for (const candidate of this.namedTypesIn(annotationText)) {
          const resolved = ctx.typesByName.get(candidate);
          if (resolved) {
            return resolved;
          }
        }
        return null;
      }
    }
    return null;
  }

  /**
   * The BUILTIN type an attribute holds, when a literal or a builtin constructor
   * settles it.
   *
   * `self._buffer = bytearray()` then `self._buffer.extend(d)` reaches
   * `bytearray.extend`. There is no `py_method` row for a builtin, so the hash
   * stays empty and only the KIND is claimed — the same treatment a bare
   * `len(x)` already gets, and strictly better than `UNRESOLVED`.
   *
   * The method name is checked against that type's real attribute set rather than
   * assumed. Without the check, `self._items = []` followed by
   * `self._items.frobnicate()` would be reported as a builtin call, which is both
   * wrong and hides a genuine bug in the analysed code.
   */
  private builtinTypeOfField(
    field: PyFieldRegistry,
    annotationOverride?: string
  ): string {
    // An annotation naming a builtin is the strongest evidence available:
    // `self.label: str` or a parameter annotated `str` flowing into it.
    const annotation = annotationOverride ?? field.getFieldTypeName();
    const head = (annotation.split('[')[0] ?? '').split('.').pop()?.trim() ?? '';
    if (PYTHON_BUILTIN_TYPE_METHODS.has(head)) {
      return head;
    }
    const inferred = this.builtinLiteralType(field);
    if (inferred !== '') {
      return inferred;
    }
    if (field.getInitializerKind() !== PythonInitializerKind.CALL) {
      return '';
    }
    const calleeText = field.getInitializerText().split('(')[0] ?? '';
    const calleeName = (calleeText.split('.').pop() ?? '').trim();
    return PYTHON_BUILTIN_TYPE_METHODS.has(calleeName) ? calleeName : '';
  }

  /**
   * The annotation of the parameter whose value was assigned to this attribute.
   *
   * `def __init__(self, name: str): self.label = name` makes `self.label` a
   * `str`, so `self.label.upper()` reaches `str.upper`. Without this the
   * attribute has no annotation of its own and the information is simply lost,
   * even though it is written down one line away.
   */
  private annotationFlowingInto(
    field: PyFieldRegistry,
    ctx: { parametersByMethod?: Map<string, PyMethodParameterRegistry[]> }
  ): string | undefined {
    if (field.getInitializerKind() !== PythonInitializerKind.NAME) {
      return undefined;
    }
    const parameters = ctx.parametersByMethod?.get(field.getDeclaringMethodLinkHash()) ?? [];
    const source = field.getInitializerText();
    for (const parameter of parameters) {
      if (parameter.getParamName() === source) {
        return parameter.getParameterTypeName();
      }
    }
    return undefined;
  }

  /** The builtin type a literal initialiser produces, from its first character. */
  private builtinLiteralType(field: PyFieldRegistry): string {
    if (field.getInitializerKind() !== PythonInitializerKind.LITERAL) {
      return '';
    }
    const text = field.getInitializerText();
    if (text.startsWith('[')) {
      return 'list';
    }
    if (text.startsWith('(')) {
      return 'tuple';
    }
    // `{}` is a dict and `{1}` is a set — the same opening brace, so the
    // distinction is the presence of a colon at the top level. A `set` and a
    // `dict` share almost no methods, so guessing either way would be wrong half
    // the time.
    if (text.startsWith('{')) {
      if (text === '{}') {
        return 'dict';
      }
      return text.includes(':') ? 'dict' : 'set';
    }
    if (/^[a-zA-Z]*['"]/.test(text)) {
      return text.toLowerCase().startsWith('b') ? 'bytes' : 'str';
    }
    return '';
  }

  /**
   * Links every attribute expression to the `py_field` it reaches.
   *
   * Schema §2.10 deleted `py_field_write` because the write facts already live on
   * `py_expression` and the only thing it added was this join key. So the join is
   * performed here, as a resolution rule, and written to the polymorphic
   * `referencedEntityKind`/`referencedEntityHash` pair — which is exactly what
   * that pair is for.
   *
   * Both directions of use are covered by one rule: a STORE is the write that
   * created the attribute, a LOAD is a read of it, and both point at the same
   * merged field row.
   */
  private linkAttributeExpressionsToFields(
    input: ResolutionInput,
    ctx: {
      typesByHash: Map<string, PyTypeRegistry>;
      basesByType: Map<string, PyTypeBaseRegistry[]>;
      mroCache: Map<string, string[] | null>;
      fieldByTypeAndName: Map<string, PyFieldRegistry>;
    }
  ): number {
    let linked = 0;
    for (const expression of input.expressions) {
      if (expression.getKind() !== PythonExpressionKind.ATTRIBUTE_ACCESS) {
        continue;
      }
      if (expression.getReferencedEntityKind() !== PythonReferencedEntityKind.UNKNOWN) {
        continue;
      }
      const ownerType = expression.getPyTypeLinkHash();
      if (ownerType === '') {
        continue;
      }
      const dotted = expression.getDottedPath();
      // Only an attribute of the receiver. `self.a.b` names an attribute of
      // whatever `self.a` is, and pointing it at this class's `b` would be a
      // confident wrong answer.
      const segments = dotted === '' ? [] : dotted.split('.');
      if (segments.length !== 2) {
        continue;
      }
      const field = this.lookupFieldOnTypeAndBases(ownerType, segments[1] ?? '', ctx);
      if (!field) {
        continue;
      }
      expression.setReferencedEntity(PythonReferencedEntityKind.FIELD, field.getHash());
      linked += 1;
    }
    return linked;
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
