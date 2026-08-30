export interface Spec {
  check(): boolean;
}
export class Impl implements Spec {
  check(): boolean {
    return true;
  }
}
export type Alias = Spec;
