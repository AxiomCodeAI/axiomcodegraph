// Same shape as Pub, but nothing that holds a Stranger ever imports pub.ts: no Stranger
// can be handed to code typed by Pub.
export class Stranger {
  publish(e: { id: string }): void {}
}

export const stranger = new Stranger();
