// `export =` OVER A NAMESPACE — how a pre-ESM package presents itself, and still how a
// large share of published .d.ts files are written. There is no export SPECIFIER here
// at all: the module's entire export is one namespace symbol, and every member is
// reached by walking into it.
declare namespace legacy {
  function pack(input: string): string;

  class Bundle {
    add(item: string): Bundle;
    count(): number;
  }

  namespace nested {
    function deepPack(input: string): string;
  }
}
export = legacy;
