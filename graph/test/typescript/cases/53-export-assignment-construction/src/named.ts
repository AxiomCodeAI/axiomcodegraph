// The control is a NAMED export, not `export default class`: the parser records a
// default-exported class's name as `default` rather than its declared name, which
// mismatches the compiler's label for a reason unrelated to this case.
export class NamedImpl { go(): number { return 2; } }
