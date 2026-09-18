// #644: a browser shim nothing imports. Under checkJs the expando assignment declares a
// program-wide `Buffer`, and the compiler names this class for `Buffer.isBuffer` in Node
// code that never loads this file; the platform Buffer is what runs.
class Buffer { static isBuffer() { return false; } }
globalThis.Buffer = Buffer;
export {};
