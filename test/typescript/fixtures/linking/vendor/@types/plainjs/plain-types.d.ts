// THE TYPES LIVE IN A DIFFERENT PACKAGE FROM THE CODE. `plainjs` ships no declarations
// at all; the declaration the compiler resolves `shout` to is in @types/plainjs, which
// the client never names. A staging step driven by the client's import specifiers alone
// never reaches this file.
export declare function shout(input: string): string;
export declare class Megaphone {
  amplify(input: string, times: number): string;
}
