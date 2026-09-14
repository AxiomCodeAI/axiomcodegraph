// `export =` makes the MODULE ITSELF the entity. An `import x = require(...)` binds that
// entity rather than a member of it, so nothing at a `new x()` site names a type and the
// construction produced no instance type at all -- losing every call on the result. This
// is the dominant shape in `@types` packages for CommonJS libraries.
class LegacyImpl { go(): number { return 1; } }
export = LegacyImpl;
