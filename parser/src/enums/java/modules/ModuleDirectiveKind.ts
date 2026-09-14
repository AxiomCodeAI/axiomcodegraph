/**
 * The five directive forms a module declaration may contain (JLS 7.7).
 *
 * ```java
 * module com.example.app {
 *     requires java.sql;                                   // REQUIRES
 *     requires transitive java.logging;                    // REQUIRES + TRANSITIVE
 *     requires static java.compiler;                       // REQUIRES + STATIC
 *     exports com.example.api;                             // EXPORTS, no target
 *     exports com.example.internal to com.example.client;  // EXPORTS, one target
 *     opens com.example.model;                             // OPENS
 *     uses com.example.spi.Service;                        // USES
 *     provides com.example.spi.Service
 *         with com.example.impl.ServiceImpl;               // PROVIDES, one target
 * }
 * ```
 *
 * ## Subject and target
 *
 * Every directive names one subject; some also name a list of targets. The two are kept in
 * separate columns rather than one joined string, so a directive with N targets becomes N rows
 * that differ only in `targetName` and `position` — which is the shape a join wants.
 *
 * | kind | subjectName | targetName |
 * |---|---|---|
 * | REQUIRES | the required module | *(empty)* |
 * | EXPORTS  | the exported package | each module in `to`, or empty when unqualified |
 * | OPENS    | the opened package | each module in `to`, or empty when unqualified |
 * | USES     | the service type consumed | *(empty)* |
 * | PROVIDES | the service type implemented | each implementation in `with` |
 */
export enum ModuleDirectiveKind {
  REQUIRES = 'REQUIRES',
  EXPORTS = 'EXPORTS',
  OPENS = 'OPENS',
  USES = 'USES',
  PROVIDES = 'PROVIDES',
}
