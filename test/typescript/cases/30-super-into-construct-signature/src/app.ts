import { LibErr, LibClass } from "../lib/base";

export class AppError extends LibErr {
  constructor(m: string) {
    super(m);
  }
  describe(): string {
    return super.describe();
  }
}

// CONTROL: super(...) into an ordinary class must keep resolving.
export class AppFromClass extends LibClass {
  constructor(m: string) {
    super(m);
  }
  describe(): string {
    return super.describe();
  }
}
