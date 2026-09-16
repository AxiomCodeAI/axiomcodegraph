import { W, Item, Model, helper } from "./core.js";
export function main() {
  W.mixin({});
  new W().each();
  new W().mixin();
  W.both();
  new W().both();
  new Item().run();
  new Item().alias();
  new Item().helper();
  helper();
  Model.tag();
  Item.tag();
  new Model().run();
}
