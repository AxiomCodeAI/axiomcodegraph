import * as fs from 'fs/promises';
import * as path from 'path';

import { MethodParameter } from '@/analysis-methods/java/MethodParameter';
import { MethodRegistry } from '@/analysis-methods/java/MethodRegistry';
import { MethodTypeParameter } from '@/analysis-methods/java/MethodTypeParameter';
import { AnnotationArgumentReference } from '@/analysis-types/java/AnnotationArgumentReference';
import { BlockRegistry } from '@/analysis-types/java/BlockRegistry';
import { CommentRegistry } from '@/analysis-types/java/CommentRegistry';
import { ImportRegistry } from '@/analysis-imports/java/ImportRegistry';
import { ImportKind } from '@/enums/java/imports';
import { ModuleDirective } from '@/analysis-types/java/ModuleDirective';
import { ModuleRegistry } from '@/analysis-types/java/ModuleRegistry';
import { EnumConstant } from '@/analysis-types/java/EnumConstant';
import { ExpressionReference } from '@/analysis-types/java/ExpressionReference';
import { FieldRegistry } from '@/analysis-types/java/FieldRegistry';
import { LocalVariableRegistry } from '@/analysis-types/java/LocalVariableRegistry';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeParameter } from '@/analysis-types/java/TypeParameter';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { TypeRegistry } from '@/analysis-types/java/TypeRegistry';
import { AnnotationContext } from '@/enums/java/annotations/AnnotationContext';
import { AnnotationKind } from '@/enums/java/annotations/AnnotationKind';
import { ArgumentValueType } from '@/enums/java/annotations/ArgumentValueType';
import { BlockKind } from '@/enums/java/blocks/BlockKind';
import { EdgeRole } from '@/enums/java/expressions/EdgeRole';
import { ReferencedEntityKind } from '@/enums/java/expressions/ReferencedEntityKind';
import { ExpressionKind } from '@/enums/java/expressions/ExpressionKind';
import { ExpressionOwnerKind } from '@/enums/java/expressions/ExpressionOwnerKind';
import { RootContext } from '@/enums/java/expressions/RootContext';
import { LocalVariableScopeKind } from '@/enums/java/local-variables/LocalVariableScopeKind';
import { TypeRefContext } from '@/enums/java/type-references/TypeRefContext';
import { TypeRefKind } from '@/enums/java/type-references/TypeRefKind';
import { TypeAccess } from '@/enums/java/types/TypeAccess';
import { TypeCategory } from '@/enums/java/types/TypeCategory';
import { TypeModifier } from '@/enums/java/types/TypeModifier';
import { TypePlacement } from '@/enums/java/types/TypePlacement';
import { MethodAccess } from '@/enums/java/methods/MethodAccess';
import { MethodKind } from '@/enums/java/methods/MethodKind';
import { MethodModifier } from '@/enums/java/methods/MethodModifier';
import { TypeRegistryExtractor, ImportExtractor } from '@/parsers/java/extractors';

import { sourceWalkPackages } from './java-gates/source-walk';

interface ExtractedEntities {
  types: TypeRegistry[];
  typeParams: TypeParameter[];
  typeRefs: TypeReference[];
  annotations: TypeAnnotation[];
  annotationArgs: AnnotationArgumentReference[];
  methods: MethodRegistry[];
  methodParams: MethodParameter[];
  methodTypeParams: MethodTypeParameter[];
  fields: FieldRegistry[];
  enumConstants: EnumConstant[];
  expressions: ExpressionReference[];
  localVariables: LocalVariableRegistry[];
  blocks: BlockRegistry[];
  comments: CommentRegistry[];
  modules: ModuleRegistry[];
  moduleDirectives: ModuleDirective[];
  imports: ImportRegistry[];
}

interface TestResult {
  testFile: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    types: number;
    typeParams: number;
    typeRefs: number;
    annotations: number;
    annotationArgs: number;
    methods: number;
    methodParams: number;
    methodTypeParams: number;
    fields: number;
    enumConstants: number;
    expressions: number;
    localVariables: number;
    blocks: number;
    comments: number;
  };
}

interface ValidationRule {
  description: string;
  validate: (e: ExtractedEntities) => { passed: boolean; message?: string };
}

export class JavaExtractorTestRunner {
  private testDataDir: string;
  private extractor: TypeRegistryExtractor;
  private importExtractor: ImportExtractor;
  private serviceVersionHash = 'test-version-hash';

  /** Every vocabulary value observed across all fixtures, for the coverage gate. */
  private observedVocabulary: Record<string, Set<string>> = {};

  /** Expression signatures of the commented fixture and its uncommented twin. */
  private commentTwins: Record<string, string[]> = {};

  constructor(testDataDir?: string) {
    this.testDataDir = testDataDir || path.join(process.cwd(), 'src', 'test-data', 'java');
    this.extractor = new TypeRegistryExtractor();
    this.importExtractor = new ImportExtractor();
  }

  /**
   * Run all tests in the test-data directory
   */
  async runAllTests(): Promise<void> {
    console.log('\n🧪 Java Extractor Test Suite\n');
    console.log('='.repeat(80));

    const categories = [
      'type-registry',
      'type-references',
      'type-parameters',
      'method-type-parameters',
      'annotations',
      'methods',
      'expressions',
      'local-variables',
      'blocks',
      'imports',
      'enums',
      'modules',
      'integration'
    ];

    // A category that is not registered is silently never run, so its fixtures assert nothing
    // while still looking like coverage. Comparing against the filesystem is what makes this
    // detectable: a check that iterates `categories` cannot notice its own omission.
    const unregistered = (await fs.readdir(this.testDataDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => !categories.includes(name));

    if (unregistered.length > 0) {
      console.error(
        `\n❌ Unregistered test-data directories: ${unregistered.join(', ')}\n` +
        `   Their fixtures never run. Add them to the categories list in this file.`
      );
      process.exitCode = 1;
      return;
    }

    const allResults: TestResult[] = [];
    
    for (const category of categories) {
      console.log(`\n📁 Testing: ${category}`);
      console.log('-'.repeat(80));
      
      const categoryResults = await this.runCategoryTests(category);
      allResults.push(...categoryResults);
    }

    this.printSummary(allResults);
    this.reportVocabularyCoverage();
    this.reportCommentInvariance();
  }

  /**
   * Run tests for a specific category
   */
  private async runCategoryTests(category: string): Promise<TestResult[]> {
    const categoryPath = path.join(this.testDataDir, category);
    
    try {
      const files = await fs.readdir(categoryPath);
      const javaFiles = files.filter(f => f.endsWith('.java'));
      
      const results: TestResult[] = [];
      
      for (const file of javaFiles) {
        const result = await this.runTest(category, file);
        results.push(result);
        this.printTestResult(result);
      }
      
      return results;
    } catch (error) {
      console.error(`❌ Error reading category ${category}:`, error);
      return [];
    }
  }

  /**
   * Run a single test file
   */
  private async runTest(category: string, filename: string): Promise<TestResult> {
    const filePath = path.join(this.testDataDir, category, filename);
    const content = await fs.readFile(filePath, 'utf-8');

    const result: TestResult = {
      testFile: `${category}/${filename}`,
      passed: true,
      errors: [],
      warnings: [],
      stats: {
        types: 0, typeParams: 0, typeRefs: 0, annotations: 0, annotationArgs: 0,
        methods: 0, methodParams: 0, methodTypeParams: 0,
        fields: 0, enumConstants: 0, expressions: 0, localVariables: 0, blocks: 0, comments: 0
      }
    };

    try {
      const types = this.extractor.extract(filePath, content, this.serviceVersionHash);
      
      const entities: ExtractedEntities = {
        types,
        typeParams: this.extractor.getExtractedTypeParameters(),
        typeRefs: this.extractor.getExtractedTypeReferences(),
        annotations: this.extractor.getExtractedAnnotations(),
        annotationArgs: this.extractor.getExtractedAnnotationArguments(),
        methods: this.extractor.getExtractedMethods(),
        methodParams: this.extractor.getExtractedMethodParameters(),
        methodTypeParams: this.extractor.getExtractedMethodTypeParameters(),
        fields: this.extractor.getExtractedFields(),
        enumConstants: this.extractor.getExtractedEnumConstants(),
        expressions: this.extractor.getExtractedExpressions(),
        localVariables: this.extractor.getExtractedLocalVariables(),
        blocks: this.extractor.getExtractedBlocks(),
        comments: this.extractor.getExtractedComments(),
        modules: this.extractor.getExtractedModules(),
        moduleDirectives: this.extractor.getExtractedModuleDirectives(),
        imports: this.importExtractor.extract(filePath, content, this.serviceVersionHash),
      };

      result.stats = {
        types: entities.types.length,
        typeParams: entities.typeParams.length,
        typeRefs: entities.typeRefs.length,
        annotations: entities.annotations.length,
        annotationArgs: entities.annotationArgs.length,
        methods: entities.methods.length,
        methodParams: entities.methodParams.length,
        methodTypeParams: entities.methodTypeParams.length,
        fields: entities.fields.length,
        enumConstants: entities.enumConstants.length,
        expressions: entities.expressions.length,
        localVariables: entities.localVariables.length,
        blocks: entities.blocks.length,
        comments: entities.comments.length,
      };

      // Run validations based on test file
      const validations = this.getValidationsForTest(category, filename);
      
      for (const validation of validations) {
        const validationResult = validation.validate(entities);
        
        if (!validationResult.passed) {
          result.passed = false;
          result.errors.push(`${validation.description}: ${validationResult.message || 'Failed'}`);
        }
      }

      // Check for hash uniqueness
      const hashChecks = this.validateHashUniqueness(entities);
      if (!hashChecks.passed) {
        result.passed = false;
        result.errors.push(...hashChecks.errors);
      }

      // Check referential integrity — every link hash must resolve to a real parent
      const linkChecks = this.validateReferentialIntegrity(entities);
      if (!linkChecks.passed) {
        result.passed = false;
        result.errors.push(...linkChecks.errors);
      }

      this.recordVocabulary(entities);
      this.recordCommentTwin(filename, entities);

      // Check that every row survives being written — one physical line, header field count
      const tsvChecks = this.validateTsvRowIntegrity(entities);
      if (!tsvChecks.passed) {
        result.passed = false;
        result.errors.push(...tsvChecks.errors);
      }

    } catch (error) {
      result.passed = false;
      result.errors.push(`Extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  // ==================== VALIDATION HELPERS ====================

  private rule(description: string, validate: (e: ExtractedEntities) => { passed: boolean; message?: string }): ValidationRule {
    return { description, validate };
  }

  private minCount(description: string, getter: (e: ExtractedEntities) => unknown[], min: number): ValidationRule {
    return this.rule(description, (e) => {
      const arr = getter(e);
      return { passed: arr.length >= min, message: `Expected >= ${min}, got ${arr.length}` };
    });
  }

  // ==================== VALIDATION RULES ====================

  private getValidationsForTest(category: string, filename: string): ValidationRule[] {
    const validations: ValidationRule[] = [];

    // ── Type Registry Tests ──
    if (category === 'type-registry') {
      if (filename === 'test-type-categories.java') {
        validations.push(this.rule('Should extract 5 types', (e) => ({
          passed: e.types.length === 5,
          message: `Expected 5 types, got ${e.types.length}`
        })));
        validations.push(this.rule('Should have all type categories', (e) => {
          const cats = new Set(e.types.map(t => t.getTypeCategory()));
          const expected = [TypeCategory.CLASS_TYPE, TypeCategory.INTERFACE_TYPE, TypeCategory.ENUM_TYPE, TypeCategory.RECORD_TYPE, TypeCategory.ANNOTATION_INTERFACE_TYPE];
          const missing = expected.filter(c => !cats.has(c));
          return { passed: missing.length === 0, message: `Missing: ${missing.join(', ')}` };
        }));
      }

      if (filename === 'test-type-modifiers.java') {
        for (const [label, mod] of [['abstract', TypeModifier.ABSTRACT_MODIFIER], ['final', TypeModifier.FINAL_MODIFIER], ['static', TypeModifier.STATIC_MODIFIER]] as const) {
          validations.push(this.rule(`Should extract ${label} modifier`, (e) => ({
            passed: e.types.some(t => t.getTypeModifier()?.split(',').includes(mod)),
            message: `No type with ${mod} found`
          })));
        }
      }

      // Anonymous class naming: keyed by supertype, and stable under unrelated edits.
      if (filename === 'AnonymousClassNames.java') {
        const anonNames = (e: ExtractedEntities) => e.types
          .filter(t => t.getTypePlacement() === TypePlacement.ANONYMOUS_PLACEMENT)
          .map(t => t.getQualifiedName())
          .sort();

        validations.push(this.rule('Anonymous types are keyed by supertype', (e) => {
          const got = anonNames(e);
          const p = 'com.axiomcode.test.typeregistry.AnonymousClassNames';
          const want = [
            `${p}$anon:Runnable`,   // field initializer
            `${p}$anon:Runnable`,   // first in method
            `${p}$anon:Runnable`,   // second in method, same supertype
            `${p}$anon:Comparator`, // qualified and generic, keyed on the simple name
            `${p}$anon:Object`,
          ].sort();
          return {
            passed: JSON.stringify(got) === JSON.stringify(want),
            message: `Expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`
          };
        }));

        // The stability property, stated directly: no anonymous name may contain a digit-only
        // ordinal. Under the old scheme every one of them did, and the two named nested types
        // in the fixture shifted those ordinals.
        validations.push(this.rule('No anonymous name carries a positional ordinal', (e) => {
          const ordinals = e.types
            .filter(t => t.getTypePlacement() === TypePlacement.ANONYMOUS_PLACEMENT)
            .map(t => t.getName())
            .filter(n => /\$\d+$/.test(n));
          return { passed: ordinals.length === 0, message: `Ordinal-numbered names: ${JSON.stringify(ordinals)}` };
        }));

        // Sharing a name must not merge rows: identity is the position-derived hash.
        validations.push(this.rule('Two anonymous Runnables are distinct rows sharing one name', (e) => {
          const runnables = e.types.filter(t =>
            t.getTypePlacement() === TypePlacement.ANONYMOUS_PLACEMENT &&
            t.getName().endsWith('$anon:Runnable'));
          const hashes = new Set(runnables.map(t => t.getHash()));
          return {
            passed: runnables.length === 3 && hashes.size === 3,
            message: `Expected 3 rows with 3 distinct hashes, got ${runnables.length} rows / ${hashes.size} hashes`
          };
        }));

        // The named nested types must be untouched by the anonymous naming change.
        validations.push(this.rule('Named nested types keep their own names', (e) => {
          const named = e.types.filter(t => ['DeclaredFirst', 'DeclaredBetween'].includes(t.getName()));
          return { passed: named.length === 2, message: `Expected DeclaredFirst and DeclaredBetween, got ${named.length}` };
        }));
      }

      // LOCAL_PLACEMENT (JLS 14.3). A local class is not a member of the enclosing type, so
      // INNER_PLACEMENT for one asserts an outer instance that may not exist.
      if (filename === 'LocalTypePlacement.java') {
        const placementOf = (e: ExtractedEntities, name: string) =>
          e.types.find(t => t.getName() === name)?.getTypePlacement();

        const expectPlacement = (name: string, want: TypePlacement) => {
          validations.push(this.rule(`${name} is ${want}`, (e) => {
            const got = placementOf(e, name);
            return { passed: got === want, message: `Expected ${want}, got ${got}` };
          }));
        };

        for (const name of [
          'InMethod', 'InStaticMethod', 'InStaticMethodRecord', 'InConstructor',
          'InInstanceInitializer', 'InStaticInitializer', 'InLambdaBody',
          'LocalRecord', 'LocalContract', 'LocalKind', 'LocalInsideLocal',
        ]) {
          expectPlacement(name, TypePlacement.LOCAL_PLACEMENT);
        }

        // Member types must be untouched: the fix changes which scope wins, not the
        // classification of types whose nearest enclosing scope is a class body.
        expectPlacement('RealInner', TypePlacement.INNER_PLACEMENT);
        expectPlacement('RealStaticNested', TypePlacement.STATIC_NESTED_PLACEMENT);
        expectPlacement('ImplicitlyStaticContract', TypePlacement.STATIC_NESTED_PLACEMENT);
        expectPlacement('ImplicitlyStaticRecord', TypePlacement.STATIC_NESTED_PLACEMENT);
        expectPlacement('LocalTypePlacement', TypePlacement.TOP_LEVEL_PLACEMENT);

        // The ordering case. A rule that asked "is any method above me" rather than "which
        // scope comes first" would relabel these two as LOCAL_PLACEMENT and still pass every
        // assertion above.
        expectPlacement('Outer', TypePlacement.LOCAL_PLACEMENT);
        expectPlacement('MemberOfLocal', TypePlacement.INNER_PLACEMENT);
        expectPlacement('StaticMemberOfLocal', TypePlacement.STATIC_NESTED_PLACEMENT);

        validations.push(this.rule('No local type is reported as a member type', (e) => {
          const localNames = new Set([
            'InMethod', 'InStaticMethod', 'InStaticMethodRecord', 'InConstructor',
            'InInstanceInitializer', 'InStaticInitializer', 'InLambdaBody',
            'LocalRecord', 'LocalContract', 'LocalKind', 'LocalInsideLocal', 'Outer',
          ]);
          const wrong = e.types
            .filter(t => localNames.has(t.getName()) && t.getTypePlacement() !== TypePlacement.LOCAL_PLACEMENT)
            .map(t => `${t.getName()}:${t.getTypePlacement()}`);
          return { passed: wrong.length === 0, message: `Local types misreported: ${JSON.stringify(wrong)}` };
        }));
      }

      if (filename === 'test-type-placement.java') {
        for (const [label, placement] of [['top-level', TypePlacement.TOP_LEVEL_PLACEMENT], ['static nested', TypePlacement.STATIC_NESTED_PLACEMENT], ['inner', TypePlacement.INNER_PLACEMENT]] as const) {
          validations.push(this.rule(`Should have ${label} types`, (e) => ({
            passed: e.types.some(t => t.getTypePlacement() === placement),
            message: `No ${placement} types found`
          })));
        }
      }

      if (filename === 'test-type-access.java') {
        validations.push(this.rule('Should have public access', (e) => ({
          passed: e.types.some(t => t.getTypeAccess() === TypeAccess.PUBLIC_ACCESS),
          message: 'No PUBLIC_ACCESS found'
        })));
        validations.push(this.rule('Should have package-private access', (e) => ({
          passed: e.types.some(t => t.getTypeAccess() === TypeAccess.PACKAGE_ACCESS),
          message: 'No PACKAGE_ACCESS found'
        })));
      }

      // New: NestedTypePatterns.java
      if (filename === 'NestedTypePatterns.java') {
        validations.push(this.minCount('Should extract multiple types', (e) => e.types, 3));
        validations.push(this.rule('Should have nested placements', (e) => ({
          passed: e.types.some(t => t.getTypePlacement() !== TypePlacement.TOP_LEVEL_PLACEMENT),
          message: 'All types are top-level, expected nested types'
        })));
      }

      // New: InheritancePatterns.java
      if (filename === 'InheritancePatterns.java') {
        validations.push(this.minCount('Should extract types', (e) => e.types, 2));
        validations.push(this.rule('Should have SUPER_TYPE references', (e) => ({
          passed: e.typeRefs.some(r => r.getContext() === TypeRefContext.SUPER_TYPE),
          message: 'No SUPER_TYPE references found'
        })));
      }

      // New: InterfacePatterns.java
      if (filename === 'InterfacePatterns.java') {
        validations.push(this.rule('Should have interface types', (e) => ({
          passed: e.types.some(t => t.getTypeCategory() === TypeCategory.INTERFACE_TYPE),
          message: 'No INTERFACE_TYPE found'
        })));
      }

      // New: AnonymousLocalPatterns.java
      if (filename === 'AnonymousLocalPatterns.java') {
        validations.push(this.rule('Should have anonymous types', (e) => ({
          passed: e.types.some(t => t.getTypePlacement() === TypePlacement.ANONYMOUS_PLACEMENT),
          message: 'No ANONYMOUS_PLACEMENT types found'
        })));
      }

      // New: Java17PlusTypes.java
      if (filename === 'Java17PlusTypes.java') {
        validations.push(this.rule('Should have sealed or record types', (e) => ({
          passed: e.types.some(t => t.getTypeCategory() === TypeCategory.RECORD_TYPE || t.getTypeModifier()?.includes('SEALED')),
          message: 'No record or sealed types found'
        })));
      }
    }

    // ── Type Reference Tests ──
    if (category === 'type-references') {
      if (filename === 'test-type-param-bounds.java') {
        validations.push(this.rule('Should have TYPE_PARAM_BOUND refs', (e) => ({
          passed: e.typeRefs.some(r => r.getContext() === TypeRefContext.TYPE_PARAM_BOUND),
          message: 'No TYPE_PARAM_BOUND found'
        })));
        validations.push(this.rule('Should have TYPE_VARIABLE kind', (e) => ({
          passed: e.typeRefs.some(r => r.getKind() === TypeRefKind.TYPE_VARIABLE),
          message: 'No TYPE_VARIABLE found'
        })));
      }
      if (filename === 'test-superclass-refs.java') {
        validations.push(this.rule('Should have SUPER_TYPE refs', (e) => ({
          passed: e.typeRefs.some(r => r.getContext() === TypeRefContext.SUPER_TYPE),
          message: 'No SUPER_TYPE found'
        })));
        validations.push(this.rule('Should have PARAMETERIZED kind', (e) => ({
          passed: e.typeRefs.some(r => r.getKind() === TypeRefKind.PARAMETERIZED),
          message: 'No PARAMETERIZED found'
        })));
      }
      if (filename === 'test-interface-refs.java') {
        validations.push(this.rule('Should have IMPLEMENTS_INTERFACE refs', (e) => ({
          passed: e.typeRefs.some(r => r.getContext() === TypeRefContext.IMPLEMENTS_INTERFACE),
          message: 'No IMPLEMENTS_INTERFACE found'
        })));
      }
      if (filename === 'test-permits-refs.java') {
        validations.push(this.rule('Should have PERMITS refs', (e) => ({
          passed: e.typeRefs.some(r => r.getContext() === TypeRefContext.PERMITS),
          message: 'No PERMITS found'
        })));
      }
      if (filename === 'test-array-types.java') {
        validations.push(this.rule('Should have ARRAY kind', (e) => ({
          passed: e.typeRefs.some(r => r.getKind() === TypeRefKind.ARRAY),
          message: 'No ARRAY found'
        })));
      }
      if (filename === 'test-wildcards.java') {
        validations.push(this.rule('Should have WILDCARD kind', (e) => ({
          passed: e.typeRefs.some(r => r.getKind() === TypeRefKind.WILDCARD),
          message: 'No WILDCARD found'
        })));
      }
      if (filename === 'test-nested-generics.java') {
        validations.push(this.rule('Should have refs with depth > 0', (e) => ({
          passed: e.typeRefs.some(r => r.getDepth() > 0),
          message: 'No nested references found'
        })));
      }
    }

    // ── Type Parameter Tests ──
    if (category === 'type-parameters') {
      if (filename === 'test-simple-type-params.java') {
        validations.push(this.minCount('Should extract type parameters', (e) => e.typeParams, 1));
        validations.push(this.rule('Positions should be sequential per type', (e) => {
          const byType = new Map<string, TypeParameter[]>();
          for (const p of e.typeParams) {
            const key = p.getTypeRegistryLinkHash();
            if (!byType.has(key)) byType.set(key, []);
            byType.get(key)!.push(p);
          }
          for (const [hash, params] of byType) {
            const positions = params.map(p => p.getPosition()).sort((a, b) => a - b);
            if (!positions.every((pos, idx) => pos === idx)) {
              const t = e.types.find(t => t.getHash() === hash);
              return { passed: false, message: `${t?.getName() || 'unknown'}: non-sequential positions ${positions}` };
            }
          }
          return { passed: true };
        }));
      }
      if (filename === 'test-bounded-type-params.java') {
        validations.push(this.rule('Should have refs linked to type params', (e) => ({
          passed: e.typeRefs.some(r => r.getTypeParameterLinkHash() && e.typeParams.some(p => p.getHash() === r.getTypeParameterLinkHash())),
          message: 'No linked type refs'
        })));
      }
      if (filename === 'test-annotated-type-params.java') {
        validations.push(this.rule('Should have TYPE_PARAMETER annotations', (e) => ({
          passed: e.annotations.some(a => a.getContext() === AnnotationContext.TYPE_PARAMETER),
          message: 'No TYPE_PARAMETER context found'
        })));
      }

      // Type-parameter linking: bounds reference sibling params; positions are per-owner
      if (filename === 'test-generic-linking.java') {
        validations.push(this.rule('GenericLinking should own type params K,V,T at positions 0,1,2', (e) => {
          const own = e.typeParams.filter((p) => p.getOwnerTypeName() === 'GenericLinking')
            .sort((a, b) => a.getPosition() - b.getPosition());
          const shape = own.map((p) => `${p.getPosition()}:${p.getName()}`).join(',');
          return { passed: shape === '0:K,1:V,2:T', message: `Got ${shape}` };
        }));
        validations.push(this.rule('Pair should own type params A,B at positions 0,1 (per-owner numbering)', (e) => {
          const own = e.typeParams.filter((p) => p.getOwnerTypeName() === 'Pair')
            .sort((a, b) => a.getPosition() - b.getPosition());
          const shape = own.map((p) => `${p.getPosition()}:${p.getName()}`).join(',');
          return { passed: shape === '0:A,1:B', message: `Got ${shape}` };
        }));
        // V's bound (`extends K`) must be attributed to V, and K's bound to K.
        const boundLinksTo = (name: string) => (e: ExtractedEntities) => {
          const target = e.typeParams.find((p) => p.getName() === name && p.getOwnerTypeName() === 'GenericLinking');
          const hit = e.typeRefs.some((r) =>
            r.getContext() === TypeRefContext.TYPE_PARAM_BOUND &&
            !!r.getTypeParameterLinkHash() &&
            r.getTypeParameterLinkHash() === target?.getHash());
          return { passed: hit, message: `No TYPE_PARAM_BOUND ref linked to type param ${name}` };
        };
        validations.push(this.rule('a bound ref should link to type param K', boundLinksTo('K')));
        validations.push(this.rule('a bound ref should link to type param V', boundLinksTo('V')));
      }
    }

    // ── Method Type Parameter Tests ──
    if (category === 'method-type-parameters') {
      if (filename === 'GenericMethodLinking.java') {
        validations.push(this.minCount('Should extract method type parameters', (e) => e.methodTypeParams, 9));
        validations.push(this.rule('consume should be overloaded with 1 and 2 type params', (e) => {
          const consumes = e.methods.filter((m) => m.getName() === 'consume');
          if (consumes.length !== 2) return { passed: false, message: `Expected 2 'consume', got ${consumes.length}` };
          if (new Set(consumes.map((m) => m.getHash())).size !== 2) return { passed: false, message: 'consume overloads share a hash' };
          const counts = consumes.map((m) => e.methodTypeParams.filter((p) => p.getMethodRegistryLinkHash() === m.getHash()).length).sort();
          return { passed: JSON.stringify(counts) === JSON.stringify([1, 2]), message: `Type-param counts ${JSON.stringify(counts)}` };
        }));
        validations.push(this.rule('max should have a bounded type param', (e) => {
          const max = e.methods.find((m) => m.getName() === 'max');
          const own = e.methodTypeParams.filter((p) => p.getMethodRegistryLinkHash() === max?.getHash());
          return { passed: own.some((p) => p.getHasBounds()), message: 'max has no bounded type param' };
        }));
        validations.push(this.rule('narrow should own A@0 (unbounded) and B@1 (bounded)', (e) => {
          const narrow = e.methods.find((m) => m.getName() === 'narrow');
          const own = e.methodTypeParams.filter((p) => p.getMethodRegistryLinkHash() === narrow?.getHash())
            .sort((a, b) => a.getPosition() - b.getPosition());
          const shape = own.map((p) => `${p.getPosition()}:${p.getParamName()}:${p.getHasBounds()}`).join(',');
          return { passed: shape === '0:A:false,1:B:true', message: `Got ${shape}` };
        }));
        validations.push(this.rule('method type params should have contiguous positions per method', (e) => {
          const byMethod = new Map<string, number[]>();
          for (const p of e.methodTypeParams) {
            const k = p.getMethodRegistryLinkHash();
            if (!byMethod.has(k)) byMethod.set(k, []);
            byMethod.get(k)!.push(p.getPosition());
          }
          for (const [hash, positions] of byMethod) {
            const sorted = positions.sort((a, b) => a - b);
            if (!sorted.every((pos, idx) => pos === idx)) {
              const m = e.methods.find((mm) => mm.getHash() === hash);
              return { passed: false, message: `${m?.getName() ?? hash}: positions ${JSON.stringify(sorted)}` };
            }
          }
          return { passed: true };
        }));
      }
    }

    // ── Annotation Tests ──
    if (category === 'annotations') {
      if (filename.includes('OldClass')) {
        validations.push(this.rule('Should have MARKER annotations', (e) => ({
          passed: e.annotations.some(a => a.getKind() === AnnotationKind.MARKER),
          message: 'No MARKER found'
        })));
      }
      if (filename.includes('TimedClass')) {
        validations.push(this.rule('Should have SINGLE_VALUE annotations', (e) => ({
          passed: e.annotations.some(a => a.getKind() === AnnotationKind.SINGLE_VALUE),
          message: 'No SINGLE_VALUE found'
        })));
      }
      if (filename.includes('User')) {
        validations.push(this.rule('Should have NAMED_ARGUMENTS annotations', (e) => ({
          passed: e.annotations.some(a => a.getKind() === AnnotationKind.NAMED_ARGUMENTS),
          message: 'No NAMED_ARGUMENTS found'
        })));
      }
      if (filename === 'test-array-annotations.java') {
        validations.push(this.rule('Should have ARRAY_VALUE annotations', (e) => ({
          passed: e.annotations.some(a => a.getKind() === AnnotationKind.ARRAY_VALUE),
          message: 'No ARRAY_VALUE found'
        })));
      }
      if (filename === 'test-nested-annotations.java') {
        validations.push(this.rule('Should have nested annotations (depth > 0)', (e) => ({
          passed: e.annotations.some(a => a.getDepth() > 0),
          message: 'No nested annotations found'
        })));
        validations.push(this.rule('Should have NESTED_ANNOTATION value type', (e) => ({
          passed: e.annotationArgs.some(a => a.getValueType?.() === ArgumentValueType.NESTED_ANNOTATION),
          message: 'No NESTED_ANNOTATION found'
        })));
      }
      if (filename === 'ValueTypes.java') {
        validations.push(this.rule('Should have >= 5 argument value types', (e) => {
          const vts = new Set(e.annotationArgs.map(a => a.getValueType()));
          return { passed: vts.size >= 5, message: `Got ${vts.size} value types` };
        }));
      }
      if (filename === 'test-meta-annotations.java') {
        validations.push(this.rule('Should have meta-annotations', (e) => ({
          passed: e.annotations.some(a => a.getIsMetaAnnotation()),
          message: 'No meta-annotations found'
        })));
      }
      // New: ParameterAnnotationTest.java
      if (filename === 'ParameterAnnotationTest.java') {
        validations.push(this.rule('Should have PARAMETER context annotations', (e) => ({
          passed: e.annotations.some(a => a.getContext() === AnnotationContext.PARAMETER_DECLARATION),
          message: 'No PARAMETER_DECLARATION context found'
        })));
      }
      // New: TypeUseAnnotationPatterns.java
      if (filename === 'TypeUseAnnotationPatterns.java') {
        validations.push(this.minCount('Should extract annotations', (e) => e.annotations, 1));
        validations.push(this.minCount('Should extract type references', (e) => e.typeRefs, 1));
      }
    }

    // ── Enum implicit members (JLS 8.9) ──
    if (category === 'enums' && filename === 'EnumImplicitMembers.java') {
      const methodsOf = (e: ExtractedEntities, owner: string) => e.methods
        .filter(m => m.getOwnerTypeName() === owner)
        .map(m => `${m.getName()}/${m.getParameterCount()}:${m.getMethodKind()}`)
        .sort();

      const expectMethods = (label: string, owner: string, want: string[]) => {
        validations.push(this.rule(label, (e) => {
          const got = methodsOf(e, owner);
          return {
            passed: JSON.stringify(got) === JSON.stringify([...want].sort()),
            message: `Expected ${JSON.stringify([...want].sort())}, got ${JSON.stringify(got)}`
          };
        }));
      };

      expectMethods('Simple: values, valueOf and an implicit private constructor', 'Simple', [
        'values/0:ENUM_VALUES',
        'valueOf/1:ENUM_VALUE_OF',
        'Simple/0:DEFAULT_CONSTRUCTOR',
      ]);

      // The regression guard: a declared constructor suppresses the default one. Getting this
      // wrong yields a phantom no-arg constructor for an enum that has none.
      expectMethods('WithCtor: a declared constructor suppresses the implicit one', 'WithCtor', [
        'values/0:ENUM_VALUES',
        'valueOf/1:ENUM_VALUE_OF',
        'WithCtor/1:CONSTRUCTOR',
        'value/0:INSTANCE_METHOD',
      ]);

      expectMethods('Empty: an enum with no constants still has all three', 'Empty', [
        'values/0:ENUM_VALUES',
        'valueOf/1:ENUM_VALUE_OF',
        'Empty/0:DEFAULT_CONSTRUCTOR',
      ]);

      validations.push(this.rule('values() and valueOf() are public static', (e) => {
        const statics = e.methods.filter(m =>
          m.getMethodKind() === MethodKind.ENUM_VALUES || m.getMethodKind() === MethodKind.ENUM_VALUE_OF);
        const bad = statics.filter(m =>
          m.getMethodAccess() !== MethodAccess.PUBLIC ||
          !m.getMethodModifier()?.includes(MethodModifier.STATIC_MODIFIER));
        return {
          passed: statics.length === 8 && bad.length === 0,
          message: `Expected 8 public static rows (4 enums x 2), got ${statics.length} with ${bad.length} wrong`
        };
      }));

      // Scoped to the enums: the enclosing class in this fixture also has a default
      // constructor, and that one is correctly public (JLS 8.8.9 vs 8.9.2).
      validations.push(this.rule('The implicit enum constructor is private', (e) => {
        const enumOwners = new Set(['Simple', 'WithCtor', 'WithBody', 'Empty']);
        const ctors = e.methods.filter(m =>
          m.getMethodKind() === MethodKind.DEFAULT_CONSTRUCTOR && enumOwners.has(m.getOwnerTypeName()));
        const bad = ctors.filter(m => m.getMethodAccess() !== MethodAccess.PRIVATE);
        return {
          passed: ctors.length === 3 && bad.length === 0,
          message: `Expected 3 private enum constructors (Simple, WithBody, Empty), got ${ctors.length} with ${bad.length} non-private`
        };
      }));

      // Compiler artifacts must stay out: emitting them would be its own defect.
      validations.push(this.rule('No class-file artifacts ($VALUES, $values) are emitted', (e) => {
        const artifacts = [...e.methods.map(m => m.getName()), ...e.fields.map(f => f.getName())]
          .filter(n => n.startsWith('$'));
        return { passed: artifacts.length === 0, message: `Emitted artifacts: ${JSON.stringify(artifacts)}` };
      }));

      validations.push(this.rule('valueOf(String) has a parameter row matching its arity', (e) => {
        const vo = e.methods.find(m => m.getOwnerTypeName() === 'Simple' && m.getName() === 'valueOf');
        if (!vo) return { passed: false, message: 'no implicit valueOf on Simple' };
        const params = e.methodParams.filter(p => p.getMethodRegistryLinkHash() === vo.getHash());
        return {
          passed: params.length === 1 && params[0]?.getParameterTypeName() === 'String',
          message: `Expected one String parameter, got ${JSON.stringify(params.map(p => p.getParameterTypeName()))}`
        };
      }));
    }

    // ── Module Declarations (JLS 7.7) ──
    if (category === 'modules') {
      if (filename === 'module-info.java') {
        validations.push(this.rule('Should extract exactly one module declaration', (e) => ({
          passed: e.modules.length === 1 && e.modules[0]?.getName() === 'com.example.app',
          message: `Expected one module com.example.app, got ${JSON.stringify(e.modules.map(m => m.getName()))}`
        })));

        validations.push(this.rule('Module is not open (no `open module`)', (e) => ({
          passed: e.modules[0]?.getIsOpen() === false,
          message: `Expected isOpen=false, got ${e.modules[0]?.getIsOpen()}`
        })));

        // Exact directive set, keyed kind/subject/target/modifiers. This mirrors what
        // `javap -verbose module-info.class` reports for the same module, and asserts set
        // equality rather than a count: today's behaviour is zero rows, so any assertion
        // discriminates, but only an exact set pins the `to` targets and the
        // transitive/static modifiers that a looser rule would let silently drop.
        validations.push(this.rule('Directive set matches the javac module descriptor', (e) => {
          const got = e.moduleDirectives
            .map(d => `${d.getDirectiveKind()} ${d.getSubjectName()} -> ${d.getTargetName() || '-'} [${d.getModifiers().join(',')}]`)
            .sort();
          const want = [
            'REQUIRES java.base -> - []',
            'REQUIRES java.sql -> - [TRANSITIVE]',
            'REQUIRES java.compiler -> - [STATIC]',
            'EXPORTS com.example.api -> - []',
            'EXPORTS com.example.internal -> com.example.client []',
            'EXPORTS com.example.multi -> com.example.one []',
            'EXPORTS com.example.multi -> com.example.two []',
            'OPENS com.example.model -> - []',
            'USES com.example.spi.Service -> - []',
            'PROVIDES com.example.spi.Service -> com.example.impl.ServiceImpl []',
            'PROVIDES com.example.spi.Codec -> com.example.impl.FastCodec []',
            'PROVIDES com.example.spi.Codec -> com.example.impl.SafeCodec []',
          ].sort();
          return {
            passed: JSON.stringify(got) === JSON.stringify(want),
            message: `Expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`
          };
        }));

        // A multi-target directive must keep source order, or `with A, B` and `with B, A`
        // become indistinguishable.
        validations.push(this.rule('Multi-target directives keep source order in position', (e) => {
          const codec = e.moduleDirectives
            .filter(d => d.getSubjectName() === 'com.example.spi.Codec')
            .sort((a, b) => a.getPosition() - b.getPosition())
            .map(d => `${d.getPosition()}:${d.getTargetName()}`);
          const want = ['0:com.example.impl.FastCodec', '1:com.example.impl.SafeCodec'];
          return {
            passed: JSON.stringify(codec) === JSON.stringify(want),
            message: `Expected ${JSON.stringify(want)}, got ${JSON.stringify(codec)}`
          };
        }));

        validations.push(this.rule('Every directive links to the module', (e) => {
          const moduleHash = e.modules[0]?.getHash();
          const orphans = e.moduleDirectives.filter(d => d.getModuleRegistryLinkHash() !== moduleHash);
          return {
            passed: orphans.length === 0 && !!moduleHash,
            message: moduleHash
              ? `${orphans.length} directives not linked to the module`
              : 'No module was extracted, so no directive can link to one'
          };
        }));

        // module-info.java declares no types, so nothing else should appear.
        validations.push(this.rule('A module declaration yields no types or methods', (e) => ({
          passed: e.types.length === 0 && e.methods.length === 0 && e.fields.length === 0,
          message: `Expected no types/methods/fields, got ${e.types.length}/${e.methods.length}/${e.fields.length}`
        })));
      }
    }

    // ── Method Tests ──
    if (category === 'methods') {
      // Generic validations for all method test files
      validations.push(this.minCount('Should extract methods', (e) => e.methods, 1));

      if (filename === 'AllMethodExamples.java' || filename === 'ComprehensiveMethodPatterns.java') {
        validations.push(this.minCount('Should extract many methods', (e) => e.methods, 5));
        validations.push(this.minCount('Should extract method parameters', (e) => e.methodParams, 1));
      }
      if (filename === 'ConstructorPatterns.java') {
        validations.push(this.rule('Should have constructor methods', (e) => ({
          passed: e.methods.some(m => m.getMethodKind() === MethodKind.CONSTRUCTOR),
          message: 'No constructors found'
        })));
      }
      if (filename === 'GenericMethodPatterns.java') {
        validations.push(this.minCount('Should have method type parameters', (e) => e.methodTypeParams, 1));
      }
      if (filename === 'ThrowsPatterns.java') {
        validations.push(this.minCount('Should extract methods', (e) => e.methods, 1));
      }

      // ── Default constructors (JLS 8.8.9) ──
      if (filename === 'DefaultConstructors.java') {
        const ctorsOf = (e: ExtractedEntities, owner: string) => e.methods
          .filter(m => m.getOwnerTypeName() === owner &&
            (m.getMethodKind() === MethodKind.CONSTRUCTOR ||
             m.getMethodKind() === MethodKind.DEFAULT_CONSTRUCTOR))
          .map(m => `${m.getSignature()}:${m.getMethodKind()}:${m.getMethodAccess()}`)
          .sort();

        const expectCtors = (label: string, owner: string, want: string[]) => {
          validations.push(this.rule(label, (e) => {
            const got = ctorsOf(e, owner);
            return {
              passed: JSON.stringify(got) === JSON.stringify([...want].sort()),
              message: `Expected ${JSON.stringify([...want].sort())}, got ${JSON.stringify(got)}`
            };
          }));
        };

        expectCtors('Plain: implicit public no-arg constructor', 'Plain',
          ['Plain():void:DEFAULT_CONSTRUCTOR:PUBLIC']);

        // The default constructor takes the CLASS's access, not public unconditionally.
        expectCtors('PackagePrivate: the implicit constructor is package-private', 'PackagePrivate',
          ['PackagePrivate():void:DEFAULT_CONSTRUCTOR:PACKAGE']);

        expectCtors('Abstract: an abstract class still gets one', 'Abstract',
          ['Abstract():void:DEFAULT_CONSTRUCTOR:PUBLIC']);

        expectCtors('Declared: a declared constructor suppresses the implicit one', 'Declared',
          ['Declared(int):void:CONSTRUCTOR:PUBLIC']);

        // The half a blanket "every type gets a constructor" rule would get wrong.
        expectCtors('Contract: an interface has no constructor', 'Contract', []);
        expectCtors('Marker: an annotation type has no constructor', 'Marker', []);
      }

      // Implicitly declared record members (JLS 8.10). Every expectation below is the member
      // set `javap -p` reports for the same fixture, minus ACC_SYNTHETIC/ACC_BRIDGE entries.
      // These assert SET EQUALITY, not a lower bound: the explicitly declared members already
      // clear any minCount, so only an exact set discriminates when the synthesis is reverted.
      if (filename === 'RecordImplicitMembers.java') {
        const membersOf = (e: ExtractedEntities, owner: string) => ({
          methods: e.methods
            .filter(m => m.getOwnerTypeName() === owner)
            .map(m => `${m.getName()}/${m.getParameterCount()}:${m.getMethodKind()}`)
            .sort(),
          fields: e.fields
            .filter(f => f.getOwnerTypeName() === owner)
            .map(f => `${f.getName()}:${f.getFieldTypeName()}`)
            .sort(),
        });

        const expectSet = (label: string, owner: string, methods: string[], fields: string[]) => {
          validations.push(this.rule(label, (e) => {
            const got = membersOf(e, owner);
            const wantM = [...methods].sort();
            const wantF = [...fields].sort();
            const okM = JSON.stringify(got.methods) === JSON.stringify(wantM);
            const okF = JSON.stringify(got.fields) === JSON.stringify(wantF);
            return {
              passed: okM && okF,
              message: okM
                ? `fields: expected ${JSON.stringify(wantF)}, got ${JSON.stringify(got.fields)}`
                : `methods: expected ${JSON.stringify(wantM)}, got ${JSON.stringify(got.methods)}`
            };
          }));
        };

        expectSet(
          'Point: accessors, equals/hashCode/toString, component fields and canonical ctor',
          'Point',
          [
            'Point/2:CONSTRUCTOR',
            'x/0:RECORD_ACCESSOR',
            'y/0:RECORD_ACCESSOR',
            'equals/1:RECORD_EQUALS',
            'hashCode/0:RECORD_HASH_CODE',
            'toString/0:RECORD_TO_STRING',
          ],
          ['x:int', 'y:int']
        );

        expectSet(
          'Pair: accessor return types are the type variables',
          'Pair',
          [
            'Pair/2:CONSTRUCTOR',
            'first/0:RECORD_ACCESSOR',
            'second/0:RECORD_ACCESSOR',
            'equals/1:RECORD_EQUALS',
            'hashCode/0:RECORD_HASH_CODE',
            'toString/0:RECORD_TO_STRING',
          ],
          ['first:A', 'second:B']
        );

        expectSet(
          'Args: a varargs component yields an array-typed field and accessor',
          'Args',
          [
            'Args/2:CONSTRUCTOR',
            'name/0:RECORD_ACCESSOR',
            'values/0:RECORD_ACCESSOR',
            'equals/1:RECORD_EQUALS',
            'hashCode/0:RECORD_HASH_CODE',
            'toString/0:RECORD_TO_STRING',
          ],
          ['name:String', 'values:int[]']
        );

        expectSet(
          'Custom: a declared accessor suppresses the implicit one and stays INSTANCE_METHOD',
          'Custom',
          [
            'Custom/2:CONSTRUCTOR',
            'x/0:INSTANCE_METHOD',
            'toString/0:INSTANCE_METHOD',
            'y/0:RECORD_ACCESSOR',
            'equals/1:RECORD_EQUALS',
            'hashCode/0:RECORD_HASH_CODE',
          ],
          ['x:int', 'y:int']
        );

        expectSet(
          'Empty: no components means no accessors and no fields',
          'Empty',
          [
            'Empty/0:CONSTRUCTOR',
            'equals/1:RECORD_EQUALS',
            'hashCode/0:RECORD_HASH_CODE',
            'toString/0:RECORD_TO_STRING',
          ],
          []
        );

        validations.push(this.rule('equals(Object) has a parameter row matching its arity', (e) => {
          const equals = e.methods.find(m => m.getOwnerTypeName() === 'Point' && m.getName() === 'equals');
          if (!equals) return { passed: false, message: 'no implicit equals on Point' };
          const params = e.methodParams.filter(p => p.getMethodRegistryLinkHash() === equals.getHash());
          return {
            passed: params.length === 1 && params[0]?.getParameterTypeName() === 'Object',
            message: `Expected one Object parameter, got ${JSON.stringify(params.map(p => p.getParameterTypeName()))}`
          };
        }));
      }

      // JLS 8.10.4: exactly one canonical constructor, declared or implicit - never both.
      if (filename === 'RecordCanonicalConstructor.java') {
        const ctorsOf = (e: ExtractedEntities, owner: string) => e.methods
          .filter(m => m.getOwnerTypeName() === owner &&
            (m.getMethodKind() === MethodKind.CONSTRUCTOR || m.getMethodKind() === MethodKind.COMPACT_CONSTRUCTOR))
          .map(m => m.getSignature())
          .sort();

        const expectCtors = (label: string, owner: string, want: string[]) => {
          validations.push(this.rule(label, (e) => {
            const got = ctorsOf(e, owner);
            return {
              passed: JSON.stringify(got) === JSON.stringify([...want].sort()),
              message: `Expected ${JSON.stringify([...want].sort())}, got ${JSON.stringify(got)}`
            };
          }));
        };

        expectCtors('Implicit: one synthesised canonical constructor', 'Implicit', ['Implicit(int,int):void']);

        // The regression: this used to yield BOTH Compact(int,int) and a phantom Compact().
        expectCtors('Compact: one constructor, carrying the record components', 'Compact', ['Compact(int,int):void']);

        // The regression: this used to yield the same signature twice, on two different lines.
        expectCtors('Explicit: the declared canonical constructor is not duplicated', 'Explicit', ['Explicit(String,int):void']);

        // A count-only assertion would not discriminate here, where 2 is the right answer.
        expectCtors('Delegating: canonical plus a genuine second constructor', 'Delegating',
          ['Delegating(int,int):void', 'Delegating(int):void']);

        validations.push(this.rule('No record declares a zero-arity constructor it does not have', (e) => {
          const phantom = e.methods.filter(m =>
            m.getMethodKind() === MethodKind.COMPACT_CONSTRUCTOR && m.getParameterCount() === 0);
          return {
            passed: phantom.length === 0,
            message: `Phantom zero-arity constructors: ${JSON.stringify(phantom.map(m => m.getSignature()))}`
          };
        }));
      }

      // Overload linking: same name, distinct hashes, params link to the right overload
      if (filename === 'MethodOverloadPatterns.java') {
        validations.push(this.rule('process should be overloaded exactly 4 times', (e) => {
          const n = e.methods.filter((m) => m.getName() === 'process').length;
          return { passed: n === 4, message: `Expected 4 'process' overloads, got ${n}` };
        }));
        validations.push(this.rule('process overloads should have arities {0,1,1,2}', (e) => {
          const arities = e.methods.filter((m) => m.getName() === 'process').map((m) => m.getParameterCount()).sort();
          return { passed: JSON.stringify(arities) === JSON.stringify([0, 1, 1, 2]), message: `Got arities ${JSON.stringify(arities)}` };
        }));
        validations.push(this.rule('every overload should have a distinct hash', (e) => {
          const hashes = e.methods.map((m) => m.getHash());
          return { passed: new Set(hashes).size === hashes.length, message: 'Two methods share a hash' };
        }));
        for (const name of ['process', 'combine', 'pick']) {
          validations.push(this.rule(`${name} overloads should have distinct signatures`, (e) => {
            const sigs = e.methods.filter((m) => m.getName() === name).map((m) => m.getSignature());
            return { passed: new Set(sigs).size === sigs.length, message: `Duplicate signature among ${name}: ${sigs.join(' | ')}` };
          }));
        }
        // No cross-linking: each method's linked params match its arity and positions are 0..n-1
        validations.push(this.rule('parameters should link to their own overload (arity + contiguous positions)', (e) => {
          for (const m of e.methods) {
            const own = e.methodParams.filter((p) => p.getMethodRegistryLinkHash() === m.getHash());
            if (own.length !== m.getParameterCount()) {
              return { passed: false, message: `${m.getSignature()}: ${own.length} linked params but parameterCount=${m.getParameterCount()}` };
            }
            const positions = own.map((p) => p.getPosition()).sort((a, b) => a - b);
            if (!positions.every((pos, idx) => pos === idx)) {
              return { passed: false, message: `${m.getSignature()}: non-contiguous positions ${JSON.stringify(positions)}` };
            }
          }
          return { passed: true };
        }));
      }
    }

    // ── Expression Tests ──
    if (category === 'expressions') {
      // Inside a lambda that initializes a local variable or a field, two statement shapes
      // produced no rows: an unbraced control-flow body, and a `throw` in a field lambda.
      if (filename === 'InitializerLambdaBodies.java') {
        // The unbraced bodies, by the line each call is written on. Naming lines rather than
        // counting totals is what makes a regression say WHICH shape came back: the braced
        // form, the argument form and the local-variable throw were all correct before, so a
        // total would move without telling anyone which half moved.
        const shapes: ReadonlyArray<readonly [string, readonly number[]]> = [
          ['an unbraced if in a local-variable lambda', [51, 53]],
          ['an unbraced for in a local-variable lambda', [80]],
          ['an unbraced while in a local-variable lambda', [89]],
          ['an unbraced do in a local-variable lambda', [98]],
          ['an unbraced if in a field lambda', [107, 109]],
          ['a throw in a field lambda', [35]],
          // The controls, asserted in the same shape so the fixture states they stay correct.
          ['a throw in a local-variable lambda (control)', [39]],
          ['a braced if in a local-variable lambda (control)', [61]],
          ['an unbraced if in an argument lambda (control)', [70, 72]],
          ['an unbraced if in a method body (control)', [44]],
        ];

        for (const [label, lines] of shapes) {
          validations.push(this.rule(`Calls are emitted for ${label}`, (e) => {
            const missing = lines.filter(line => !e.expressions.some(x =>
              x.getStartLine() === line &&
              (x.getKind() === ExpressionKind.METHOD_INVOCATION ||
               x.getKind() === ExpressionKind.OBJECT_CREATION)));
            return { passed: missing.length === 0, message: `No row on line(s) ${JSON.stringify(missing)}` };
          }));
        }

        // The fix routes both the bare-statement and the child-of-block paths through one
        // extraction point. Getting that wrong doubles every statement instead of dropping it,
        // so the conservation direction is asserted too.
        validations.push(this.rule('No lambda-body statement is emitted twice', (e) => {
          const seen = new Map<string, number>();
          for (const x of e.expressions) {
            const key = [x.getKind(), x.getEdgeRole(), x.getRootContext(), x.getExpressionOwnerHash(),
                         x.getStartLine(), x.getStartColumn(), x.getEndLine(), x.getEndColumn()].join('|');
            seen.set(key, (seen.get(key) ?? 0) + 1);
          }
          const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
          return { passed: dupes.length === 0, message: `Duplicated rows: ${JSON.stringify(dupes)}` };
        }));

        // The `throw` in the field lambda must carry its own context, not be swept in as an
        // expression statement, and its argument call must come with it.
        validations.push(this.rule('A field lambda throw is a THROW_VALUE with its argument', (e) => {
          const onLine35 = e.expressions.filter(x => x.getStartLine() === 35);
          const creation = onLine35.some(x => x.getKind() === ExpressionKind.OBJECT_CREATION &&
                                              x.getRootContext() === RootContext.THROW_VALUE &&
                                              x.getEdgeRole() === EdgeRole.ROOT);
          const argument = onLine35.some(x => x.getKind() === ExpressionKind.METHOD_INVOCATION &&
                                              x.getRootContext() === RootContext.THROW_VALUE &&
                                              x.getEdgeRole() === EdgeRole.ARGUMENT);
          return {
            passed: creation && argument,
            message: `L35 creation=${creation} argument=${argument}`
          };
        }));
      }

      // Statements inside a lambda that initializes a local or a field.
      if (filename === 'LambdaInitializerBodies.java') {
        const callsAt = (e: ExtractedEntities, from: number, to: number) => e.expressions.filter(x => {
          const line = x.getStartLine();
          return x.getKind() === ExpressionKind.METHOD_INVOCATION &&
            typeof line === 'number' && line >= from && line <= to;
        }).length;

        // (a) A brace-less body must extract what the braced form extracts. The braced control
        // at 40-43 and the plain method at 34-36 each hold the same two calls.
        // Ranges cover only the lambda body, not the `h.accept("a")` that follows it.
        validations.push(this.rule('A brace-less if body inside a lambda is extracted', (e) => {
          const got = callsAt(e, 48, 51);
          return { passed: got === 2, message: `Expected x() and y(), got ${got} calls` };
        }));

        validations.push(this.rule('A brace-less while body inside a lambda is extracted', (e) => {
          const got = callsAt(e, 58, 58);
          return { passed: got === 1, message: `Expected x(), got ${got} calls` };
        }));

        validations.push(this.rule('A brace-less for body inside a lambda is extracted', (e) => {
          const got = callsAt(e, 64, 64);
          return { passed: got === 1, message: `Expected x(), got ${got} calls` };
        }));

        // (b) The throw in a field-initializer lambda.
        validations.push(this.rule('A throw in a field-initializer lambda is extracted', (e) => {
          const thrown = e.expressions.filter(x =>
            x.getRootContext() === RootContext.THROW_VALUE &&
            x.getKind() === ExpressionKind.OBJECT_CREATION);
          return {
            passed: thrown.length === 2,
            message: `Expected 2 thrown constructions (field lambda and local lambda), got ${thrown.length}`
          };
        }));

        // The direction that matters as much: adding rows must not duplicate any. A throw in a
        // LOCAL-initializer lambda is already covered by the method's own throw pass, and
        // extracting it here too would report one written throw twice.
        validations.push(this.rule('No expression is emitted twice for one source position', (e) => {
          const seen = new Map<string, number>();
          for (const x of e.expressions) {
            const key = `${x.getStartLine()}:${x.getStartColumn()}-${x.getEndLine()}:${x.getEndColumn()}:${x.getKind()}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
          }
          const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
          return { passed: duplicated.length === 0, message: `Duplicated positions: ${JSON.stringify(duplicated)}` };
        }));
      }

      // A pattern binding's USE site is a PATTERN_BINDING_VARIABLE, not a FIELD. Both errors
      // are asserted, because fixing one direction is what exposed the other.
      if (filename === 'PatternBindingDestructuring.java') {
        const identifiers = (e: ExtractedEntities) => e.expressions.filter(x =>
          x.getKind() === ExpressionKind.IDENTIFIER_REFERENCE);

        // Direction 1: a binding used in a FOLLOWING statement was tagged FIELD, because the
        // use site is extracted before the `instanceof` that declares the binding.
        const bindingUses: ReadonlyArray<readonly [number, string]> = [
          [34, 'shadowed'],  // shadows a field of another type — the wrong-answer case
          [41, 'bound'],
          [47, 'inline'],    // same expression as the instanceof; correct before, must stay
          [53, 'left'], [53, 'right'],
          [61, 'inner'], [61, 'other'], [61, 'tail'],
          [69, 'hit'],
        ];
        validations.push(this.rule('Every pattern binding use site is PATTERN_BINDING_VARIABLE', (e) => {
          const wrong = bindingUses.map(([line, name]) => {
            const rows = identifiers(e).filter(x =>
              x.getStartLine() === line && x.getLiteralValue() === name &&
              x.getEdgeRole() !== EdgeRole.PATTERN_VARIABLE &&
              x.getEdgeRole() !== EdgeRole.RECORD_PATTERN_BINDING &&
              x.getEdgeRole() !== EdgeRole.SWITCH_TYPE_PATTERN);
            if (rows.length === 0) return `L${line} ${name}: no use-site row`;
            const bad = rows.filter(x => x.getReferencedEntityKind() !== ReferencedEntityKind.PATTERN_BINDING_VARIABLE);
            return bad.length === 0 ? null : `L${line} ${name} as ${bad[0]!.getReferencedEntityKind()}`;
          }).filter((v): v is string => v !== null);
          return { passed: wrong.length === 0, message: `Use sites: ${JSON.stringify(wrong)}` };
        }));

        // The declaration site was already correct and must stay so — it is what makes the
        // binding findable at all.
        validations.push(this.rule('Every pattern binding declaration is PATTERN_BINDING', (e) => {
          const decls = identifiers(e).filter(x =>
            x.getEdgeRole() === EdgeRole.PATTERN_VARIABLE ||
            x.getEdgeRole() === EdgeRole.RECORD_PATTERN_BINDING ||
            x.getEdgeRole() === EdgeRole.SWITCH_TYPE_PATTERN);
          const wrong = decls.filter(x => x.getReferencedEntityKind() !== ReferencedEntityKind.PATTERN_BINDING)
            .map(x => `L${x.getStartLine()} ${x.getLiteralValue()} as ${x.getReferencedEntityKind()}`);
          return {
            passed: decls.length === 9 && wrong.length === 0,
            message: `${decls.length} declarations (want 9); wrong: ${JSON.stringify(wrong)}`
          };
        }));

        // Direction 2: the leak. The entry points never reset the binding set, so names carried
        // from one extraction call into the next and — the instance being reused — from one
        // FILE into the next: 35 ordinary field reads across this repo's fixtures were tagged
        // PATTERN_BINDING_VARIABLE in files containing no pattern at all. `NoPatterns` has no
        // pattern and declares fields named after the bindings above.
        validations.push(this.rule('A field read in a pattern-free type is not a binding', (e) => {
          const noPatterns = e.types.find(t => t.getName() === 'NoPatterns');
          if (!noPatterns) return { passed: false, message: 'NoPatterns type not extracted' };
          const leaked = identifiers(e)
            .filter(x => (x.getStartLine() ?? -1) >= noPatterns.getStartLine() &&
                         (x.getStartLine() ?? -1) <= noPatterns.getEndLine())
            .filter(x => x.getReferencedEntityKind() === ReferencedEntityKind.PATTERN_BINDING_VARIABLE)
            .map(x => `L${x.getStartLine()} ${x.getLiteralValue()}`);
          return { passed: leaked.length === 0, message: `Leaked binding names: ${JSON.stringify(leaked)}` };
        }));

        // And the reads really are there, so the rule above cannot pass by extracting nothing.
        validations.push(this.rule('The pattern-free type does read its fields', (e) => {
          const noPatterns = e.types.find(t => t.getName() === 'NoPatterns');
          if (!noPatterns) return { passed: false, message: 'NoPatterns type not extracted' };
          const fields = identifiers(e)
            .filter(x => (x.getStartLine() ?? -1) >= noPatterns.getStartLine() &&
                         (x.getStartLine() ?? -1) <= noPatterns.getEndLine())
            .filter(x => x.getReferencedEntityKind() === ReferencedEntityKind.FIELD);
          return { passed: fields.length === 9, message: `Expected 9 field reads, got ${fields.length}` };
        }));
      }

      // Use sites of a pattern binding.
      if (filename === 'PatternBindingUseSites.java') {
        // Scoped to identifier references: a pattern binding use is one, and the fixture also
        // contains a genuine FIELD_ACCESS (`System.out`) that must keep FIELD.
        const refKinds = (e: ExtractedEntities, from: number, to: number) => e.expressions
          .filter(x => {
            const line = x.getStartLine();
            return x.getKind() === ExpressionKind.IDENTIFIER_REFERENCE &&
              typeof line === 'number' && line >= from && line <= to;
          })
          .map(x => x.getReferencedEntityKind());

        // The defect: a binding's use must never be tagged FIELD. Lines 34-61 hold every
        // pattern form and no genuine field reference.
        validations.push(this.rule('No pattern binding use site is tagged FIELD', (e) => {
          const fields = refKinds(e, 34, 61).filter(k => k === ReferencedEntityKind.FIELD);
          return { passed: fields.length === 0, message: `${fields.length} pattern binding uses still tagged FIELD` };
        }));

        // Suppressing FIELD must not suppress the classification entirely.
        validations.push(this.rule('Every pattern form yields a binding use', (e) => {
          const uses = refKinds(e, 34, 61).filter(k => k === ReferencedEntityKind.PATTERN_BINDING_VARIABLE);
          return {
            passed: uses.length === 5,
            message: `Expected 5 PATTERN_BINDING_VARIABLE uses (shadowing, plain, switch, and two record components), got ${uses.length}`
          };
        }));

        // Scope, not just name. A binding may share a name with a field, and a use outside the
        // declaring statement is the field. Matching on the name alone trades one wrong answer
        // for another, so the three uses at lines 72, 74 and 76 must be FIELD, binding, FIELD.
        validations.push(this.rule('A binding does not capture same-named uses outside its statement', (e) => {
          const at = (line: number) => e.expressions.find(x =>
            x.getStartLine() === line && x.getKind() === ExpressionKind.IDENTIFIER_REFERENCE)
            ?.getReferencedEntityKind();
          const got = [at(72), at(74), at(76)];
          const want = [
            ReferencedEntityKind.FIELD,
            ReferencedEntityKind.PATTERN_BINDING_VARIABLE,
            ReferencedEntityKind.FIELD,
          ];
          return {
            passed: JSON.stringify(got) === JSON.stringify(want),
            message: `Expected ${JSON.stringify(want)} at lines 72/74/76, got ${JSON.stringify(got)}`
          };
        }));

        // The control, and the assertion that matters most: a real field must stay a field.
        // A rule that simply stopped emitting FIELD would pass everything above.
        validations.push(this.rule('Genuine field references are unchanged', (e) => {
          const fields = refKinds(e, 30, 32).filter(k => k === ReferencedEntityKind.FIELD);
          return { passed: fields.length === 2, message: `Expected 2 FIELD references, got ${fields.length}` };
        }));
      }

      // A comment inside a conditional expression.
      if (filename === 'TernaryWithComments.java') {
        const withRole = (e: ExtractedEntities, role: EdgeRole) =>
          e.expressions.filter(x => x.getEdgeRole() === role);

        // Eight ternaries, each contributing exactly one of each role. A dropped branch shows
        // up as a shortfall in TERNARY_FALSE, a mislabelled one as a surplus.
        for (const [label, role] of [
          ['condition', EdgeRole.TERNARY_CONDITION],
          ['true branch', EdgeRole.TERNARY_TRUE],
          ['false branch', EdgeRole.TERNARY_FALSE],
        ] as const) {
          validations.push(this.rule(`Every ternary yields exactly one ${label}`, (e) => {
            const rows = withRole(e, role);
            return { passed: rows.length === 8, message: `Expected 8 ${role} rows, got ${rows.length}` };
          }));
        }

        // The mislabelling, stated so the failure names it: a() is the true branch in every
        // ternary here and b() the false one, whatever comments sit between them.
        validations.push(this.rule('The branches keep the roles the source gives them', (e) => {
          const wrong = e.expressions.filter(x =>
            (x.getEdgeRole() === EdgeRole.TERNARY_TRUE && x.getPotentialQualifiedName?.()?.endsWith('.b')) ||
            (x.getEdgeRole() === EdgeRole.TERNARY_FALSE && x.getPotentialQualifiedName?.()?.endsWith('.a')));
          return { passed: wrong.length === 0, message: `${wrong.length} branches carrying the other branch's role` };
        }));

        // No comment may be emitted as an operand.
        validations.push(this.rule('A comment is never emitted as a ternary operand', (e) => {
          const ternaryRoles = [EdgeRole.TERNARY_CONDITION, EdgeRole.TERNARY_TRUE, EdgeRole.TERNARY_FALSE];
          const comments = e.expressions.filter(x =>
            ternaryRoles.includes(x.getEdgeRole() as EdgeRole) && x.getKind() === ExpressionKind.UNKNOWN);
          return { passed: comments.length === 0, message: `${comments.length} operands extracted from a comment` };
        }));
      }

      // Arrow arms of a switch used as a value.
      if (filename === 'SwitchArmDuplication.java') {
        const positionKey = (x: ExpressionReference) =>
          `${x.getStartLine()}:${x.getStartColumn()}-${x.getEndLine()}:${x.getEndColumn()}:${x.getKind()}`;

        // The defect, stated as the property it violates: no source position may produce two
        // expression rows of the same kind. Both rows carried the same byte range and differed
        // only in role, so comparing positions is what detects it; a count would not say where.
        validations.push(this.rule('No source position yields two expression rows', (e) => {
          const seen = new Map<string, number>();
          for (const x of e.expressions) seen.set(positionKey(x), (seen.get(positionKey(x)) ?? 0) + 1);
          const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
          return { passed: duplicated.length === 0, message: `Duplicated positions: ${JSON.stringify(duplicated)}` };
        }));

        // Suppressing the spurious row must not suppress the real one.
        validations.push(this.rule('Every value arm still yields its result row', (e) => {
          const results = e.expressions.filter(x => x.getEdgeRole() === EdgeRole.SWITCH_CASE_RESULT);
          return { passed: results.length === 14, message: `Expected 14 SWITCH_CASE_RESULT rows, got ${results.length}` };
        }));

        // The control: a statement-form switch keeps its arm as a statement.
        validations.push(this.rule('A statement-form switch arm stays an expression statement', (e) => {
          const atControl = e.expressions.filter(x => {
            const line = x.getStartLine();
            return typeof line === 'number' && line >= 63 && line <= 65 &&
              x.getKind() === ExpressionKind.METHOD_INVOCATION &&
              x.getRootContext() === RootContext.EXPRESSION_STATEMENT &&
              x.getEdgeRole() === EdgeRole.ROOT;
          });
          return { passed: atControl.length === 1, message: `Expected the statement-form arm to keep one ROOT row, got ${atControl.length}` };
        }));
      }

      // The three clauses of a basic for statement.
      if (filename === 'ForClauseContexts.java') {
        const rootsIn = (e: ExtractedEntities, ctx: RootContext) =>
          e.expressions.filter(x => x.getRootContext() === ctx && x.getEdgeRole() === EdgeRole.ROOT);

        // The duplication, stated as a count. `for (init(); cond(); step())` produced three
        // FOR_UPDATE roots for one update clause; every loop here has exactly one update
        // except the two-clause one, which has two, and the empty one, which has none.
        validations.push(this.rule('Each update clause yields exactly one row', (e) => {
          const updates = rootsIn(e, RootContext.FOR_UPDATE);
          return { passed: updates.length === 6, message: `Expected 6 FOR_UPDATE roots, got ${updates.length}` };
        }));

        // The clause that was declared and produced by nothing.
        validations.push(this.rule('An expression init clause is FOR_INIT, not FOR_UPDATE', (e) => {
          const inits = rootsIn(e, RootContext.FOR_INIT);
          return { passed: inits.length === 3, message: `Expected 3 FOR_INIT roots, got ${inits.length}` };
        }));

        validations.push(this.rule('Each condition yields exactly one row', (e) => {
          const conditions = rootsIn(e, RootContext.FOR_CONDITION);
          return { passed: conditions.length === 5, message: `Expected 5 FOR_CONDITION roots, got ${conditions.length}` };
        }));

        // The specific collision: a condition must never also be recorded as an update. Both
        // rows carried the same byte range and differed only in context, so comparing positions
        // is what detects it.
        validations.push(this.rule('No condition is also emitted as an init or update', (e) => {
          const key = (x: ExpressionReference) => `${x.getStartLine()}:${x.getStartColumn()}`;
          const conditions = new Set(rootsIn(e, RootContext.FOR_CONDITION).map(key));
          const clauses = [...rootsIn(e, RootContext.FOR_UPDATE), ...rootsIn(e, RootContext.FOR_INIT)].map(key);
          const collided = clauses.filter(k => conditions.has(k));
          return { passed: collided.length === 0, message: `Positions emitted under two clauses: ${JSON.stringify(collided)}` };
        }));

        // A declaration init clause belongs to the local variable, not to the loop.
        validations.push(this.rule('A declaration init clause is not re-read as FOR_INIT', (e) => {
          const declInits = rootsIn(e, RootContext.FOR_INIT).filter(x => x.getKind() === ExpressionKind.LITERAL);
          return { passed: declInits.length === 0, message: `Declaration initializers wrongly in FOR_INIT: ${declInits.length}` };
        }));
      }

      // Expressions inside a static or instance initializer.
      if (filename === 'InitializerBlockExpressions.java') {
        // The three members hold identical statements. Lines come from the fixture:
        // static initializer 29-36, instance initializer 38-45, method 47-54.
        const contextsIn = (e: ExtractedEntities, from: number, to: number) => e.expressions
          .filter(x => {
            const line = x.getStartLine();
            return typeof line === 'number' && line >= from && line <= to;
          })
          .map(x => x.getRootContext())
          .sort();

        const compareToMethod = (label: string, from: number, to: number) => {
          validations.push(this.rule(label, (e) => {
            const got = contextsIn(e, from, to);
            const want = contextsIn(e, 47, 54);
            return {
              passed: JSON.stringify(got) === JSON.stringify(want),
              message: `Expected the method's contexts ${JSON.stringify(want)}, got ${JSON.stringify(got)}`
            };
          }));
        };

        // The method is the oracle: an initializer body is an ordinary block, so whatever the
        // method produces, both initializers must produce.
        compareToMethod('A static initializer extracts what the same statements do in a method', 29, 36);
        compareToMethod('An instance initializer extracts what the same statements do in a method', 38, 45);

        // Stated directly, so the failure names the defect rather than only the mismatch.
        validations.push(this.rule('Control-flow positions inside initializers are extracted', (e) => {
          const wanted = [RootContext.IF_CONDITION, RootContext.WHILE_CONDITION,
                          RootContext.ENHANCED_FOR_ITERABLE, RootContext.THROW_VALUE];
          const missing = wanted.filter(ctx =>
            !e.expressions.some(x => {
              const line = x.getStartLine();
              return x.getRootContext() === ctx && typeof line === 'number' && line >= 29 && line <= 45;
            }));
          return { passed: missing.length === 0, message: `Contexts absent from both initializers: ${missing.join(', ')}` };
        }));

        // The method must be unaffected by any change made for the initializers.
        validations.push(this.rule('The method still extracts all six contexts', (e) => {
          const contexts = new Set(contextsIn(e, 47, 54));
          return { passed: contexts.size === 6, message: `Expected 6 distinct contexts, got ${contexts.size}: ${JSON.stringify([...contexts])}` };
        }));
      }

      // assert (JLS 14.10). Both halves are expressions, and neither was extracted at all.
      if (filename === 'AssertStatements.java') {
        const inCtx = (e: ExtractedEntities, ctx: RootContext) =>
          e.expressions.filter(x => x.getRootContext() === ctx);

        validations.push(this.rule('Every assert condition is recorded', (e) => {
          // Twelve asserts in the fixture, each contributing exactly one ROOT condition row:
          // seven plain and five commented.
          const roots = inCtx(e, RootContext.ASSERT_CONDITION).filter(x => x.getEdgeRole() === EdgeRole.ROOT);
          return { passed: roots.length === 12, message: `Expected 12 ASSERT_CONDITION roots, got ${roots.length}` };
        }));

        validations.push(this.rule('Only the asserts that have one get a detail message', (e) => {
          // Eight of the twelve declare a detail message. This count is what a comment taken as
          // an operand moves: the comment-only-condition assert would gain a message it does
          // not have, and a commented one would lose the message it does.
          const roots = inCtx(e, RootContext.ASSERT_MESSAGE).filter(x => x.getEdgeRole() === EdgeRole.ROOT);
          return { passed: roots.length === 8, message: `Expected 8 ASSERT_MESSAGE roots, got ${roots.length}` };
        }));

        // The point of the issue: the calls inside an assert are call sites like any other.
        validations.push(this.rule('Calls inside an assert are recorded as call sites', (e) => {
          const calls = e.expressions.filter(x =>
            x.getKind() === ExpressionKind.METHOD_INVOCATION &&
            (x.getRootContext() === RootContext.ASSERT_CONDITION ||
             x.getRootContext() === RootContext.ASSERT_MESSAGE));
          return {
            passed: calls.length >= 6,
            message: `Expected at least 6 calls inside asserts, got ${calls.length}`
          };
        }));

        // An assert nested in another statement's body must still be reached.
        validations.push(this.rule('An assert inside an if or while body is reached', (e) => {
          const lines = inCtx(e, RootContext.ASSERT_CONDITION).map(x => x.getStartLine());
          // nested() spans lines 48-56 after the commented shapes were appended above it.
          const nested = [...new Set(lines)].filter((l): l is number => typeof l === 'number' && l >= 48 && l <= 56);
          return { passed: nested.length >= 2, message: `Expected the two nested asserts in lines 40-48, got condition lines ${JSON.stringify([...new Set(lines)])}` };
        }));

        // A comment inside an assert must not become an operand. `assert_statement` has no
        // grammar fields, so the halves are found in the child list -- and comments are NAMED
        // nodes, so a read that takes the first two named children takes the comment. Each
        // commented method below holds the same two calls as conditionAndMessage: check() as the
        // condition, msg() as the message. Keying on the callee's NAME is what makes this
        // discriminating, because the defect swaps which half a call lands in.
        const commented: ReadonlyArray<readonly [number, string, string | null]> = [
          [69, 'commentBeforeColon', 'msg'],
          [75, 'commentBeforeCondition', 'msg'],
          [80, 'commentAfterColon', 'msg'],
          [85, 'commentInConditionOnly', null],
          [90, 'commentEverywhere', 'msg'],
        ];
        for (const [line, label, message] of commented) {
          validations.push(this.rule(`A comment in ${label} does not move the operands`, (e) => {
            const at = (ctx: RootContext) => inCtx(e, ctx)
              .filter(x => x.getKind() === ExpressionKind.METHOD_INVOCATION &&
                           (x.getStartLine() ?? -1) >= line && (x.getStartLine() ?? -1) <= line + 1)
              .map(x => x.getLiteralValue() ?? '?');
            const conds = at(RootContext.ASSERT_CONDITION);
            const msgs = at(RootContext.ASSERT_MESSAGE);
            const wantMsgs = message === null ? [] : [message];
            return {
              passed: JSON.stringify(conds) === JSON.stringify(['check']) &&
                      JSON.stringify(msgs) === JSON.stringify(wantMsgs),
              message: `condition=${JSON.stringify(conds)} (want ["check"]), ` +
                       `message=${JSON.stringify(msgs)} (want ${JSON.stringify(wantMsgs)})`
            };
          }));
        }

        validations.push(this.rule('No comment is emitted as an assert operand', (e) => {
          const bad = [...inCtx(e, RootContext.ASSERT_CONDITION), ...inCtx(e, RootContext.ASSERT_MESSAGE)]
            .filter(x => (x.getLiteralValue() ?? '').trimStart().startsWith('/'))
            .map(x => `L${x.getStartLine()}:${x.getStartColumn()} ${x.getLiteralValue()}`);
          return { passed: bad.length === 0, message: `Comment as an assert operand: ${JSON.stringify(bad)}` };
        }));

        // An assert is an ordinary expression position: rich constructs inside it still work.
        validations.push(this.rule('An anonymous class inside an assert is registered', (e) => {
          const anon = e.types.filter(t => t.getName().endsWith('$anon:Runnable'));
          return { passed: anon.length === 1, message: `Expected one anonymous type, got ${anon.length}` };
        }));
      }


      // Generic: all expression files should produce expressions
      validations.push(this.minCount('Should extract expressions', (e) => e.expressions, 1));

      if (filename === 'LiteralTypeTestCases.java') {
        validations.push(this.rule('Should have LITERAL expressions', (e) => ({
          passed: e.expressions.some(x => x.getKind() === ExpressionKind.LITERAL),
          message: 'No LITERAL expressions found'
        })));
      }
      if (filename === 'ObjectCreationTestCases.java') {
        validations.push(this.rule('Should have OBJECT_CREATION expressions', (e) => ({
          passed: e.expressions.some(x => x.getKind() === ExpressionKind.OBJECT_CREATION),
          message: 'No OBJECT_CREATION found'
        })));
      }
      if (filename === 'MethodReferenceExamples.java') {
        validations.push(this.rule('Should have METHOD_REFERENCE expressions', (e) => ({
          passed: e.expressions.some(x => x.getKind() === ExpressionKind.METHOD_REFERENCE),
          message: 'No METHOD_REFERENCE found'
        })));
      }
      if (filename === 'AssignmentExpressionExamples.java') {
        validations.push(this.rule('Should have ASSIGNMENT_EXPRESSION', (e) => ({
          passed: e.expressions.some(x => x.getKind() === ExpressionKind.ASSIGNMENT_EXPRESSION),
          message: 'No ASSIGNMENT_EXPRESSION found'
        })));
      }
      if (filename === 'CastExpressionExamples.java') {
        validations.push(this.rule('Should have CAST_EXPRESSION', (e) => ({
          passed: e.expressions.some(x => x.getKind() === ExpressionKind.CAST_EXPRESSION),
          message: 'No CAST_EXPRESSION found'
        })));
      }
      if (filename === 'ArrayAccessExamples.java') {
        validations.push(this.rule('Should have ARRAY_ACCESS expressions', (e) => ({
          passed: e.expressions.some(x => x.getKind() === ExpressionKind.ARRAY_ACCESS),
          message: 'No ARRAY_ACCESS found'
        })));
      }
      if (filename === 'InstanceofPatternExamples.java') {
        validations.push(this.rule('Should have INSTANCEOF_EXPRESSION', (e) => ({
          passed: e.expressions.some(x => x.getKind() === ExpressionKind.INSTANCEOF_EXPRESSION),
          message: 'No INSTANCEOF_EXPRESSION found'
        })));
      }
      if (filename === 'SwitchExpressionExamples.java') {
        validations.push(this.rule('Should have SWITCH_EXPRESSION', (e) => ({
          passed: e.expressions.some(x => x.getKind() === ExpressionKind.SWITCH_EXPRESSION),
          message: 'No SWITCH_EXPRESSION found'
        })));
        validations.push(this.minCount('Should extract blocks for switch cases', (e) => e.blocks, 1));
      }
      if (filename === 'LambdaExpressionExamples1.java' || filename === 'LambdaExpressionExamples2.java') {
        validations.push(this.rule('Should have LAMBDA_EXPRESSION', (e) => ({
          passed: e.expressions.some(x => x.getKind() === ExpressionKind.LAMBDA_EXPRESSION),
          message: 'No LAMBDA_EXPRESSION found'
        })));
      }
      if (filename === 'ReturnExpressionExamples.java') {
        validations.push(this.rule('Should have RETURN_VALUE context', (e) => ({
          passed: e.expressions.some(x => x.getRootContext() === RootContext.RETURN_VALUE),
          message: 'No RETURN_VALUE context found'
        })));
      }
      if (filename === 'ExpressionStatementTests.java') {
        validations.push(this.rule('Should have EXPRESSION_STATEMENT context', (e) => ({
          passed: e.expressions.some(x => x.getRootContext() === RootContext.EXPRESSION_STATEMENT),
          message: 'No EXPRESSION_STATEMENT context found'
        })));
      }

      // A comment inside a ternary must not move its operands. Comments are NAMED nodes in
      // tree-sitter-java, so a positional read of namedChildren[0..2] takes the comment as an
      // operand: the true branch came back under TERNARY_FALSE and the false branch was dropped.
      if (filename === 'CommentedTernary.java') {
        const ternaryCalls = (e: ExtractedEntities) => e.expressions.filter(x =>
          x.getKind() === ExpressionKind.METHOD_INVOCATION &&
          (x.getEdgeRole() === EdgeRole.TERNARY_TRUE || x.getEdgeRole() === EdgeRole.TERNARY_FALSE));

        // The structural invariant, which is what a field read buys and a positional read
        // cannot hold: every ternary has exactly one operand in each of the three roles, and
        // the source order of those three operands is condition, then consequence, then
        // alternative. Java syntax makes that ordering unconditional, so any shift shows up
        // here as either a missing role or an out-of-order one, whatever the operands are named.
        validations.push(this.rule('Every ternary has one operand per role, in source order', (e) => {
          const ternaries = e.expressions.filter(x => x.getKind() === ExpressionKind.TERNARY_EXPRESSION);
          const problems: string[] = [];
          for (const t of ternaries) {
            const kids = e.expressions.filter(x => x.getParentExpressionHash() === t.getExpressionUniqueHash());
            const at = (role: EdgeRole) => kids.filter(x => x.getEdgeRole() === role);
            const [cond, yes, no] = [at(EdgeRole.TERNARY_CONDITION), at(EdgeRole.TERNARY_TRUE), at(EdgeRole.TERNARY_FALSE)];
            const where = `L${t.getStartLine()}:${t.getStartColumn()}`;
            if (cond.length !== 1 || yes.length !== 1 || no.length !== 1) {
              problems.push(`${where} roles=${cond.length}/${yes.length}/${no.length}`);
              continue;
            }
            const pos = (x: ExpressionReference) => [x.getStartLine() ?? 0, x.getStartColumn() ?? 0] as const;
            const before = (a: readonly [number, number], b: readonly [number, number]) =>
              a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
            const [pc, py, pn] = [pos(cond[0]!), pos(yes[0]!), pos(no[0]!)];
            if (!before(pc, py) || !before(py, pn)) {
              problems.push(`${where} out of order: cond=${pc} true=${py} false=${pn}`);
            }
          }
          return { passed: problems.length === 0, message: `Ternary operand structure: ${JSON.stringify(problems)}` };
        }));

        // The dropped half, counted exactly. Six methods hold one ternary each and `nested`
        // holds two, so there are seven ternaries and seven of each branch. Six alternatives
        // are a call to whenFalse(); the seventh is the outer ternary of `nested`, whose
        // alternative is the INNER TERNARY rather than a call.
        validations.push(this.rule('Both branches of all seven ternaries are emitted', (e) => {
          const trues = ternaryCalls(e).filter(x => x.getEdgeRole() === EdgeRole.TERNARY_TRUE).length;
          const falses = ternaryCalls(e).filter(x => x.getEdgeRole() === EdgeRole.TERNARY_FALSE).length;
          const nestedAlternative = e.expressions.filter(x =>
            x.getKind() === ExpressionKind.TERNARY_EXPRESSION &&
            x.getEdgeRole() === EdgeRole.TERNARY_FALSE).length;
          return {
            passed: trues === 7 && falses === 6 && nestedAlternative === 1,
            message: `Expected 7 TERNARY_TRUE calls, 6 TERNARY_FALSE calls and 1 nested ` +
                     `ternary alternative; got ${trues}, ${falses} and ${nestedAlternative}`
          };
        }));

        // No comment may ever be handed back as an operand.
        validations.push(this.rule('No ternary operand is a comment', (e) => {
          const comments = e.expressions
            .filter(x => x.getEdgeRole() === EdgeRole.TERNARY_CONDITION ||
                         x.getEdgeRole() === EdgeRole.TERNARY_TRUE ||
                         x.getEdgeRole() === EdgeRole.TERNARY_FALSE)
            .filter(x => (x.getLiteralValue() ?? '').trimStart().startsWith('//'))
            .map(x => `L${x.getStartLine()}:${x.getStartColumn()}`);
          return { passed: comments.length === 0, message: `Comment emitted as a ternary operand: ${JSON.stringify(comments)}` };
        }));

        // The condition is the same field in every shape, so it must be there seven times too.
        validations.push(this.rule('Every ternary has exactly one condition', (e) => {
          const conds = e.expressions.filter(x => x.getEdgeRole() === EdgeRole.TERNARY_CONDITION).length;
          return { passed: conds === 7, message: `Expected 7 TERNARY_CONDITION rows, got ${conds}` };
        }));
      }
    }

    // ── Local Variable Tests ──
    if (category === 'local-variables') {
      validations.push(this.minCount('Should extract local variables', (e) => e.localVariables, 1));

      if (filename === 'LocalVariableExamples.java') {
        validations.push(this.minCount('Should extract many local variables', (e) => e.localVariables, 10));
        validations.push(this.rule('Should have METHOD_BODY scope', (e) => ({
          passed: e.localVariables.some(v => v.getScopeKind() === LocalVariableScopeKind.METHOD_BODY),
          message: 'No METHOD_BODY scope found'
        })));
        validations.push(this.rule('Should have var-inferred variables', (e) => ({
          passed: e.localVariables.some(v => v.getIsVarInferred()),
          message: 'No var-inferred variables found'
        })));
        validations.push(this.rule('Should have final variables', (e) => ({
          passed: e.localVariables.some(v => v.getIsFinal()),
          message: 'No final variables found'
        })));
      }

      if (filename === 'CrossFileLocalVariables.java') {
        validations.push(this.minCount('Should extract local variables', (e) => e.localVariables, 5));
      }
    }

    // ── Block Tests ──
    if (category === 'blocks') {
      validations.push(this.minCount('Should extract blocks', (e) => e.blocks, 1));

      if (filename === 'ControlFlowExamples.java') {
        validations.push(this.minCount('Should extract many blocks', (e) => e.blocks, 20));
        // Should have various block kinds
        for (const [label, kind] of [
          ['IF', BlockKind.IF], ['ELSE', BlockKind.ELSE], ['FOR', BlockKind.FOR],
          ['WHILE', BlockKind.WHILE], ['ENHANCED_FOR', BlockKind.ENHANCED_FOR],
          ['TRY', BlockKind.TRY], ['CATCH', BlockKind.CATCH],
          ['SWITCH_CASE', BlockKind.SWITCH_CASE],
          ['SWITCH_EXPRESSION_CASE', BlockKind.SWITCH_EXPRESSION_CASE],
        ] as const) {
          validations.push(this.rule(`Should have ${label} blocks`, (e) => ({
            passed: e.blocks.some(b => b.getKind() === kind),
            message: `No ${kind} blocks found`
          })));
        }
      }

      if (filename === 'AdvancedExceptionHandling.java') {
        validations.push(this.minCount('Should extract many blocks', (e) => e.blocks, 10));
        validations.push(this.rule('Should have TRY blocks', (e) => ({
          passed: e.blocks.some(b => b.getKind() === BlockKind.TRY),
          message: 'No TRY blocks found'
        })));
        validations.push(this.rule('Should have CATCH blocks', (e) => ({
          passed: e.blocks.some(b => b.getKind() === BlockKind.CATCH),
          message: 'No CATCH blocks found'
        })));
        validations.push(this.rule('Should have FINALLY blocks', (e) => ({
          passed: e.blocks.some(b => b.getKind() === BlockKind.FINALLY),
          message: 'No FINALLY blocks found'
        })));
        validations.push(this.rule('Should have TRY_WITH_RESOURCES blocks', (e) => ({
          passed: e.blocks.some(b => b.getKind() === BlockKind.TRY_WITH_RESOURCES),
          message: 'No TRY_WITH_RESOURCES blocks found'
        })));
        validations.push(this.rule('Blocks should have tryStatementHash linking', (e) => ({
          passed: e.blocks.some(b => b.getTryStatementHash() !== undefined),
          message: 'No blocks with tryStatementHash'
        })));
      }

      if (filename === 'ComprehensiveExceptionPatterns.java') {
        validations.push(this.minCount('Should extract blocks', (e) => e.blocks, 5));
        validations.push(this.rule('Should have catch blocks with exception types', (e) => ({
          passed: e.blocks.some(b => b.getKind() === BlockKind.CATCH && b.getCaughtExceptionTypes() !== undefined),
          message: 'No CATCH blocks with caughtExceptionTypes'
        })));
      }

      // Nested-block linking: parent chain resolves; catch/finally link to their try
      if (filename === 'NestedBlockLinking.java') {
        validations.push(this.rule('should nest at least 4 deep (depth >= 3)', (e) => {
          const maxDepth = Math.max(0, ...e.blocks.map((b) => b.getNestingDepth()));
          return { passed: maxDepth >= 3, message: `Max nesting depth was ${maxDepth}` };
        }));
        validations.push(this.rule('deepest block should link to an enclosing block via parentContainerHash', (e) => {
          const maxDepth = Math.max(0, ...e.blocks.map((b) => b.getNestingDepth()));
          const deepest = e.blocks.filter((b) => b.getNestingDepth() === maxDepth);
          const blockHashes = new Set(e.blocks.map((b) => b.getHash()));
          const ok = deepest.every((b) => !!b.getParentContainerHash() && blockHashes.has(b.getParentContainerHash()!));
          return { passed: ok, message: 'Deepest block does not link to an enclosing block' };
        }));
        validations.push(this.rule('every CATCH/FINALLY should link to a TRY block via tryStatementHash', (e) => {
          const tryHashes = new Map(e.blocks.map((b) => [b.getHash(), b.getKind()]));
          const handlers = e.blocks.filter((b) => b.getKind() === BlockKind.CATCH || b.getKind() === BlockKind.FINALLY);
          for (const h of handlers) {
            const t = h.getTryStatementHash();
            const kind = t ? tryHashes.get(t) : undefined;
            if (!t || (kind !== BlockKind.TRY && kind !== BlockKind.TRY_WITH_RESOURCES)) {
              return { passed: false, message: `${h.getKind()} in ${h.getOwnerMethodName()} links to ${kind ?? 'nothing'}, not a TRY` };
            }
          }
          return { passed: handlers.length > 0, message: 'No CATCH/FINALLY blocks found' };
        }));
        validations.push(this.rule('the two catches and finally in exceptions() should share one try', (e) => {
          const handlers = e.blocks.filter((b) =>
            b.getOwnerMethodName() === 'exceptions' &&
            (b.getKind() === BlockKind.CATCH || b.getKind() === BlockKind.FINALLY));
          const tries = new Set(handlers.map((b) => b.getTryStatementHash()));
          return { passed: handlers.length === 3 && tries.size === 1, message: `${handlers.length} handlers pointing at ${tries.size} distinct try(ies)` };
        }));
      }
    }

    // ── Import Tests ──
    if (category === 'imports') {
      // Qualified names split across a line break (JLS 3.6).
      if (filename === 'WrappedQualifiedNames.java') {
        validations.push(this.rule('A wrapped qualified name normalises to its single-line form', (e) => {
          const got = e.imports.map(i => i.getImportedPath()).sort();
          const want = [
            'java.lang.Math.PI',
            'java.util.Optional',
            'java.util.concurrent.Callable',
            'java.util.function.Function',
          ].sort();
          return {
            passed: JSON.stringify(got) === JSON.stringify(want),
            message: `Expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`
          };
        }));

        // The value-side defect, stated directly: no emitted field may retain the break.
        validations.push(this.rule('No import field retains a line terminator', (e) => {
          const dirty = e.imports
            .filter(i => /[\r\n]/.test(i.getImportedPath() + i.getPackageOrTypeName() + i.getSimpleName()))
            .map(i => JSON.stringify(i.getImportedPath()));
          return { passed: dirty.length === 0, message: `Fields retaining a break: ${JSON.stringify(dirty)}` };
        }));

        validations.push(this.rule('Four wrapped imports yield four rows', (e) => ({
          passed: e.imports.length === 4,
          message: `Expected 4 rows, got ${e.imports.length}`
        })));
      }

      // Module import declarations (JEP 511). No tree-sitter-java release parses these, so the
      // shape the grammar does produce has to be recognised rather than read at face value.
      if (filename === 'ModuleImportDeclarations.java') {
        validations.push(this.rule('Module imports are MODULE, named without the keyword', (e) => {
          const modules = e.imports
            .filter(i => i.getImportKind() === ImportKind.MODULE)
            .map(i => `${i.getImportedPath()}|${i.getSimpleName()}`)
            .sort();
          const want = ['java.base|java.base', 'java.sql|java.sql'];
          return {
            passed: JSON.stringify(modules) === JSON.stringify(want),
            message: `Expected ${JSON.stringify(want)}, got ${JSON.stringify(modules)}`
          };
        }));

        // The failure this guards against is a row that looks ordinary: SINGLE_TYPE with path
        // "module java.base" and simpleName "base", describing a type that does not exist.
        // Asserting only the MODULE rows would still pass if that row were emitted alongside
        // them, so its absence is asserted directly.
        validations.push(this.rule('No import row carries the module keyword in its path', (e) => {
          const leaked = e.imports
            .filter(i => i.getImportedPath().includes('module '))
            .map(i => `${i.getImportKind()}:${i.getImportedPath()}`);
          return { passed: leaked.length === 0, message: `Rows carrying the keyword: ${JSON.stringify(leaked)}` };
        }));

        // One declaration, one row: the module branch and the ordinary branch are exclusive.
        validations.push(this.rule('Seven declarations yield seven import rows', (e) => ({
          passed: e.imports.length === 7,
          message: `Expected 7 rows, got ${e.imports.length}: ${JSON.stringify(e.imports.map(i => `${i.getImportKind()}:${i.getImportedPath()}`))}`
        })));

        // Recognising the module form must not disturb the other four kinds.
        validations.push(this.rule('The other import kinds are unchanged', (e) => {
          const others = e.imports
            .filter(i => i.getImportKind() !== ImportKind.MODULE)
            .map(i => `${i.getImportKind()}:${i.getImportedPath()}`)
            .sort();
          const want = [
            'SINGLE_STATIC:java.lang.Math.PI',
            'SINGLE_TYPE:java.util.ArrayList',
            'SINGLE_TYPE:java.util.List',
            'STATIC_ON_DEMAND:java.lang.Integer.*',
            'TYPE_ON_DEMAND:java.util.concurrent.*',
          ].sort();
          return {
            passed: JSON.stringify(others) === JSON.stringify(want),
            message: `Expected ${JSON.stringify(want)}, got ${JSON.stringify(others)}`
          };
        }));
      }


      if (filename === 'ImportStylePatterns.java') {
        validations.push(this.minCount('Should extract types', (e) => e.types, 1));
        validations.push(this.minCount('Should extract type references', (e) => e.typeRefs, 1));
      }
    }

    // ── Integration Tests ──
    if (category === 'integration') {
      if (filename.includes('CompleteExample')) {
        validations.push(this.rule('Should extract all entity types', (e) => ({
          passed: e.types.length > 0 && e.typeParams.length > 0 && e.typeRefs.length > 0 && e.annotations.length > 0,
          message: 'Not all entity types were extracted'
        })));
      }
      if (filename === 'test-multiple-types.java') {
        validations.push(this.minCount('Should extract >= 3 types', (e) => e.types, 3));
      }
      if (filename === 'ComplexMethodsIntegration.java') {
        validations.push(this.minCount('Should extract methods', (e) => e.methods, 3));
        validations.push(this.minCount('Should extract expressions', (e) => e.expressions, 5));
        validations.push(this.minCount('Should extract method type parameters', (e) => e.methodTypeParams, 5));
      }
    }

    return validations;
  }

  // ==================== HASH UNIQUENESS ====================

  // ==================== COMMENTS ARE INVISIBLE ====================

  /**
   * Records the expression signature of the commented fixture and its uncommented twin.
   */
  private recordCommentTwin(filename: string, entities: ExtractedEntities): void {
    if (filename !== 'CommentsAreInvisible.java' && filename !== 'CommentsAreInvisibleControl.java') {
      return;
    }

    this.commentTwins[filename] = entities.expressions
      .map(e => `${e.getKind()}|${e.getEdgeRole()}|${e.getRootContext()}|${e.getReferencedEntityKind()}`)
      .sort();
  }

  /**
   * Fails when a comment changes what is extracted.
   *
   * tree-sitter models a comment as a NAMED child, so any read that indexes into namedChildren
   * shifts when a comment appears. That shifted the operand out of the slot being read and the
   * expression was dropped, which is a call site with no row - indistinguishable downstream from
   * code that makes no call. It reached return values, throw values, if and while conditions,
   * instanceof patterns, parenthesized expressions, ternary operands and assert messages.
   *
   * The check compares two fixtures that are identical apart from their comments, rather than
   * asserting a fixed list, so a positional read added later is covered without anyone
   * remembering to extend a list.
   */
  private reportCommentInvariance(): void {
    const commented = this.commentTwins['CommentsAreInvisible.java'];
    const control = this.commentTwins['CommentsAreInvisibleControl.java'];

    console.log('\n' + '='.repeat(80));
    if (!commented || !control) {
      console.log('❌ Comment invariance: one of the twin fixtures did not run');
      process.exitCode = 1;
      console.log('='.repeat(80));
      return;
    }

    const counts = (rows: string[]) => {
      const out: Record<string, number> = {};
      for (const r of rows) out[r] = (out[r] ?? 0) + 1;
      return out;
    };
    const a = counts(control);
    const b = counts(commented);
    const differences = [...new Set([...control, ...commented])]
      .filter(k => (a[k] ?? 0) !== (b[k] ?? 0))
      .map(k => `${k}: control ${a[k] ?? 0}, commented ${b[k] ?? 0}`);

    console.log(`💬 Comment invariance: ${control.length} expression rows, commented twin ${commented.length}`);
    if (differences.length === 0) {
      console.log('✅ a comment does not change what is extracted');
    } else {
      console.log(`❌ ${differences.length} row kind(s) differ when comments are present:`);
      differences.forEach(d => console.log(`   ${d}`));
      process.exitCode = 1;
    }
    console.log('='.repeat(80));
  }

  // ==================== VOCABULARY COVERAGE ====================

  /**
   * Members of a declared vocabulary that no fixture produces today.
   *
   * A value declared in an enum and emitted by nothing is a recurring defect shape here rather
   * than a hypothetical: `LOCAL_PLACEMENT`, `ASSERT_CONDITION`, `ASSERT_MESSAGE` and
   * `ASSERT_STATEMENT` were each declared, documented with a worked example, and produced by no
   * code path. Nothing failed when that was true, because a test suite only sees the values that
   * are emitted.
   *
   * Every entry below is a member with no producer, checked against a fixture that exercises the
   * construct rather than assumed from the corpus. Adding a member without either producing it or
   * listing it here fails the gate, and so does listing one that has since started being produced,
   * so the list cannot rot in either direction.
   */
  private static readonly UNPRODUCED_VOCABULARY: Record<string, Record<string, string>> = {
    RootContext: {
      // The try-related members are redundant rather than missing. A resource local carries
      // LocalVariableScopeKind.TRY_WITH_RESOURCES and a catch parameter CATCH_CLAUSE, and every
      // expression in a try, catch or finally body already points at a BlockRegistry row whose
      // kind is TRY_WITH_RESOURCES, CATCH or FINALLY. Emitting these would replace an
      // expression's own syntactic root with containment that is recorded more precisely
      // elsewhere, which loses information rather than adding it.
      TRY_RESOURCE: 'redundant: the resource local carries LocalVariableScopeKind.TRY_WITH_RESOURCES',
      TRY_BLOCK: 'redundant: the owning BlockRegistry row carries BlockKind.TRY / TRY_WITH_RESOURCES',
      CATCH_BLOCK: 'redundant: the owning BlockRegistry row carries BlockKind.CATCH',
      FINALLY_BLOCK: 'redundant: the owning BlockRegistry row carries BlockKind.FINALLY',
      STATIC_INITIALIZER: 'redundant: the owning method row is the <clinit> initializer',
      INSTANCE_INITIALIZER: 'redundant: the owning method row is the instance initializer',
      YIELD_VALUE: 'redundant: a yield value carries EdgeRole.SWITCH_CASE_RESULT, as an arrow arm result does',
      ANNOTATION_VALUE: 'annotation argument values are carried by AnnotationArgumentReference, not as expressions',
      ANNOTATION_DEFAULT: 'an annotation element default is carried on MethodRegistry.defaultValueExpression',
      CONTINUE_STATEMENT: 'no fixture declares a labelled continue; the value is reachable',
    },
    ExpressionKind: {
      CONTINUE_STATEMENT: 'no fixture declares a labelled continue; the value is reachable',
      UNKNOWN: 'a fallback that a well-formed fixture should never reach',
    },
    ExpressionOwnerKind: {
      CONTINUE_STATEMENT: 'no fixture declares a labelled continue; the value is reachable',
      SWITCH_EXPRESSION: 'redundant: a switch arm result carries EdgeRole.SWITCH_CASE_RESULT',
      TRY_STATEMENT: 'redundant: see RootContext.TRY_BLOCK',
      TRY_BLOCK: 'redundant: see RootContext.TRY_BLOCK',
      CATCH_BLOCK: 'redundant: see RootContext.CATCH_BLOCK',
      FINALLY_BLOCK: 'redundant: see RootContext.FINALLY_BLOCK',
      STATIC_INIT_BLOCK: 'redundant: see RootContext.STATIC_INITIALIZER',
      INSTANCE_INIT_BLOCK: 'redundant: see RootContext.INSTANCE_INITIALIZER',
      ANNOTATION_ARGUMENT: 'annotation arguments are carried by AnnotationArgumentReference',
      RECORD_COMPONENT: 'a record component is carried as a MethodParameter and a FieldRegistry',
    },
    EdgeRole: {
      METHOD_NAME: 'a call names its method on the invocation row, not as a child edge',
      FIELD_NAME: 'a field access names its field on the access row, not as a child edge',
      TYPE_ARGUMENT: 'type arguments are carried by TypeReference, not as expression children',
    },
    TypeCategory: {
      ANNOTATION_TYPE: 'reserved; @interface declarations use ANNOTATION_INTERFACE_TYPE',
    },
  };

  /**
   * Records every vocabulary value this fixture produced.
   */
  private recordVocabulary(entities: ExtractedEntities): void {
    const add = (vocab: string, value: string | undefined) => {
      if (!value) return;
      (this.observedVocabulary[vocab] ??= new Set()).add(value);
    };

    for (const t of entities.types) {
      add('TypePlacement', t.getTypePlacement());
      add('TypeCategory', t.getTypeCategory());
    }
    for (const m of entities.methods) add('MethodKind', m.getMethodKind());
    for (const i of entities.imports) add('ImportKind', i.getImportKind());
    for (const e of entities.expressions) {
      add('ExpressionKind', e.getKind());
      add('RootContext', e.getRootContext());
      add('EdgeRole', e.getEdgeRole());
      add('ExpressionOwnerKind', e.getExpressionOwnerKind());
    }
  }

  /**
   * Fails when a declared vocabulary member is neither produced nor recorded as unproduced.
   */
  private reportVocabularyCoverage(): void {
    const vocabularies: Record<string, Record<string, string>> = {
      RootContext: RootContext as unknown as Record<string, string>,
      ExpressionKind: ExpressionKind as unknown as Record<string, string>,
      ExpressionOwnerKind: ExpressionOwnerKind as unknown as Record<string, string>,
      EdgeRole: EdgeRole as unknown as Record<string, string>,
      TypePlacement: TypePlacement as unknown as Record<string, string>,
      TypeCategory: TypeCategory as unknown as Record<string, string>,
      MethodKind: MethodKind as unknown as Record<string, string>,
      ImportKind: ImportKind as unknown as Record<string, string>,
    };

    const problems: string[] = [];
    let produced = 0;
    let declared = 0;

    for (const [name, vocabulary] of Object.entries(vocabularies)) {
      const members = Object.values(vocabulary);
      const seen = this.observedVocabulary[name] ?? new Set<string>();
      const recorded = JavaExtractorTestRunner.UNPRODUCED_VOCABULARY[name] ?? {};

      declared += members.length;
      produced += members.filter(v => seen.has(v)).length;

      for (const member of members) {
        if (!seen.has(member) && !(member in recorded)) {
          problems.push(`${name}.${member} is declared and produced by no fixture, and is not recorded as unproduced`);
        }
      }
      for (const member of Object.keys(recorded)) {
        if (seen.has(member)) {
          problems.push(`${name}.${member} is recorded as unproduced but a fixture now produces it — remove the entry`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`🔤 Vocabulary coverage: ${produced}/${declared} declared members produced by fixtures`);
    if (problems.length === 0) {
      console.log('✅ every declared member is produced or recorded as unproduced');
    } else {
      console.log(`❌ ${problems.length} vocabulary problem(s):`);
      problems.forEach(p => console.log(`   ${p}`));
      process.exitCode = 1;
    }
    console.log('='.repeat(80));
  }

  // ==================== TSV ROW INTEGRITY ====================

  /**
   * Every entity must serialise to exactly one physical line carrying exactly as many fields as
   * its own header declares.
   *
   * A value containing a raw line terminator writes one logical row across two physical lines,
   * and the tear is only detectable downstream as a field-count mismatch against the header. A
   * raw tab does not tear the row but shifts every field after it. `EntityUtils.escapeTsv`
   * exists for this and is applied per writer, which is exactly why the gap recurred in eight of
   * the seventeen Java writers independently: nothing checked that a writer applied it.
   *
   * This runs over every entity of every fixture rather than over a dedicated one, because the
   * property is a property of the writers, not of any particular construct.
   */
  private validateTsvRowIntegrity(entities: ExtractedEntities): { passed: boolean; errors: string[] } {
    const errors: string[] = [];

    const groups: Array<[string, Array<{ toCsv(): string; getCsvHeader(): string }>]> = [
      ['types', entities.types],
      ['methods', entities.methods],
      ['methodParams', entities.methodParams],
      ['methodTypeParams', entities.methodTypeParams],
      ['fields', entities.fields],
      ['typeParams', entities.typeParams],
      ['typeRefs', entities.typeRefs],
      ['annotations', entities.annotations],
      ['annotationArgs', entities.annotationArgs],
      ['enumConstants', entities.enumConstants],
      ['expressions', entities.expressions],
      ['localVariables', entities.localVariables],
      ['blocks', entities.blocks],
      ['comments', entities.comments],
      ['modules', entities.modules],
      ['moduleDirectives', entities.moduleDirectives],
      ['imports', entities.imports],
    ];

    for (const [label, rows] of groups) {
      if (rows.length === 0) continue;

      const expectedFields = rows[0]!.getCsvHeader().split('\t').length;

      for (const row of rows) {
        const csv = row.toCsv();

        if (/[\r\n]/.test(csv)) {
          errors.push(`${label}: a row contains a raw line terminator, so it would tear across physical lines`);
          break;
        }

        const actualFields = csv.split('\t').length;
        if (actualFields !== expectedFields) {
          errors.push(`${label}: a row has ${actualFields} fields, header declares ${expectedFields}`);
          break;
        }
      }
    }

    return { passed: errors.length === 0, errors };
  }

  private validateHashUniqueness(entities: ExtractedEntities): { passed: boolean; errors: string[] } {
    const errors: string[] = [];

    const checkDupes = (label: string, hashes: string[]) => {
      const dupes = hashes.filter((h, i) => hashes.indexOf(h) !== i);
      if (dupes.length > 0) {
        errors.push(`Duplicate ${label} hashes: ${[...new Set(dupes)].slice(0, 5).join(', ')}${dupes.length > 5 ? ` (+${dupes.length - 5} more)` : ''}`);
      }
    };

    checkDupes('TypeRegistry', entities.types.map(t => t.getHash()));
    checkDupes('TypeParameter', entities.typeParams.map(p => p.getHash()));
    // PATTERN_BINDING_TYPE refs can have duplicate hashes (same type linked to same place)
    checkDupes('TypeReference', entities.typeRefs.filter(r => r.getContext() !== TypeRefContext.PATTERN_BINDING_TYPE).map(r => r.getHash()));
    checkDupes('TypeAnnotation', entities.annotations.map(a => a.getHash()));
    checkDupes('AnnotationArgument', entities.annotationArgs.map(a => a.getHash()));
    checkDupes('MethodRegistry', entities.methods.map(m => m.getHash()));
    checkDupes('MethodParameter', entities.methodParams.map(p => p.getHash()));
    checkDupes('FieldRegistry', entities.fields.map(f => f.getHash()));
    checkDupes('ExpressionReference', entities.expressions.map(x => x.getHash()));
    checkDupes('LocalVariableRegistry', entities.localVariables.map(v => v.getHash()));
    checkDupes('BlockRegistry', entities.blocks.map(b => b.getHash()));

    return { passed: errors.length === 0, errors };
  }

  // ==================== REFERENTIAL INTEGRITY ====================

  /**
   * Every link hash a child carries must resolve to a real parent entity of an
   * allowed kind (a dangling link means the parser mis-linked something).
   *
   * The allowed target pools below were verified empirically against the whole
   * fixture corpus, so a failure here is a genuine linking regression, not a
   * fixture that merely exercises an unusual-but-valid shape:
   *   - Block.methodOwnerHash may point at a method, field, or enum constant
   *     (field/enum-constant initializers own blocks too).
   *   - Block.parentContainerHash may point at any container: another block, a
   *     method, an expression, an enum constant, a field, or a local variable.
   *   - Method.enclosingMemberLinkHash may point at a type, method, enum
   *     constant, or field (members declared inside those).
   *   - TypeRef.typeParameterLinkHash may point at a type parameter OR a method
   *     type parameter (bounds on either).
   * `referencedTypeRegistryLinkHash` is intentionally skipped: it is a
   * cross-file link resolved downstream, never populated at per-file extraction.
   */
  private validateReferentialIntegrity(entities: ExtractedEntities): { passed: boolean; errors: string[] } {
    const errors: string[] = [];

    const set = (arr: { getHash(): string }[]) => new Set(arr.map((x) => x.getHash()));
    const types = set(entities.types);
    const typeParams = set(entities.typeParams);
    const typeRefs = set(entities.typeRefs);
    const methods = set(entities.methods);
    const methodTypeParams = set(entities.methodTypeParams);
    const fields = set(entities.fields);
    const enums = set(entities.enumConstants);
    const expressions = set(entities.expressions);
    const localVars = set(entities.localVariables);
    const blocks = set(entities.blocks);

    const union = (...sets: Set<string>[]) => {
      const out = new Set<string>();
      for (const s of sets) for (const v of s) out.add(v);
      return out;
    };
    const memberPool = union(types, methods, enums, fields);
    const blockParentPool = union(blocks, methods, expressions, enums, fields, localVars);
    const methodOwnerPool = union(methods, fields, enums);
    const typeParamPool = union(typeParams, methodTypeParams);

    // label -> [ [entityDescription, linkHash, required] ... ]
    const check = (
      label: string,
      pool: Set<string>,
      items: Array<{ desc: string; hash: string | undefined; required: boolean }>
    ) => {
      let dangling = 0;
      const samples: string[] = [];
      for (const { desc, hash, required } of items) {
        if (!hash) {
          if (required) {
            dangling++;
            if (samples.length < 3) samples.push(`${desc} (missing required link)`);
          }
          continue;
        }
        if (!pool.has(hash)) {
          dangling++;
          if (samples.length < 3) samples.push(`${desc} -> ${hash}`);
        }
      }
      if (dangling > 0) {
        errors.push(`${label}: ${dangling} dangling link(s); e.g. ${samples.join('; ')}`);
      }
    };

    check('Method.typeRegistryLinkHash', types,
      entities.methods.map((m) => ({ desc: `method ${m.getName()}`, hash: m.getTypeRegistryLinkHash(), required: true })));
    check('Method.enclosingMemberLinkHash', memberPool,
      entities.methods.map((m) => ({ desc: `method ${m.getName()}`, hash: m.getEnclosingMemberLinkHash(), required: false })));
    check('MethodParam.methodRegistryLinkHash', methods,
      entities.methodParams.map((p) => ({ desc: `param ${p.getParamName()}`, hash: p.getMethodRegistryLinkHash(), required: true })));
    check('MethodTypeParam.methodRegistryLinkHash', methods,
      entities.methodTypeParams.map((p) => ({ desc: `mtp ${p.getParamName()}`, hash: p.getMethodRegistryLinkHash(), required: true })));
    check('TypeParam.typeRegistryLinkHash', types,
      entities.typeParams.map((p) => ({ desc: `typeParam ${p.getName()}`, hash: p.getTypeRegistryLinkHash(), required: true })));
    check('TypeRef.typeRegistryLinkHash', types,
      entities.typeRefs.map((r) => ({ desc: `typeRef ${r.getTypeName() ?? r.getTypeVariableName() ?? '?'}`, hash: r.getTypeRegistryLinkHash(), required: true })));
    check('TypeRef.parentReferenceHash', typeRefs,
      entities.typeRefs.map((r) => ({ desc: `typeRef ${r.getTypeName() ?? '?'}`, hash: r.getParentReferenceHash(), required: false })));
    check('TypeRef.typeParameterLinkHash', typeParamPool,
      entities.typeRefs.map((r) => ({ desc: `typeRef ${r.getTypeName() ?? r.getTypeVariableName() ?? '?'}`, hash: r.getTypeParameterLinkHash(), required: false })));
    check('Block.typeRegistryLinkHash', types,
      entities.blocks.map((b) => ({ desc: `block ${b.getKind()}`, hash: b.getTypeRegistryLinkHash(), required: true })));
    check('Block.methodOwnerHash', methodOwnerPool,
      entities.blocks.map((b) => ({ desc: `block ${b.getKind()}`, hash: b.getMethodOwnerHash(), required: true })));
    check('Block.parentContainerHash', blockParentPool,
      entities.blocks.map((b) => ({ desc: `block ${b.getKind()}`, hash: b.getParentContainerHash(), required: false })));
    check('Block.tryStatementHash', blocks,
      entities.blocks.map((b) => ({ desc: `block ${b.getKind()}`, hash: b.getTryStatementHash(), required: false })));

    return { passed: errors.length === 0, errors };
  }

  // ==================== PRINTING ====================

  private printTestResult(result: TestResult): void {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    const s = result.stats;
    console.log(`${status} ${result.testFile}`);
    console.log(`       Types:${s.types} Params:${s.typeParams} Refs:${s.typeRefs} Annos:${s.annotations} Args:${s.annotationArgs} Methods:${s.methods} MParams:${s.methodParams} MTP:${s.methodTypeParams}`);
    console.log(`       Fields:${s.fields} Enums:${s.enumConstants} Exprs:${s.expressions} Vars:${s.localVariables} Blocks:${s.blocks} Comments:${s.comments}`);
    
    if (result.errors.length > 0) {
      result.errors.forEach(err => console.log(`       ❌ ${err}`));
    }
    if (result.warnings.length > 0) {
      result.warnings.forEach(warn => console.log(`       ⚠️  ${warn}`));
    }
  }

  private printSummary(results: TestResult[]): void {
    console.log('\n' + '='.repeat(80));
    console.log('📊 Test Summary');
    console.log('='.repeat(80));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;

    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

    const zero = { types: 0, typeParams: 0, typeRefs: 0, annotations: 0, annotationArgs: 0, methods: 0, methodParams: 0, methodTypeParams: 0, fields: 0, enumConstants: 0, expressions: 0, localVariables: 0, blocks: 0, comments: 0 };
    const totals = results.reduce((acc, r) => {
      const keys = Object.keys(zero) as (keyof typeof zero)[];
      const out: typeof zero = { ...acc };
      for (const k of keys) out[k] = acc[k] + r.stats[k];
      return out;
    }, zero);

    console.log('\n📈 Total Entities Extracted:');
    console.log(`   Types: ${totals.types}  TypeParams: ${totals.typeParams}  TypeRefs: ${totals.typeRefs}`);
    console.log(`   Annotations: ${totals.annotations}  AnnotationArgs: ${totals.annotationArgs}`);
    console.log(`   Methods: ${totals.methods}  MethodParams: ${totals.methodParams}  MethodTypeParams: ${totals.methodTypeParams}`);
    console.log(`   Fields: ${totals.fields}  EnumConstants: ${totals.enumConstants}`);
    console.log(`   Expressions: ${totals.expressions}  LocalVariables: ${totals.localVariables}  Blocks: ${totals.blocks}  Comments: ${totals.comments}`);

    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      results.filter(r => !r.passed).forEach(r => {
        console.log(`   - ${r.testFile}`);
        r.errors.forEach(err => console.log(`     ${err}`));
      });
    }

    console.log('\n' + '='.repeat(80));
  }
}

// Main execution
if (require.main === module) {
  const runner = new JavaExtractorTestRunner();
  runner.runAllTests().then(() => {
    // Gates: checks that are not about ONE file's entities, so they cannot be expressed as a
    // test-data fixture. They run after the per-file suite and fail the process on their own.
    const gateErrors = sourceWalkPackages();
    if (gateErrors.length) {
      console.log('\n❌ source-walk gate:');
      gateErrors.forEach(e => console.log(`   ${e}`));
      process.exit(1);
    }
    console.log('\n✅ source-walk gate: a Java package is not pruned as a test directory');
  }).catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}
