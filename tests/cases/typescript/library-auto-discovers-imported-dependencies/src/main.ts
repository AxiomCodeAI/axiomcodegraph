import { Greeter } from "greeter";

export function welcome(name: string): string {
  return new Greeter().hello(name).shout();
}
