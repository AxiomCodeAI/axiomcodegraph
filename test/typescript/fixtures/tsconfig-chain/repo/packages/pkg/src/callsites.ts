// The package's own source. Nothing here is about the sources — the whole fixture is
// about whether the compiler OPTIONS survive being mirrored. `strict: true` lives only
// in ../../tsconfig.base.json, one directory above what the harness copies.
//
// A call through `.call` is included so the file is representative of what the option
// actually decides: with strictBindCallApply resolved true the compiler answers with
// CallableFunction's declaration, with it false it answers with Function's.
export function plain(a: number, b: string): void {}

export const viaCall = plain.call(null, 1, 'x');
export const viaBind = plain.bind(null, 1);
