/**
 * How a plugin is applied in a Gradle build file.
 *
 * ## Examples
 *
 * ```groovy
 * // PLUGINS_BLOCK_CORE — core plugin by name, no id() call
 * plugins { java }
 *
 * // PLUGINS_BLOCK_ID
 * plugins { id 'org.springframework.boot' version '3.1.5' }
 *
 * // APPLY_PLUGIN_STRING
 * apply plugin: 'java'
 *
 * // APPLY_PLUGIN_CLASS
 * apply plugin: MyPlugin
 *
 * // APPLY_FROM_LOCAL
 * apply from: 'gradle/dependencies.gradle'
 *
 * // APPLY_FROM_REMOTE
 * apply from: 'https://raw.githubusercontent.com/.../init.gradle'
 *
 * // BUILDSCRIPT_CLASSPATH — legacy
 * buildscript { dependencies { classpath 'com.android.tools.build:gradle:8.1.0' } }
 *
 * // PLUGIN_ALIAS — version catalog
 * plugins { alias(libs.plugins.spring.boot) }
 * ```
 */
export enum GradlePluginSyntax {
  /** plugins { java } — core plugin by name, no id() call */
  PLUGINS_BLOCK_CORE = 'PLUGINS_BLOCK_CORE',

  /** plugins { id 'x' version 'y' } or plugins { id("x") version "y" } */
  PLUGINS_BLOCK_ID = 'PLUGINS_BLOCK_ID',

  /** apply plugin: 'x' */
  APPLY_PLUGIN_STRING = 'APPLY_PLUGIN_STRING',

  /** apply plugin: MyPlugin (class reference) */
  APPLY_PLUGIN_CLASS = 'APPLY_PLUGIN_CLASS',

  /** apply from: 'local/path.gradle' */
  APPLY_FROM_LOCAL = 'APPLY_FROM_LOCAL',

  /** apply from: 'https://...' */
  APPLY_FROM_REMOTE = 'APPLY_FROM_REMOTE',

  /** buildscript { dependencies { classpath 'x' } } — legacy */
  BUILDSCRIPT_CLASSPATH = 'BUILDSCRIPT_CLASSPATH',

  /** alias(libs.plugins.x) — version catalog */
  PLUGIN_ALIAS = 'PLUGIN_ALIAS',
}
