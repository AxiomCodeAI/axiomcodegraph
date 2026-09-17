// CS-CORPUS-1 is about a file of top-level statements emitting nothing below
// cs_module, and it cannot be written HERE: a compilation may contain at most
// one file with top-level statements, and this project has six ordinary files.
//
// The cover lives in categories/projects/proj-top-level/, which cs-fixtures
// built for exactly that reason. This file exists so that a reader looking for
// the sixth finding in the six-finding project is told where it is, rather than
// concluding it has no cover.
namespace Fixtures.WalkGaps
{
    public static class SeeProjTopLevel { }
}
