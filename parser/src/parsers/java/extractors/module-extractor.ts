import Parser from 'tree-sitter';

import { ModuleDirective } from '@/analysis-types/java/ModuleDirective';
import { ModuleRegistry } from '@/analysis-types/java/ModuleRegistry';
import { ModuleDirectiveKind, ModuleDirectiveModifier } from '@/enums/java/modules';

/**
 * Extracts the module declaration in a `module-info.java` (JLS 7.7).
 *
 * The grammar already types every directive - `requires_module_directive`,
 * `exports_module_directive`, and so on - so this walks the `module_body` and reads them off.
 * Nothing here has to recover structure from raw text.
 */
export class ModuleExtractor {
  private extractedDirectives: ModuleDirective[] = [];

  /**
   * Returns the directives extracted during the last extract() call.
   */
  getExtractedDirectives(): ModuleDirective[] {
    return this.extractedDirectives;
  }

  /**
   * Extracts the module declaration from a parsed compilation unit, or null when the file
   * declares no module. Only `module-info.java` may contain one.
   */
  extract(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    serviceVersionHash: string
  ): ModuleRegistry | null {
    this.extractedDirectives = [];

    const moduleNode = rootNode.children.find(c => c.type === 'module_declaration');
    if (!moduleNode) return null;

    const name = this.moduleName(moduleNode);
    if (!name) return null;

    // `open module M { }` opens every package, so such a module may legitimately declare no
    // `opens` directive at all.
    const isOpen = moduleNode.children.some(c => c.type === 'open' || c.text === 'open');

    const module = new ModuleRegistry(
      name,
      isOpen,
      filePath,
      moduleNode.startPosition.row + 1,
      moduleNode.endPosition.row + 1,
      serviceVersionHash
    );

    const body = moduleNode.children.find(c => c.type === 'module_body');
    if (body) {
      for (const directive of body.children) {
        this.extractDirective(directive, module, filePath, serviceVersionHash);
      }
    }

    return module;
  }

  /**
   * The module name is the scoped_identifier directly under module_declaration - not one of the
   * scoped_identifiers inside the body, which name packages and services.
   */
  private moduleName(moduleNode: Parser.SyntaxNode): string | null {
    const nameNode = moduleNode.children.find(
      c => c.type === 'scoped_identifier' || c.type === 'identifier'
    );
    return nameNode ? nameNode.text : null;
  }

  private extractDirective(
    node: Parser.SyntaxNode,
    module: ModuleRegistry,
    filePath: string,
    serviceVersionHash: string
  ): void {
    const kind = this.directiveKind(node.type);
    if (!kind) return;

    // Every name the directive mentions, in source order. The first is the subject; any that
    // follow are the `to` / `with` targets.
    const names = node.children
      .filter(c => c.type === 'scoped_identifier' || c.type === 'identifier')
      .map(c => c.text);

    const subject = names[0];
    if (!subject) return;

    const modifiers = this.requiresModifiers(node);
    const targets = names.slice(1);
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const push = (targetName: string, position: number) => {
      this.extractedDirectives.push(new ModuleDirective(
        module.getHash(),
        kind,
        subject,
        targetName,
        modifiers,
        position,
        filePath,
        startLine,
        endLine,
        serviceVersionHash
      ));
    };

    if (targets.length === 0) {
      // Unqualified: `exports p;`, `requires m;`, `uses s;`. One row, empty target.
      push('', 0);
      return;
    }

    targets.forEach((target, index) => push(target, index));
  }

  private directiveKind(nodeType: string): ModuleDirectiveKind | null {
    switch (nodeType) {
      case 'requires_module_directive': return ModuleDirectiveKind.REQUIRES;
      case 'exports_module_directive': return ModuleDirectiveKind.EXPORTS;
      case 'opens_module_directive': return ModuleDirectiveKind.OPENS;
      case 'uses_module_directive': return ModuleDirectiveKind.USES;
      case 'provides_module_directive': return ModuleDirectiveKind.PROVIDES;
      default: return null;
    }
  }

  /**
   * `transitive` and `static` appear as requires_modifier children. Only `requires` takes them.
   */
  private requiresModifiers(node: Parser.SyntaxNode): ModuleDirectiveModifier[] {
    const modifiers: ModuleDirectiveModifier[] = [];
    for (const child of node.children) {
      if (child.type !== 'requires_modifier') continue;
      if (child.text.includes('transitive')) modifiers.push(ModuleDirectiveModifier.TRANSITIVE);
      if (child.text.includes('static')) modifiers.push(ModuleDirectiveModifier.STATIC);
    }
    return modifiers;
  }
}
