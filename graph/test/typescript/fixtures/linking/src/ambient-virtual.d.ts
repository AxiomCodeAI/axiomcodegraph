// An AMBIENT MODULE. `virtual-tools` is not a package and there is no file to resolve
// the specifier to: the declaration exists only because this file says so. Real projects
// use this for bundler-provided modules, and a resolver that requires a file on disk
// fails the import outright rather than landing here.
declare module 'virtual-tools' {
  export function ping(input: string): number;
  export class Beacon {
    emit(signal: string): number;
  }
}
