class Repo { append(x: number): number { return x; } }
class Other { append(x: number): number { return x; } }
interface Ctx { repo: Repo }

// A declared `this` parameter is what `this` is inside the function, whoever binds it.
function onEvent(this: Ctx, e: number) { return this.repo.append(e); }
function onShape(this: { other: Other }, e: number) { return this.other.append(e); }
const h = onEvent.bind({ repo: new Repo() });
const s = onShape.bind({ other: new Other() });

// controls: an untyped `this` stays unknown; a class member's `this` is still its class
function onUntyped(this: any, e: number) { return this.repo.append(e); }
class Owner {
  repo = new Repo();
  run(e: number) { return this.repo.append(e); }
}
export { h, s, onUntyped, Owner };
