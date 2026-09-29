declare function debounce<T extends (...a: any[]) => any>(fn: T): T;

export function audit(): number { return 1; }

export class Svc {
  handler = () => { return audit(); };
  throttled = debounce(() => audit());
  label = 'svc';

  run(): number { return this.handler(); }
  later(): number { return this.throttled(); }
  name(): string { return this.label; }

  wide:
    Fn =
    () => audit();
  go(): number { return this.wide(); }
}

export type Fn = () => number;

export const standalone = () => audit();
