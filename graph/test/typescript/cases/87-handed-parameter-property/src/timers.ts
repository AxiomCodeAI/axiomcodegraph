// A function handed to a constructor lands in a parameter PROPERTY. The constructor
// body never reads the parameter; a method of the class runs it through the field.

export class Watchdog {
  constructor(private readonly onTimeout: () => void, private readonly label: string) {}

  expire(): string {
    this.onTimeout();
    return this.label;
  }
}

// The field is read and handed on to a timer, not invoked on the spot.
export class Ticker {
  private handle: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onTick: () => void, private readonly ms: number) {}

  start(): void {
    clearTimeout(this.handle);
    this.handle = setTimeout(this.onTick, this.ms);
  }
}

// Control: the parameter property is never read, so nothing the class does can run it.
export class Silent {
  constructor(private readonly onDone: () => void) {}

  name(): string {
    return "silent";
  }
}

// Control: a plain constructor parameter that the body never reads.
export class Ignores {
  constructor(_onDone: () => void) {}
}
