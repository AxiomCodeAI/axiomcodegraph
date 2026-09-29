import { Handler } from "./handlers";

// declared in one module, handed to a container as a class VALUE from another
// (`useClass: Provided` in module.ts): stays in the narrowed fan
export class Provided implements Handler {
  handle(x: string): string { return "p" + x; }
}

// imported by module.ts too, but only ever named there as a TYPE: dropped
export class TypeOnly implements Handler {
  handle(x: string): string { return "t" + x; }
}
