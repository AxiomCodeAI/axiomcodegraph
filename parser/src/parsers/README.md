# Parsers

This folder contains the core parsing infrastructure for analyzing source code. The architecture implements a multi-layered, extensible system built on tree-sitter for AST-based code analysis.

## Architecture Overview

The parsing system follows a **Registry-Coordinator Pattern** with these key layers:

1. **Parser Layer** - Language-specific tree-sitter parsers that convert source code to AST
2. **Extractor Layer** - Specialized extractors that traverse AST nodes and extract entities
3. **Coordination Layer** - Manages parser and extractor registration and orchestrates extraction
4. **Factory Layer** - Creates and manages parser instances

### Design Principles

- **Separation of Concerns**: Each component has a single, well-defined responsibility
- **Plugin Architecture**: New languages and extractors can be added without modifying core code
- **Type Safety**: TypeScript generics ensure type-safe extraction across different entity types
- **Error Resilience**: Retry mechanisms and graceful degradation for parsing failures
- **Extensibility**: Registry-based design allows runtime configuration of parsers and extractors

## Core Components

### base-extractor.ts

**Interface**: `BaseExtractor<T extends EntityIdentifiable>`

Defines the contract that all extractors must implement. This is the foundation of the extraction system.

```typescript
interface BaseExtractor<T extends EntityIdentifiable> {
  extract(filePath: string, fileContent: string, serviceVersionHash: string): T[];
}
```

**Key Concepts**:
- Generic type `T` ensures type-safe extraction of specific entity types
- Returns array of entities, allowing extractors to find multiple instances per file
- `serviceVersionHash` links extracted entities to specific analysis runs
- Stateless design - each call is independent

**Purpose**: Provides polymorphic behavior where different extractors can be used interchangeably through a common interface.

---

### code-extractor.ts

**Class**: `CodeExtractor`

The central orchestrator that manages the registry of extractors and coordinates the extraction process.

**Architecture**:
```
CodeExtractor
├── ParserFactory (creates language-specific parsers)
└── extractorRegistry: Map<Language, Map<EntityType, Extractor>>
    ├── JAVA
    │   ├── "TypeRegistry" → TypeRegistryExtractor
    │   ├── "Method" → MethodExtractor (future)
    │   └── ... (other entity types)
    └── [Other Languages]
```

**Key Methods**:

1. **registerExtractor(language, entityType, extractor)**
   - Registers an extractor for a specific language and entity type
   - Creates nested maps: Language → EntityType → Extractor
   - Called during system initialization to configure available extractors

2. **extract(language, entityType, filePath, fileContent, serviceVersionHash)**
   - Main extraction entry point
   - Looks up the appropriate extractor from the registry
   - Delegates to the extractor and handles errors gracefully
   - Returns empty array on failure (fail-safe behavior)

3. **extractFromFiles(language, entityType, files, serviceVersionHash)**
   - Batch extraction from multiple files
   - Aggregates results across all files
   - Used for project-wide analysis

**Error Handling Strategy**:
- Warns when extractors are missing (non-fatal)
- Catches and logs extraction errors per file
- Returns empty arrays to allow processing to continue
- Prevents single file failures from breaking entire analysis

**Purpose**: Decouples the workflow layer from specific extractor implementations, enabling dynamic registration and language/entity-specific processing.

---

### language-parser.ts

**Interface**: `LanguageParser`

Defines the contract for language-specific parsers that use tree-sitter.

```typescript
interface LanguageParser {
  readonly language: ProjectLanguage;
  readonly fileExtension: string;
  parse(sourceCode: string): Parser.Tree;
  getRootNode(tree: Parser.Tree): Parser.SyntaxNode;
  query(node: Parser.SyntaxNode, queryString: string): Parser.QueryMatch[];
}
```

**Key Responsibilities**:
- **parse()**: Converts source code string into tree-sitter AST
- **getRootNode()**: Provides access to the root of the syntax tree
- **query()**: Enables tree-sitter query language for node selection

**Tree-sitter Integration**:
- Each parser wraps a tree-sitter Parser instance
- Must call `setLanguage()` with the appropriate grammar (e.g., Java, Python)
- Returns immutable syntax trees that can be traversed

**Purpose**: Abstracts tree-sitter specifics and provides a consistent interface for working with different language grammars.

---

### parser-factory.ts

**Class**: `ParserFactory`

Factory pattern implementation for creating and managing parser instances.

**Architecture**:
```
ParserFactory
└── parsers: Map<ProjectLanguage, LanguageParser>
    ├── JAVA → JavaParser
    └── [Future languages]
```

**Initialization Flow**:
1. Constructor creates empty parser registry
2. `registerDefaultParsers()` automatically registers built-in parsers
3. Currently registers JavaParser by default

**Key Methods**:

1. **getParser(language)**: Returns parser for specific language
2. **getParserByExtension(fileExtension)**: Finds parser by file extension (.java, .py, etc.)
3. **isLanguageSupported(language)**: Checks if language has a registered parser
4. **getSupportedLanguages()**: Returns all languages with parsers

**Design Benefits**:
- Lazy initialization of parsers
- Single parser instance per language (singleton per language)
- Easy to extend with new languages
- Supports lookup by language or file extension

**Purpose**: Centralizes parser creation and ensures consistent parser instances across the application.

---

## Subfolders

### java/

Java-specific parsing implementation.

**Files**:
- **java-parser.ts** - Implements `LanguageParser` for Java using tree-sitter-java
- **extractors/** - Specialized extractors for Java code elements

See `java/README.md` for detailed Java-specific documentation.

---

## Data Flow

### Complete Extraction Pipeline

```
1. Workflow Layer (JavaProjectAnalyzer)
   ↓ Registers extractors
   CodeExtractor.registerExtractor(JAVA, "TypeRegistry", new TypeRegistryExtractor())
   
2. File Processing
   ↓ For each .java file
   CodeExtractor.extract(JAVA, "TypeRegistry", filePath, fileContent, versionHash)
   
3. Extractor Lookup
   ↓ Registry lookup
   extractorRegistry.get(JAVA).get("TypeRegistry") → TypeRegistryExtractor
   
4. Parsing Phase
   ↓ TypeRegistryExtractor calls
   JavaParser.parse(fileContent) → AST Tree
   
5. Tree-sitter Parsing
   ↓ Tree-sitter internal
   Source Code → Lexical Analysis → Syntax Tree
   
6. AST Traversal
   ↓ Extractor walks AST
   getRootNode() → Traverse children recursively
   
7. Entity Extraction
   ↓ For each type declaration node
   Create TypeRegistry instance with metadata
   
8. Return Results
   ↓ Array of entities
   [TypeRegistry, TypeRegistry, ...] → Workflow Layer
```

### Example: Extracting a Java Class

**Input**: `User.java`
```java
package com.example;

@Entity
public class User {
    private String name;
}
```

**Processing Steps**:

1. **Parsing**:
   ```
   JavaParser.parse(sourceCode)
   → Creates tree-sitter AST with nodes:
      program
      └── class_declaration
          ├── modifiers
          │   └── annotation (@Entity)
          ├── identifier (User)
          └── class_body
              └── field_declaration (name)
   ```

2. **Traversal**:
   - TypeRegistryExtractor walks AST
   - Identifies `class_declaration` node
   - Extracts metadata: name="User", access=PUBLIC, category=CLASS

3. **Sub-extraction**:
   - Calls AnnotationExtractor for @Entity
   - Calls TypeParameterExtractor (none found)
   - Calls TypeReferenceExtractor for String field

4. **Entity Creation**:
   ```typescript
   new TypeRegistry({
     name: "User",
     qualifiedName: "com.example.User",
     typeCategory: TypeCategory.CLASS_TYPE,
     typeAccess: TypeAccess.PUBLIC_ACCESS,
     // ... more metadata
   })
   ```

5. **Return**: Array containing the User TypeRegistry entity

---

## Tree-sitter Specifics

### What is Tree-sitter?

Tree-sitter is an incremental parsing library that creates concrete syntax trees. Unlike abstract syntax trees, it preserves all source code details including whitespace and comments.

**Key Characteristics**:
- **Error-tolerant**: Can parse incomplete or syntactically invalid code
- **Incremental**: Can efficiently update trees when code changes
- **Query language**: Supports pattern matching with S-expressions
- **Language-agnostic**: Each language has its own grammar

### Tree-sitter Java Integration

The `JavaParser` uses the `tree-sitter-java` grammar which understands:
- All Java syntax from Java 8-17+
- Generics, annotations, lambdas, records
- Module declarations
- Modern features (sealed classes, pattern matching)

### Node Types

Common Java node types encountered:
- `class_declaration`, `interface_declaration`, `enum_declaration`, `record_declaration`
- `field_declaration`, `method_declaration`, `constructor_declaration`
- `annotation`, `type_identifier`, `generic_type`
- `formal_parameters`, `type_parameters`

### AST Navigation

**Tree Structure**:
```
SyntaxNode
├── type: string (e.g., "class_declaration")
├── text: string (source code text)
├── startPosition: {row, column}
├── endPosition: {row, column}
├── children: SyntaxNode[]
├── namedChildren: SyntaxNode[] (excludes punctuation)
└── parent: SyntaxNode
```

**Traversal Patterns**:

1. **Recursive descent**:
   ```typescript
   function traverse(node: SyntaxNode) {
     // Process current node
     for (const child of node.children) {
       traverse(child); // Recurse
     }
   }
   ```

2. **Query-based**:
   ```typescript
   const matches = parser.query(rootNode, `
     (class_declaration
       name: (identifier) @class_name)
   `);
   ```

---

## Extractor Pattern

### How Extractors Work

Each extractor is responsible for:
1. **Parsing**: Using JavaParser to get AST
2. **Traversal**: Walking the tree to find relevant nodes
3. **Recognition**: Identifying nodes that represent their target entities
4. **Extraction**: Pulling metadata from nodes
5. **Construction**: Creating entity instances
6. **Aggregation**: Collecting related sub-entities

### Extractor Collaboration

Extractors often delegate to other extractors:

```
TypeRegistryExtractor (main extractor)
├── Calls TypeParameterExtractor
│   └── Extracts <T, E> from class/method declarations
├── Calls AnnotationExtractor
│   ├── Extracts @Entity, @Service, etc.
│   └── Calls AnnotationArgumentExtractor for nested values
└── Calls TypeReferenceExtractor
    └── Extracts type references (fields, parameters, etc.)
```

**Why This Pattern?**:
- Each extractor has focused responsibility
- TypeRegistryExtractor coordinates and aggregates results
- Sub-extractors are reusable across different contexts
- Enables independent testing of each extractor

### Stateful Extraction

TypeRegistryExtractor maintains state during extraction:

```typescript
class TypeRegistryExtractor {
  private extractedTypeParameters: TypeParameter[] = [];
  private extractedTypeReferences: TypeReference[] = [];
  private extractedAnnotations: TypeAnnotation[] = [];
  // ...
  
  extract(filePath, fileContent, serviceVersionHash) {
    // Reset state for each file
    this.extractedTypeParameters = [];
    // ... process file
    // State accumulates during processing
  }
  
  // Accessors to retrieve accumulated state
  getExtractedTypeParameters() { return this.extractedTypeParameters; }
}
```

**Purpose**: Allows workflow layer to retrieve all extracted entities from a single extraction pass.

---

## Error Handling & Resilience

### Retry Mechanism

**JavaParser** uses a retry decorator for parsing:

```typescript
const parseWithRetry = withRetry(
  (code: string) => this.parser.parse(code),
  {
    maxAttempts: 3,
    delayMs: 1500,
    exponentialBackoff: true,
    onRetry: (attempt, error) => {
      console.warn(`Parse attempt ${attempt} failed, retrying...`);
    }
  }
);
```

**Why Retry?**:
- Tree-sitter can occasionally fail due to memory limits
- Network-mounted filesystems may cause transient issues
- Exponential backoff prevents rapid repeated failures

### Large File Handling

**Problem**: Tree-sitter has internal buffer limits (~32-35KB for string parsing)

**Solution**: Callback-based parsing for files > 30KB

```typescript
if (sourceCode.length > 30000) {
  // Streaming parser - feeds code in chunks
  this.parser.parse((index: number) => {
    if (index >= code.length) return null;
    const chunk = code.substring(index, Math.min(index + 8192, code.length));
    return chunk;
  });
} else {
  // Direct string parsing (faster for small files)
  this.parser.parse(sourceCode);
}
```

**Benefits**:
- Handles arbitrarily large files
- Maintains compatibility with tree-sitter internals
- Automatic selection based on file size

### Graceful Degradation

**At every level, failures are handled gracefully**:

1. **Parser level**: Invalid code → logs warning, returns empty results
2. **Extractor level**: Extraction error → logs error, returns empty array
3. **Coordinator level**: Missing extractor → logs warning, returns empty array
4. **Workflow level**: Continues processing remaining files

**Philosophy**: **Fail gracefully, continue processing**. One bad file shouldn't break the entire analysis.

---

## Extension Points

### Adding a New Language

1. **Create Language Parser**:
   ```typescript
   export class PythonParser implements LanguageParser {
     readonly language = ProjectLanguage.PYTHON;
     readonly fileExtension = '.py';
     
     constructor() {
       this.parser = new Parser();
       this.parser.setLanguage(Python); // tree-sitter-python
     }
     
     parse(sourceCode: string): Parser.Tree { ... }
   }
   ```

2. **Register in ParserFactory**:
   ```typescript
   private registerDefaultParsers(): void {
     this.registerParser(new JavaParser());
     this.registerParser(new PythonParser()); // Add here
   }
   ```

3. **Create Extractors**:
   ```typescript
   export class PythonClassExtractor implements BaseExtractor<TypeRegistry> {
     extract(filePath, fileContent, serviceVersionHash) {
       // Python-specific extraction logic
     }
   }
   ```

4. **Register Extractors**:
   ```typescript
   codeExtractor.registerExtractor(
     ProjectLanguage.PYTHON,
     "TypeRegistry",
     new PythonClassExtractor()
   );
   ```

### Adding a New Entity Type

1. **Create Entity Model** (in `analysis-types/`):
   ```typescript
   export class Method implements EntityIdentifiable {
     // Define properties
   }
   ```

2. **Create Extractor**:
   ```typescript
   export class MethodExtractor implements BaseExtractor<Method> {
     extract(filePath, fileContent, serviceVersionHash): Method[] {
       // Extraction logic
     }
   }
   ```

3. **Register**:
   ```typescript
   codeExtractor.registerExtractor(JAVA, "Method", new MethodExtractor());
   ```

4. **Use in Workflow**:
   ```typescript
   const methods = codeExtractor.extract(JAVA, "Method", filePath, content, hash);
   ```

---

## Performance Considerations

### Parsing Performance

- **Small files** (<30KB): ~10-50ms per file
- **Large files** (>30KB): ~50-200ms per file
- **Batch processing**: Files processed sequentially per project
- **Projects**: Multiple projects analyzed in parallel

### Memory Management

- **Tree-sitter trees**: Immutable, garbage collected after processing
- **Extractor state**: Reset per file to prevent memory leaks
- **Aggregation**: Results accumulated in workflow layer

### Optimization Strategies

1. **Lazy parsing**: Only parse files when needed
2. **Streaming**: Callback parsing for large files
3. **Error recovery**: Skip unparseable files rather than crashing
4. **Parallel projects**: Workflow processes projects concurrently

---

## Testing Strategy

### Unit Testing Extractors

Each extractor should be tested independently:

```typescript
describe('TypeRegistryExtractor', () => {
  it('should extract class declaration', () => {
    const sourceCode = 'public class User {}';
    const extractor = new TypeRegistryExtractor();
    const results = extractor.extract('User.java', sourceCode, 'v1');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('User');
  });
});
```

### Integration Testing

Test extractor coordination:

```typescript
describe('CodeExtractor', () => {
  it('should coordinate multiple extractors', () => {
    const codeExtractor = new CodeExtractor();
    codeExtractor.registerExtractor(JAVA, "TypeRegistry", extractor);
    const results = codeExtractor.extract(JAVA, "TypeRegistry", ...);
    // Verify results
  });
});
```

---

## Summary

The parsing infrastructure is a **multi-layered, registry-based system** that:

- **Separates concerns**: Parsers handle AST creation, extractors handle entity extraction
- **Enables extensibility**: New languages and entity types added via registration
- **Ensures type safety**: TypeScript generics throughout
- **Handles errors gracefully**: Retry mechanisms and fail-safe behavior
- **Optimizes performance**: Streaming for large files, parallel project processing
- **Maintains clean architecture**: Factory, registry, and strategy patterns

This design enables the system to analyze complex codebases reliably while remaining maintainable and extensible.
