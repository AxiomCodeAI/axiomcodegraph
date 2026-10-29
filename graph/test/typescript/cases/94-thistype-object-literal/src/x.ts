// `this` in the methods of an object literal written as `X & ThisType<T>`: the compiler
// types it as T. A prototype table or a mixin is written this way, and every `this.m()` in
// one resolved to nothing. Covered: the marker through a generic alias bound by an explicit
// type argument, through an annotation, and written inline.
interface Greeter { name: string; greet(): string; shout(): string; hail(): string; wave(): string }
type Members<T> = { [K in keyof T]?: T[K] } & ThisType<T>;
interface Mixin<T> { make(): T }
declare function mixin<T>(name: string, members?: Members<T>): Mixin<T>;

const viaTypeArgument = mixin<Greeter>("Greeter", {
  greet() { return this.shout(); },
  shout: function shout() { return this.greet(); },
});
const viaAnnotation: Members<Greeter> = {
  hail() { return this.greet(); },
};
interface Waver { wave?(): string }
const inline: Waver & ThisType<Greeter> = {
  wave() { return this.shout(); },
};

// controls: without the marker `this` is the literal; an arrow property keeps the class's
const plainLiteral = {
  a() { return 1; },
  b() { return this.a(); },
};
class Host {
  run(): string { return "r"; }
  table = mixin<Greeter>("Host", { greet: () => this.run() });
}
export { viaTypeArgument, viaAnnotation, inline, plainLiteral, Host };
