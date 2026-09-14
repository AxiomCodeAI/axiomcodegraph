// The SAME EXPORTED NAME as @tt/named, with a different parameter type and a different
// return type. Both are imported into one client file. A name-keyed link lands here
// half the time and cannot tell that it did.
export declare function encode(input: number): number;

// Same member name as @tt/named's Sink, on an unrelated class. Member lookup that is
// not anchored to the receiver's resolved type will cross these two.
export declare class Sink {
  write(chunk: number): number;
}
