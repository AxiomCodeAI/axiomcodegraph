export interface Contract {
  verify(): boolean;
}
export class Verifier implements Contract {
  verify(): boolean {
    return true;
  }
}
