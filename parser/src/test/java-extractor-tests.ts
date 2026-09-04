import * as fs from 'fs/promises';
import * as path from 'path';

import { MethodParameter } from '@/analysis-methods/java/MethodParameter';
import { MethodRegistry } from '@/analysis-methods/java/MethodRegistry';
import { MethodTypeParameter } from '@/analysis-methods/java/MethodTypeParameter';
import { AnnotationArgumentReference } from '@/analysis-types/java/AnnotationArgumentReference';
import { BlockRegistry } from '@/analysis-types/java/BlockRegistry';
import { CommentRegistry } from '@/analysis-types/java/CommentRegistry';
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
import { ExpressionKind } from '@/enums/java/expressions/ExpressionKind';
import { RootContext } from '@/enums/java/expressions/RootContext';
import { LocalVariableScopeKind } from '@/enums/java/local-variables/LocalVariableScopeKind';
import { TypeRefContext } from '@/enums/java/type-references/TypeRefContext';
import { TypeRefKind } from '@/enums/java/type-references/TypeRefKind';
import { TypeAccess } from '@/enums/java/types/TypeAccess';
import { TypeCategory } from '@/enums/java/types/TypeCategory';
import { TypeModifier } from '@/enums/java/types/TypeModifier';
import { TypePlacement } from '@/enums/java/types/TypePlacement';
import { MethodKind } from '@/enums/java/methods/MethodKind';
import { TypeRegistryExtractor } from '@/parsers/java/extractors';

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
  private serviceVersionHash = 'test-version-hash';

  constructor(testDataDir?: string) {
    this.testDataDir = testDataDir || path.join(process.cwd(), 'src', 'test-data', 'java');
    this.extractor = new TypeRegistryExtractor();
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
      'integration'
    ];

    const allResults: TestResult[] = [];
    
    for (const category of categories) {
      console.log(`\n📁 Testing: ${category}`);
      console.log('-'.repeat(80));
      
      const categoryResults = await this.runCategoryTests(category);
      allResults.push(...categoryResults);
    }

    this.printSummary(allResults);
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
