export function leaf(): number { return 41; }

export function helper(): number { return leaf() * 2; }

export function entry(): number { return helper() + 1; }
