// GATE FIXTURE, part 3 — `async` as a NAMESPACE SEGMENT and as a qualified-name
// component.
//
// Its own file for two compiler reasons, both worth knowing: a block namespace
// may not sit beside a file-scoped one (CS8955), and `namespace async.Nested`
// would collide with the `class async` in AsyncAsIdentifier.cs (CS0101). So
// this reading of the token genuinely needs a separate compilation unit, which
// is also why a single-file gate would miss it.
using System;

namespace async
{
    public class InAsyncNamespace
    {
        public int Value => 1;
    }

    namespace await
    {
        public class InAwaitNamespace
        {
            public int Value => 2;
        }
    }

    namespace var.dynamic.record
    {
        public class DeepContextualNamespace
        {
            public int Value => 3;
        }
    }
}

namespace Fixtures.GrammarGate.Consumers
{
    // `using async;` DOES NOT COMPILE from inside Fixtures.GrammarGate.*, and
    // the reason is worth the fixture: AsyncAsIdentifier.cs declares a
    // `class async` in `Fixtures.GrammarGate`, and a member of an enclosing
    // namespace is found BEFORE any global namespace of the same name. So
    // `async` binds to the TYPE and the directive is CS0138 ("a 'using
    // namespace' directive can only be applied to namespaces"). Same shape as
    // the alias-versus-sibling-namespace finding already recorded in
    // ../csharp-only/misc/UsingFourForms.cs, arrived at from the other side.
    //
    // The two ways out are the root alias and an alias built on it, both below.
    using AsyncNs = global::async;
    using AwaitNs = global::async.await;

    public class ReachesAsyncNamespace
    {
        // Through an ALIAS rooted at global::.
        private readonly AsyncNs.InAsyncNamespace viaAlias = new AsyncNs.InAsyncNamespace();

        private readonly AwaitNs.InAwaitNamespace viaNestedAlias = new AwaitNs.InAwaitNamespace();

        // By fully-qualified name, where every segment is a contextual keyword.
        private readonly global::async.InAsyncNamespace viaQualified = new global::async.InAsyncNamespace();

        private readonly global::async.var.dynamic.record.DeepContextualNamespace viaDeep =
            new global::async.var.dynamic.record.DeepContextualNamespace();

        // The TYPE named `async`, which is what shadowed the namespace.
        private readonly global::Fixtures.GrammarGate.async shadowingType = new global::Fixtures.GrammarGate.async();

        public int Total() =>
            viaAlias.Value + viaNestedAlias.Value + viaQualified.Value + viaDeep.Value + shadowingType.Value;
    }
}
