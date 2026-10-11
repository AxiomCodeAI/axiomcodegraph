import * as path from 'path';

import { ImportRegistry } from '@/analysis-imports/java/ImportRegistry';
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
import { ModuleDirective } from '@/analysis-types/java/ModuleDirective';
import { ModuleRegistry } from '@/analysis-types/java/ModuleRegistry';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeParameter } from '@/analysis-types/java/TypeParameter';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { TypeRegistry } from '@/analysis-types/java/TypeRegistry';
import { JAVA_ENTITY_TYPES } from '@/constants/consts';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { CodeExtractor } from '@/parsers/code-extractor';
import { ImportExtractor } from '@/parsers/java/extractors';
import { ProjectLanguage } from '@/types/ProjectInfo';
import {
  FrozenTable,
  freezeTable,
  runParsePool,
  thawTable,
} from '@/workflows/parse-pool-core';
export { parsePoolJobs } from '@/workflows/parse-pool-core';

/**
 * The Java half of the parallel parse stage: which prototype each table's
 * rows get back, the shape of a dispatch and a reply, and the one-file
 * extraction (`extractJavaFileFacts`) that the serial loop and the worker
 * both run. Everything thread- and shape-related lives in parse-pool-core.ts.
 *
 * Rows must come back as real instances, not snapshots: the analyzer's
 * export path calls `toCsv`/`getCsvHeader` on every row, and the field
 * position export calls `getTypeRegistryLinkHash`/`getHash` — all prototype
 * methods.
 */
const TABLE_PROTOTYPES = {
  typeRegistries: TypeRegistry.prototype,
  typeParameters: TypeParameter.prototype,
  typeReferences: TypeReference.prototype,
  annotations: TypeAnnotation.prototype,
  annotationArguments: AnnotationArgumentReference.prototype,
  methods: MethodRegistry.prototype,
  methodParameters: MethodParameter.prototype,
  methodTypeParameters: MethodTypeParameter.prototype,
  enumConstants: EnumConstant.prototype,
  modules: ModuleRegistry.prototype,
  moduleDirectives: ModuleDirective.prototype,
  fields: FieldRegistry.prototype,
  imports: ImportRegistry.prototype,
  expressions: ExpressionReference.prototype,
  localVariables: LocalVariableRegistry.prototype,
  blocks: BlockRegistry.prototype,
  comments: CommentRegistry.prototype,
} as const;

type TableKey = keyof typeof TABLE_PROTOTYPES;
const TABLE_KEYS = Object.keys(TABLE_PROTOTYPES) as TableKey[];

/** Everything one Java file contributes: the type rows plus every side-channel table. */
export interface JavaFileFacts {
  typeRegistries: TypeRegistry[];
  typeParameters: TypeParameter[];
  typeReferences: TypeReference[];
  annotations: TypeAnnotation[];
  annotationArguments: AnnotationArgumentReference[];
  methods: MethodRegistry[];
  methodParameters: MethodParameter[];
  methodTypeParameters: MethodTypeParameter[];
  enumConstants: EnumConstant[];
  modules: ModuleRegistry[];
  moduleDirectives: ModuleDirective[];
  fields: FieldRegistry[];
  imports: ImportRegistry[];
  expressions: ExpressionReference[];
  localVariables: LocalVariableRegistry[];
  blocks: BlockRegistry[];
  comments: CommentRegistry[];
}

/** What the analyzer sends a worker for one file: strings only. */
export interface JavaParseDispatch {
  i: number;
  /** Absolute path; the worker reads it AND records it on rows, exactly as the serial loop does. */
  filePath: string;
  serviceVersionHash: string;
}

/**
 * One file's outcome. `skipReason` mirrors the three rejections the serial
 * `readFiles` applies before extraction ever runs — an unreadable, empty or
 * oversized file is skipped, never extracted. `facts` is everything else.
 */
export interface JavaParseOutcome {
  skipReason?: SkippedFileReason;
  /** For the FILE_TOO_LARGE log line, which names the line count. */
  lineCount?: number;
  /** For the READ_ERROR log line, which names the error. */
  readErrorDetail?: string;
  facts?: JavaFileFacts;
}

/** The worker's reply: `facts` is the frozen (prototype-less) snapshot. */
export interface JavaParseReply {
  i: number;
  skipReason?: SkippedFileReason;
  lineCount?: number;
  readErrorDetail?: string;
  facts?: Record<string, unknown>;
}

/**
 * Runs the extraction for ONE file: the type-registry extract, the drain of
 * every per-file side channel the extractor exposes, and the import extract.
 * This is the serial loop's body verbatim, factored out so the worker runs
 * literally the same code against its own extractor pair — one per worker,
 * reused across files, matching the analyzer's single-instance semantics.
 *
 * The `'getExtracted*' in extractor` guards are kept from the serial loop:
 * a caller-supplied CodeExtractor may have a different extractor registered,
 * and that extractor contributes only what it exposes.
 */
export function extractJavaFileFacts(
  codeExtractor: CodeExtractor,
  importExtractor: ImportExtractor,
  filePath: string,
  fileContent: string,
  serviceVersionHash: string
): JavaFileFacts {
  const facts: JavaFileFacts = {
    typeRegistries: [],
    typeParameters: [],
    typeReferences: [],
    annotations: [],
    annotationArguments: [],
    methods: [],
    methodParameters: [],
    methodTypeParameters: [],
    enumConstants: [],
    modules: [],
    moduleDirectives: [],
    fields: [],
    imports: [],
    expressions: [],
    localVariables: [],
    blocks: [],
    comments: [],
  };

  const extractor = codeExtractor.getExtractor(
    ProjectLanguage.JAVA,
    JAVA_ENTITY_TYPES.TYPE_REGISTRY
  ) as any;

  facts.typeRegistries = codeExtractor.extract<TypeRegistry>(
    ProjectLanguage.JAVA,
    JAVA_ENTITY_TYPES.TYPE_REGISTRY,
    filePath,
    fileContent,
    serviceVersionHash
  );

  if (extractor && 'getExtractedTypeParameters' in extractor) {
    facts.typeParameters = extractor.getExtractedTypeParameters();
  }
  if (extractor && 'getExtractedTypeReferences' in extractor) {
    facts.typeReferences = extractor.getExtractedTypeReferences();
  }
  if (extractor && 'getExtractedAnnotations' in extractor) {
    facts.annotations = extractor.getExtractedAnnotations();
  }
  if (extractor && 'getExtractedAnnotationArguments' in extractor) {
    facts.annotationArguments = extractor.getExtractedAnnotationArguments();
  }
  if (extractor && 'getExtractedMethods' in extractor) {
    facts.methods = extractor.getExtractedMethods();
  }
  if (extractor && 'getExtractedMethodParameters' in extractor) {
    facts.methodParameters = extractor.getExtractedMethodParameters();
  }
  if (extractor && 'getExtractedMethodTypeParameters' in extractor) {
    facts.methodTypeParameters = extractor.getExtractedMethodTypeParameters();
  }
  if (extractor && 'getExtractedEnumConstants' in extractor) {
    facts.enumConstants = extractor.getExtractedEnumConstants();
  }
  if (extractor && 'getExtractedModules' in extractor) {
    facts.modules = extractor.getExtractedModules();
  }
  if (extractor && 'getExtractedModuleDirectives' in extractor) {
    facts.moduleDirectives = extractor.getExtractedModuleDirectives();
  }
  if (extractor && 'getExtractedFields' in extractor) {
    facts.fields = extractor.getExtractedFields();
  }

  facts.imports = importExtractor.extract(filePath, fileContent, serviceVersionHash);

  if (extractor && 'getExtractedExpressions' in extractor) {
    facts.expressions = extractor.getExtractedExpressions();
  }
  if (extractor && 'getExtractedLocalVariables' in extractor) {
    facts.localVariables = extractor.getExtractedLocalVariables();
  }
  if (extractor && 'getExtractedBlocks' in extractor) {
    facts.blocks = extractor.getExtractedBlocks();
  }
  if (extractor && 'getExtractedComments' in extractor) {
    facts.comments = extractor.getExtractedComments();
  }

  return facts;
}

/** Worker side: a fact set as columns structured clone can carry cheaply. */
export function freezeFileFacts(facts: JavaFileFacts): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of TABLE_KEYS) out[key] = freezeTable(facts[key]);
  return out;
}

/** Main-thread side: the columns back as rows with each table's prototype. */
export function thawFileFacts(frozen: Record<string, unknown>): JavaFileFacts {
  const out = {} as Record<string, unknown>;
  for (const key of TABLE_KEYS) {
    out[key] = thawTable(frozen[key] as FrozenTable, TABLE_PROTOTYPES[key]);
  }
  return out as unknown as JavaFileFacts;
}

/**
 * Parses every file on `jobs` workers, calling `consume` once per file IN
 * FILE ORDER as results become available. `false` means no compiled worker:
 * the caller falls back to its serial loop.
 */
export async function parseFilesInPool(
  dispatches: JavaParseDispatch[],
  jobs: number,
  consume: (i: number, outcome: JavaParseOutcome) => void
): Promise<boolean> {
  return runParsePool<JavaParseDispatch, JavaParseReply>(
    path.join(__dirname, 'java-parse-worker.js'),
    dispatches,
    jobs,
    reply =>
      consume(
        reply.i,
        reply.facts
          ? { facts: thawFileFacts(reply.facts) }
          : {
              skipReason: reply.skipReason,
              lineCount: reply.lineCount,
              readErrorDetail: reply.readErrorDetail,
            }
      )
  );
}
