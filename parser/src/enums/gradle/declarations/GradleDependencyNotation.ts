/**
 * How a dependency coordinate is expressed in Gradle DSL.
 *
 * ## Examples
 *
 * ```groovy
 * // STRING_NOTATION
 * implementation 'com.google.guava:guava:32.1.3-jre'
 *
 * // MAP_NOTATION
 * implementation group: 'com.google.guava', name: 'guava', version: '32.1.3-jre'
 *
 * // PROJECT
 * implementation project(':core')
 *
 * // PLATFORM
 * implementation platform('org.springframework.boot:spring-boot-dependencies:3.1.5')
 *
 * // VERSION_CATALOG_ACCESSOR
 * implementation libs.spring.boot.starter.web
 * ```
 */
export enum GradleDependencyNotation {
  /** 'group:artifact:version' */
  STRING_NOTATION = 'STRING_NOTATION',

  /** 'group:artifact:version:classifier' */
  STRING_WITH_CLASSIFIER = 'STRING_WITH_CLASSIFIER',

  /** 'group:artifact:version@ext' or 'group:artifact:version:classifier@ext' */
  STRING_WITH_EXTENSION = 'STRING_WITH_EXTENSION',

  /** group: 'x', name: 'y', version: 'z' */
  MAP_NOTATION = 'MAP_NOTATION',

  /** project(':path') */
  PROJECT = 'PROJECT',

  /** files('x.jar') or files('a.jar', 'b.jar') */
  FILES = 'FILES',

  /** fileTree('dir') or fileTree(dir: 'x', include: '*.jar') */
  FILE_TREE = 'FILE_TREE',

  /** platform('group:artifact:version') */
  PLATFORM = 'PLATFORM',

  /** enforcedPlatform('group:artifact:version') */
  ENFORCED_PLATFORM = 'ENFORCED_PLATFORM',

  /** testFixtures(project(':x')) */
  TEST_FIXTURES = 'TEST_FIXTURES',

  /** gradleApi() */
  GRADLE_API = 'GRADLE_API',

  /** gradleTestKit() */
  GRADLE_TEST_KIT = 'GRADLE_TEST_KIT',

  /** localGroovy() */
  LOCAL_GROOVY = 'LOCAL_GROOVY',

  /** add("configuration", "group:artifact:version") */
  ADD_METHOD = 'ADD_METHOD',

  /** dependencies.create("group:artifact:version") */
  CREATE_METHOD = 'CREATE_METHOD',

  /** libs.spring.boot.starter (version catalog accessor) */
  VERSION_CATALOG_ACCESSOR = 'VERSION_CATALOG_ACCESSOR',
}
