// HALF TWO — FILE-SCOPED namespaces (C# 10). One namespace, no braces, and the
// whole rest of the file is inside it. 7,626 file-scoped against 1,795 block in
// the measured corpus, so this is the common path and the block form is the
// exception.
//
// A file-scoped namespace CANNOT coexist with a block namespace in the same
// file (CS8955), and there may be at most one of them. The block form is in
// BlockNamespaces.cs and the several-per-file case in MultipleNamespaces.cs.
using System;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Namespaces.FileScoped;

public class InFileScopedNamespace
{
    public string QualifiedName => typeof(InFileScopedNamespace).FullName ?? string.Empty;
}

public interface IInFileScoped
{
}

// A namespace declaration cannot NEST inside a file-scoped one, so the only way
// to reach a deeper namespace from here is to write it out in the header. What
// CAN nest is a TYPE.
public class Outer
{
    public class Nested
    {
        public class Deeper
        {
            public int Value => 1;
        }
    }
}
