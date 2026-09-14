"""A client SUBPACKAGE. Every other client fixture is flat, which is exactly why the
relative-import defect could not reproduce: at the parse root a module's qualifiedName
carries no package prefix, so it happens to equal the relative `packageOrTypeName` the
import records. Only inside a package do the two strings differ."""
