// `new` through a variable that HOLDS a class. The callee is a value, so nothing at the
// `new` site names a type and the construction produced no type at all -- neither the
// constructor nor the instance the result is used as, so every call on the result was
// unresolved.
//
// All three spellings share one IR shape: the initializer is an IDENTIFIER_REFERENCE
// whose referencedEntityKind is TYPE and whose entity is the class. Neither annotation
// has to be understood, which is why the bare alias -- the one carrying no annotation at
// all -- resolves by the same rule.
export class Dog { fetch(): void {} }

export function use(): void {
  new Dog().fetch();                    // control: the type is written at the site

  const Alias = Dog;
  new Alias().fetch();                  // a bare alias, no annotation

  const Annotated: typeof Dog = Dog;
  new Annotated().fetch();              // a `typeof` annotation

  const Ctor: new () => Dog = Dog;
  new Ctor().fetch();                   // a construct-signature annotation
}
