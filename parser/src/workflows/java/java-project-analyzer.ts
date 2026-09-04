import * as fs from 'fs/promises';
import * as path from 'path';

import { ImportRegistry } from '@/analysis-imports/java/ImportRegistry';
import { MethodParameter } from '@/analysis-methods/java/MethodParameter';
import { MethodRegistry } from '@/analysis-methods/java/MethodRegistry';
import { MethodTypeParameter } from '@/analysis-methods/java/MethodTypeParameter';
import { AnnotationArgumentReference } from '@/analysis-types/java/AnnotationArgumentReference';
import { EnumConstant } from '@/analysis-types/java/EnumConstant';
import { ModuleDirective } from '@/analysis-types/java/ModuleDirective';
import { ModuleRegistry } from '@/analysis-types/java/ModuleRegistry';
import { ExpressionReference } from '@/analysis-types/java/ExpressionReference';
import { FieldRegistry } from '@/analysis-types/java/FieldRegistry';
import { LocalVariableRegistry } from '@/analysis-types/java/LocalVariableRegistry';
import { BlockRegistry } from '@/analysis-types/java/BlockRegistry';
import { CommentRegistry } from '@/analysis-types/java/CommentRegistry';
import { TypeAnnotation } from '@/analysis-types/java/TypeAnnotation';
import { TypeParameter } from '@/analysis-types/java/TypeParameter';
import { TypeReference } from '@/analysis-types/java/TypeReference';
import { TypeRegistry } from '@/analysis-types/java/TypeRegistry';
import { EXCLUDED_DIRS, isJavaTestDir, ANALYSIS_OUTPUT_DIR, OUTPUT_TYPE_REGISTRY_CSV_FILENAME, OUTPUT_TYPE_PARAMETER_CSV_FILENAME, OUTPUT_TYPE_REFERENCE_CSV_FILENAME, OUTPUT_TYPE_ANNOTATION_CSV_FILENAME, OUTPUT_ANNOTATION_ARGUMENT_CSV_FILENAME, OUTPUT_METHOD_REGISTRY_CSV_FILENAME, OUTPUT_METHOD_PARAMETER_CSV_FILENAME, OUTPUT_METHOD_TYPE_PARAMETER_CSV_FILENAME, OUTPUT_ENUM_CONSTANT_CSV_FILENAME, OUTPUT_FIELD_REGISTRY_CSV_FILENAME, OUTPUT_FIELD_POSITION_CSV_FILENAME, OUTPUT_IMPORT_REGISTRY_CSV_FILENAME, OUTPUT_MODULE_REGISTRY_CSV_FILENAME, OUTPUT_MODULE_DIRECTIVE_CSV_FILENAME, OUTPUT_EXPRESSION_REFERENCE_CSV_FILENAME, OUTPUT_LOCAL_VARIABLE_REGISTRY_CSV_FILENAME, OUTPUT_BLOCK_REGISTRY_CSV_FILENAME, OUTPUT_COMMENT_REGISTRY_CSV_FILENAME, OUTPUT_SKIPPED_JAVA_FILES_CSV_FILENAME, JAVA_ENTITY_TYPES, FILE_EXTENSIONS, LARGE_FILE_LINE_THRESHOLD } from '@/constants/consts';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { CodeExtractor } from '@/parsers/code-extractor';
import { TypeRegistryExtractor, ImportExtractor } from '@/parsers/java/extractors';
import { ProjectInfo, ProjectLanguage } from '@/types/ProjectInfo';
import { EntityUtils } from '@/utils/entity-utils';

export class JavaProjectAnalyzer {
  private codeExtractor: CodeExtractor;
  private allTypeRegistries: TypeRegistry[] = [];
  private allTypeParameters: TypeParameter[] = [];
  private allTypeReferences: TypeReference[] = [];
  private allAnnotations: TypeAnnotation[] = [];
  private allAnnotationArguments: AnnotationArgumentReference[] = [];
  private allMethods: MethodRegistry[] = [];
  private allMethodParameters: MethodParameter[] = [];
  private allMethodTypeParameters: MethodTypeParameter[] = [];
  private allEnumConstants: EnumConstant[] = [];
  private allModules: ModuleRegistry[] = [];
  private allModuleDirectives: ModuleDirective[] = [];
  private allFields: FieldRegistry[] = [];
  private allImports: ImportRegistry[] = [];
  private allExpressions: ExpressionReference[] = [];
  private allLocalVariables: LocalVariableRegistry[] = [];
  private allBlocks: BlockRegistry[] = [];
  private allComments: CommentRegistry[] = [];
  private skippedFiles: { filePath: string; baseMservPath: string; serviceVersionHash: string; reason: SkippedFileReason; uniqueFileHash: string }[] = [];
  private importExtractor: ImportExtractor;
  private outputDir: string;

  constructor(codeExtractor?: CodeExtractor, outputDir?: string) {
    this.codeExtractor = codeExtractor || new CodeExtractor();
    this.outputDir = outputDir || ANALYSIS_OUTPUT_DIR;
    this.importExtractor = new ImportExtractor();
    this.registerExtractors();
  }

  /**
   * Registers all extractors for Java language
   */
  private registerExtractors(): void {
    this.codeExtractor.registerExtractor(
      ProjectLanguage.JAVA,
      JAVA_ENTITY_TYPES.TYPE_REGISTRY,
      new TypeRegistryExtractor()
    );
  }

  /**
   * Analyzes Java projects and performs processing
   * @param javaProjects Array of Java projects to analyze
   * @param serviceVersionLink Service version identifier
   */
  async analyzeJavaProjects(
    javaProjects: ProjectInfo[],
    serviceVersionLink: string,
    excludeTests: boolean = false
  ): Promise<void> {
    const startTime = Date.now();
    
    console.log(`\n📊 Found ${javaProjects.length} Java project(s)\n`);

    if (javaProjects.length === 0) {
      console.log('No Java projects found to analyze.');
      return;
    }

    const serviceVersionHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.SERVICE_VERSION,
      serviceVersionLink
    );

    await this.ensureOutputDirectory();

    const projectResults = await Promise.all(
      javaProjects.map((project) => this.analyzeProject(project, serviceVersionHash, excludeTests))
    );

    this.allTypeRegistries = projectResults.flat();

    await this.exportMasterCsv();
    await this.exportTypeParametersCsv();
    await this.exportTypeReferencesCsv();
    await this.exportAnnotationsCsv();
    await this.exportAnnotationArgumentsCsv();
    await this.exportMethodsCsv();
    await this.exportMethodParametersCsv();
    await this.exportMethodTypeParametersCsv();
    await this.exportEnumConstantsCsv();
    await this.exportFieldsCsv();
    await this.exportFieldPositionsCsv();
    await this.exportImportsCsv();
    await this.exportModulesCsv();
    await this.exportModuleDirectivesCsv();
    await this.exportExpressionsCsv();
    await this.exportLocalVariablesCsv();
    await this.exportBlocksCsv();
    await this.exportCommentsCsv();
    await this.exportSkippedFilesCsv();
    
    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log(`\n📊 Total types extracted: ${this.allTypeRegistries.length}`);
    console.log(`📊 Total type parameters extracted: ${this.allTypeParameters.length}`);
    console.log(`📊 Total type references extracted: ${this.allTypeReferences.length}`);
    console.log(`📊 Total annotations extracted: ${this.allAnnotations.length}`);
    console.log(`📊 Total annotation arguments extracted: ${this.allAnnotationArguments.length}`);
    console.log(`📊 Total methods extracted: ${this.allMethods.length}`);
    console.log(`📊 Total method parameters extracted: ${this.allMethodParameters.length}`);
    console.log(`📊 Total method type parameters extracted: ${this.allMethodTypeParameters.length}`);
    console.log(`📊 Total enum constants extracted: ${this.allEnumConstants.length}`);
    console.log(`📊 Total modules extracted: ${this.allModules.length} (${this.allModuleDirectives.length} directives)`);
    console.log(`📊 Total fields extracted: ${this.allFields.length}`);
    console.log(`📊 Total imports extracted: ${this.allImports.length}`);
    console.log(`📊 Total expressions extracted: ${this.allExpressions.length}`);
    console.log(`📊 Total local variables extracted: ${this.allLocalVariables.length}`);
    console.log(`📊 Total blocks extracted: ${this.allBlocks.length}`);
    console.log(`📊 Total comments extracted: ${this.allComments.length}`);
    console.log(`📊 Total skipped files: ${this.skippedFiles.length}`);
    console.log(`⏱️  Processing completed in ${durationSeconds}s`);
  }

  /**
   * Analyzes a single Java project (runs in parallel)
   */
  private async analyzeProject(
    project: ProjectInfo,
    serviceVersionHash: string,
    excludeTests: boolean = false
  ): Promise<TypeRegistry[]> {
    console.log(`📦 Project: ${project.name}`);
    console.log(`   Path: ${project.path}`);
    console.log(`   Build System: ${project.buildSystem || 'Unknown'}`);
    console.log(`   Language: ${project.language}`);

    const typeRegistries = await this.extractTypeRegistries(project.path, serviceVersionHash, excludeTests);

    console.log(`   ✅ Extracted ${typeRegistries.length} type(s)`);

    return typeRegistries;
  }

  /**
   * Extracts TypeRegistry entities from Java source files
   */
  private async extractTypeRegistries(
    projectPath: string,
    serviceVersionHash: string,
    excludeTests: boolean = false
  ): Promise<TypeRegistry[]> {
    const javaFiles = await this.findJavaFiles(projectPath, excludeTests);

    if (javaFiles.length === 0) {
      console.log('   ⚠️  No Java files found in project');
      return [];
    }

    console.log(`   🔍 Found ${javaFiles.length} Java file(s), extracting types...`);

    const fileContents = await this.readFiles(javaFiles, projectPath, serviceVersionHash);

    // Extract from each file and collect type parameters after each file
    const typeRegistries: TypeRegistry[] = [];
    const extractor = this.codeExtractor.getExtractor(
      ProjectLanguage.JAVA,
      JAVA_ENTITY_TYPES.TYPE_REGISTRY
    ) as any;

    for (const fileData of fileContents) {
      const typesFromFile = this.codeExtractor.extract<TypeRegistry>(
        ProjectLanguage.JAVA,
        JAVA_ENTITY_TYPES.TYPE_REGISTRY,
        fileData.path,
        fileData.content,
        serviceVersionHash
      );
      typeRegistries.push(...typesFromFile);

      // Collect type parameters from this file immediately
      if (extractor && 'getExtractedTypeParameters' in extractor) {
        const typeParams = extractor.getExtractedTypeParameters();
        this.allTypeParameters.push(...typeParams);
      }
      
      // Collect type references from this file immediately
      if (extractor && 'getExtractedTypeReferences' in extractor) {
        const typeRefs = extractor.getExtractedTypeReferences();
        this.allTypeReferences.push(...typeRefs);
      }
      
      // Collect annotations from this file immediately
      if (extractor && 'getExtractedAnnotations' in extractor) {
        const annotations = extractor.getExtractedAnnotations();
        this.allAnnotations.push(...annotations);
      }
      
      // Collect annotation arguments from this file immediately
      if (extractor && 'getExtractedAnnotationArguments' in extractor) {
        const annotationArgs = extractor.getExtractedAnnotationArguments();
        this.allAnnotationArguments.push(...annotationArgs);
      }
      
      // Collect methods from this file immediately
      if (extractor && 'getExtractedMethods' in extractor) {
        const methods = extractor.getExtractedMethods();
        this.allMethods.push(...methods);
      }
      
      // Collect method parameters from this file immediately
      if (extractor && 'getExtractedMethodParameters' in extractor) {
        const methodParams = extractor.getExtractedMethodParameters();
        this.allMethodParameters.push(...methodParams);
      }
      
      // Collect method type parameters from this file immediately
      if (extractor && 'getExtractedMethodTypeParameters' in extractor) {
        const methodTypeParams = extractor.getExtractedMethodTypeParameters();
        this.allMethodTypeParameters.push(...methodTypeParams);
      }
      
      // Collect enum constants from this file immediately
      if (extractor && 'getExtractedEnumConstants' in extractor) {
        const enumConstants = extractor.getExtractedEnumConstants();
        this.allEnumConstants.push(...enumConstants);
      }

      // Collect the module declaration from this file, if it was a module-info.java
      if (extractor && 'getExtractedModules' in extractor) {
        const modules = extractor.getExtractedModules();
        this.allModules.push(...modules);
      }

      // Collect module directives from this file immediately
      if (extractor && 'getExtractedModuleDirectives' in extractor) {
        const moduleDirectives = extractor.getExtractedModuleDirectives();
        this.allModuleDirectives.push(...moduleDirectives);
      }
      
      // Collect fields from this file immediately
      if (extractor && 'getExtractedFields' in extractor) {
        const fields = extractor.getExtractedFields();
        this.allFields.push(...fields);
      }
      
      // Extract imports from this file
      const importsFromFile = this.importExtractor.extract(
        fileData.path,
        fileData.content,
        serviceVersionHash
      );
      this.allImports.push(...importsFromFile);
      
      // Collect expressions from this file immediately
      if (extractor && 'getExtractedExpressions' in extractor) {
        const expressions = extractor.getExtractedExpressions();
        this.allExpressions.push(...expressions);
      }
      
      // Collect local variables from this file immediately
      if (extractor && 'getExtractedLocalVariables' in extractor) {
        const localVariables = extractor.getExtractedLocalVariables();
        this.allLocalVariables.push(...localVariables);
      }
      
      // Collect blocks from this file immediately
      if (extractor && 'getExtractedBlocks' in extractor) {
        const blocks = extractor.getExtractedBlocks();
        this.allBlocks.push(...blocks);
      }
      
      // Collect comments from this file immediately
      if (extractor && 'getExtractedComments' in extractor) {
        const comments = extractor.getExtractedComments();
        this.allComments.push(...comments);
      }
      
    }

    return typeRegistries;
  }

  /**
   * Recursively finds all Java files in a directory
   */
  private async findJavaFiles(dirPath: string, excludeTests: boolean = false): Promise<string[]> {
    const files: string[] = [];
    await this.scanForJavaFiles(dirPath, files, excludeTests);
    return files;
  }

  /**
   * Recursively scans for Java files
   */
  private async scanForJavaFiles(dirPath: string, files: string[], excludeTests: boolean = false): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const isTestDir = isJavaTestDir(entry.name);
          if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.') && !(excludeTests && isTestDir)) {
            const subPath = path.join(dirPath, entry.name);
            await this.scanForJavaFiles(subPath, files, excludeTests);
          }
        } else if (entry.isFile() && entry.name.endsWith(FILE_EXTENSIONS.JAVA)) {
          files.push(path.join(dirPath, entry.name));
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
  }

  /**
   * Generic CSV export helper to eliminate code duplication
   */
  private async exportEntitiesToCsv<T extends { getCsvHeader(): string; toCsv(): string }>(
    entities: T[],
    filename: string,
    entityTypeName: string
  ): Promise<void> {
    if (entities.length === 0) {
      console.log(`\n⚠️  No ${entityTypeName} to export`);
      return;
    }

    const outputPath = path.join(this.outputDir, filename);
    const firstEntity = entities[0];
    if (!firstEntity) return;

    // Write in chunks to avoid RangeError: Invalid string length on large datasets
    const CHUNK_SIZE = 50_000;
    const header = firstEntity.getCsvHeader();
    await fs.writeFile(outputPath, header + '\n', 'utf-8');

    for (let i = 0; i < entities.length; i += CHUNK_SIZE) {
      const chunk = entities.slice(i, i + CHUNK_SIZE);
      const chunkContent = chunk.map((entity) => entity.toCsv()).join('\n') + '\n';
      await fs.appendFile(outputPath, chunkContent, 'utf-8');
    }

    console.log(`💾 ${entityTypeName} CSV exported to: ${outputPath}`);
  }

  /**
   * Reads multiple files in parallel
   */
  private async readFiles(
    filePaths: string[],
    baseMservPath: string,
    serviceVersionHash: string
  ): Promise<{ path: string; content: string }[]> {
    const results = await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          
          if (!content || content.trim().length === 0) {
            console.warn(`Skipping ${filePath}: empty or invalid content`);
            const reason = SkippedFileReason.EMPTY_CONTENT;
            const uniqueFileHash = EntityUtils.generateEntityHash(
              ENTITY_IDENTIFIERS.SKIPPED_FILE,
              `${filePath}||${baseMservPath}||${serviceVersionHash}||${reason}`
            );
            this.skippedFiles.push({ filePath, baseMservPath, serviceVersionHash, reason, uniqueFileHash });
            return { path: filePath, content: '' };
          }

          const lineCount = content.split('\n').length;
          if (lineCount > LARGE_FILE_LINE_THRESHOLD) {
            console.log(`   ⏭️  Skipping very large file (${lineCount} lines): ${filePath}`);
            const reason = SkippedFileReason.FILE_TOO_LARGE;
            const uniqueFileHash = EntityUtils.generateEntityHash(
              ENTITY_IDENTIFIERS.SKIPPED_FILE,
              `${filePath}||${baseMservPath}||${serviceVersionHash}||${reason}`
            );
            this.skippedFiles.push({ filePath, baseMservPath, serviceVersionHash, reason, uniqueFileHash });
            return { path: filePath, content: '' };
          }

          return { path: filePath, content };
        } catch (error) {
          console.error(`Error reading file ${filePath}:`, error);
          const reason = SkippedFileReason.READ_ERROR;
          const uniqueFileHash = EntityUtils.generateEntityHash(
            ENTITY_IDENTIFIERS.SKIPPED_FILE,
            `${filePath}||${baseMservPath}||${serviceVersionHash}||${reason}`
          );
          this.skippedFiles.push({ filePath, baseMservPath, serviceVersionHash, reason, uniqueFileHash });
          return { path: filePath, content: '' };
        }
      })
    );
    return results.filter((result) => result.content !== '');
  }

  /**
   * Exports all TypeParameter entities to CSV
   */
  private async exportTypeParametersCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allTypeParameters,
      OUTPUT_TYPE_PARAMETER_CSV_FILENAME,
      'Type parameters'
    );
  }

  /**
   * Exports all TypeReference entities to CSV
   */
  private async exportTypeReferencesCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allTypeReferences,
      OUTPUT_TYPE_REFERENCE_CSV_FILENAME,
      'Type references'
    );
  }

  /**
   * Exports all TypeAnnotation entities to CSV
   */
  private async exportAnnotationsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allAnnotations,
      OUTPUT_TYPE_ANNOTATION_CSV_FILENAME,
      'Type annotations'
    );
  }

  /**
   * Exports all AnnotationArgumentReference entities to CSV
   */
  private async exportAnnotationArgumentsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allAnnotationArguments,
      OUTPUT_ANNOTATION_ARGUMENT_CSV_FILENAME,
      'Annotation arguments'
    );
  }

  /**
   * Exports all MethodRegistry entities to CSV
   */
  private async exportMethodsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allMethods,
      OUTPUT_METHOD_REGISTRY_CSV_FILENAME,
      'Methods'
    );
  }

  /**
   * Exports all MethodParameter entities to CSV
   */
  private async exportMethodParametersCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allMethodParameters,
      OUTPUT_METHOD_PARAMETER_CSV_FILENAME,
      'Method parameters'
    );
  }

  /**
   * Exports all MethodTypeParameter entities to CSV
   */
  private async exportMethodTypeParametersCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allMethodTypeParameters,
      OUTPUT_METHOD_TYPE_PARAMETER_CSV_FILENAME,
      'Method type parameters'
    );
  }

  /**
   * Exports the module declarations to CSV. At most one per module-info.java, so this file is
   * empty for a project that does not use JPMS.
   */
  private async exportModulesCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allModules,
      OUTPUT_MODULE_REGISTRY_CSV_FILENAME,
      'Modules'
    );
  }

  /**
   * Exports the module directives to CSV
   */
  private async exportModuleDirectivesCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allModuleDirectives,
      OUTPUT_MODULE_DIRECTIVE_CSV_FILENAME,
      'Module directives'
    );
  }

  /**
   * Exports all EnumConstant entities to CSV
   */
  private async exportEnumConstantsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allEnumConstants,
      OUTPUT_ENUM_CONSTANT_CSV_FILENAME,
      'Enum constants'
    );
  }

  /**
   * Exports all FieldRegistry entities to CSV
   */
  private async exportFieldsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allFields,
      OUTPUT_FIELD_REGISTRY_CSV_FILENAME,
      'Fields'
    );
  }

  /**
   * Exports field declaration-order positions to CSV.
   *
   * Groups all fields by their owning type, sorts each group by startLine,
   * and assigns a 0-based integer position. Used by Datalog rules to match
   * constructor arguments at call sites to their corresponding parameter.
   *
   * Schema: typeRegistryLinkHash, fieldRegistryUniqueHash, position
   */
  private async exportFieldPositionsCsv(): Promise<void> {
    if (this.allFields.length === 0) {
      console.log(`\n⚠️  No fields to export positions for`);
      return;
    }

    // Group by owning type
    const byType = new Map<string, FieldRegistry[]>();
    for (const field of this.allFields) {
      const typeHash = field.getTypeRegistryLinkHash();
      let group = byType.get(typeHash);
      if (!group) {
        group = [];
        byType.set(typeHash, group);
      }
      group.push(field);
    }

    // Sort each group by startLine and assign positions
    const rows: string[] = [];
    for (const [typeHash, fields] of byType) {
      fields.sort((a, b) => a.getStartLine() - b.getStartLine());
      for (let pos = 0; pos < fields.length; pos++) {
        const field = fields[pos]!;
        rows.push(`${typeHash}\t${field.getHash()}\t${pos}`);
      }
    }

    const outputPath = path.join(this.outputDir, OUTPUT_FIELD_POSITION_CSV_FILENAME);
    const header = 'typeRegistryLinkHash\tfieldRegistryUniqueHash\tposition';
    await fs.writeFile(outputPath, header + '\n' + rows.join('\n') + '\n', 'utf-8');
    console.log(`💾 Field positions CSV exported to: ${outputPath}`);
  }

  /**
   * Exports all ImportRegistry entities to CSV
   */
  private async exportImportsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allImports,
      OUTPUT_IMPORT_REGISTRY_CSV_FILENAME,
      'Imports'
    );
  }

  /**
   * Exports all ExpressionReference entities to CSV
   */
  private async exportExpressionsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allExpressions,
      OUTPUT_EXPRESSION_REFERENCE_CSV_FILENAME,
      'Expressions'
    );
  }

  /**
   * Exports all LocalVariableRegistry entities to CSV
   */
  private async exportLocalVariablesCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allLocalVariables,
      OUTPUT_LOCAL_VARIABLE_REGISTRY_CSV_FILENAME,
      'Local Variables'
    );
  }

  /**
   * Exports all BlockRegistry entities to CSV
   */
  private async exportBlocksCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allBlocks,
      OUTPUT_BLOCK_REGISTRY_CSV_FILENAME,
      'Blocks'
    );
  }

  /**
   * Exports all CommentRegistry entities to CSV
   */
  private async exportCommentsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allComments,
      OUTPUT_COMMENT_REGISTRY_CSV_FILENAME,
      'Comments'
    );
  }

  /**
   * Exports all skipped files to CSV
   */
  private async exportSkippedFilesCsv(): Promise<void> {
    if (this.skippedFiles.length === 0) {
      console.log(`\n⚠️  No skipped files to export`);
      return;
    }

    const outputPath = path.join(this.outputDir, OUTPUT_SKIPPED_JAVA_FILES_CSV_FILENAME);
    const header = 'filePath\tbaseMservPath\tserviceVersionHash\treason\tuniqueFileHash';
    const rows = this.skippedFiles.map(
      (f) => `${f.filePath}\t${f.baseMservPath}\t${f.serviceVersionHash}\t${f.reason}\t${f.uniqueFileHash}`
    );
    const csvContent = [header, ...rows].join('\n');

    await fs.writeFile(outputPath, csvContent, 'utf-8');
    console.log(`💾 Skipped files CSV exported to: ${outputPath}`);
  }

  /**
   * Ensures the output directory exists
   */
  private async ensureOutputDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error(`Error creating output directory: ${error}`);
    }
  }

  /**
   * Exports all TypeRegistry data to a master CSV file
   */
  private async exportMasterCsv(): Promise<void> {
    if (this.allTypeRegistries.length === 0) {
      console.log('\n⚠️  No types to export to master CSV');
      return;
    }

    const csvPath = path.join(this.outputDir, OUTPUT_TYPE_REGISTRY_CSV_FILENAME);

    try {
      const firstType = this.allTypeRegistries[0];
      if (!firstType) return;
      
      const header = firstType.getCsvHeader();
      const rows = this.allTypeRegistries.map((type) => type.toCsv());
      const csvContent = [header, ...rows].join('\n');

      await fs.writeFile(csvPath, csvContent, 'utf-8');
      console.log(`\n💾 CSV exported to: ${csvPath}`);
    } catch (error) {
      console.error(`\n❌ Error exporting master CSV:`, error);
    }
  }
}
