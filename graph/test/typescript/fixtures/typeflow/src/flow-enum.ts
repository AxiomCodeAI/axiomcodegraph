// ENUMS AND NAMESPACES IN THE CLIENT — declaration spaces that are neither a class nor a
// module, and that a call can travel through.
import { Alpha, Beta } from '@f/shapes';

export enum Level {
  Low = 'low',
  High = 'high',
}

// A const enum: erased at emit, so an IR built from emitted JavaScript loses the member
// access entirely and an IR built from source keeps it.
export const enum Flag {
  On = 1,
  Off = 0,
}

export function describe(level: Level): string {
  return level.toUpperCase();                  // String.toUpperCase — the enum's base type
}

export function useFlag(): number {
  return Math.max(Flag.On, Flag.Off);          // Math.max, with const-enum arguments
}

// A NAMESPACE holding both a value and a nested namespace. `Tools.inner.build()` is two
// containment hops from the export, in the client rather than in a library.
export namespace Tools {
  export function build(): Alpha {
    return new Alpha();
  }
  export namespace inner {
    export function buildBeta(): Beta {
      return new Beta();
    }
  }
}

export function viaNamespace(): string {
  return Tools.build().tag();                  // Tools.build, then Alpha.tag
}

export function viaNestedNamespace(): number {
  return Tools.inner.buildBeta().only_beta();  // two hops, then Beta.only_beta
}

// CLASS AND NAMESPACE MERGING in the client: one identifier, two declaration spaces.
export class Widget {
  render(): string {
    return 'widget';
  }
}
export namespace Widget {
  export function create(): Widget {
    return new Widget();
  }
}

export function viaMergedNamespace(): string {
  return Widget.create().render();             // Widget.create (namespace), Widget.render (class)
}
