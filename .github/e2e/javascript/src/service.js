export function leaf() { return 41; }

export function helper() { return leaf() * 2; }

export function entry() { return helper() + 1; }
