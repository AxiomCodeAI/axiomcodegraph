// A container-owned class graph, in the shape Nest and Angular both use. Nothing in
// this file calls getOne, ngOnInit or either constructor: a framework does, by reading
// what the decorators attached. Without a rule that reads the decorator NAME, every
// declaration below is dead code that demonstrably runs.

// Legacy ("experimental") decorator factories, the form Nest and Angular are built on.
// They return void rather than a replacement, so nothing here depends on a decorator
// rebinding its target -- the rules under test read the NAME, never the return value.
function Injectable() { return (_t: Function): void => {}; }
function Controller(_path: string) { return (_t: Function): void => {}; }
function Component(_meta: { selector: string }) { return (_t: Function): void => {}; }
function Get(_path: string) { return (_t: object, _k: string, _d: PropertyDescriptor): void => {}; }
function Post(_path: string) { return (_t: object, _k: string, _d: PropertyDescriptor): void => {}; }

@Injectable()
export class OrderService {
  // reached only through the controller the container injects it into
  find(id: string): string { return id; }
  create(id: string): string { return this.find(id); }
}

@Controller("/orders")
export class OrderController {
  constructor(private readonly svc: OrderService) {}

  @Get(":id")
  getOne(id: string): string { return this.svc.find(id); }

  @Post("/")
  add(id: string): string { return this.svc.create(id); }

  // NOT a route: no decorator, so it must stay off the root set
  helper(id: string): string { return id; }
}

@Component({ selector: "app-orders" })
export class OrdersView {
  // a hook the container calls by name; there is no call site for it anywhere
  ngOnInit(): void { this.refresh(); }
  refresh(): void {}
}

// A PLAIN class, the negative control. It carries no framework decorator, so its
// constructor must NOT be a root and its ngOnInit must NOT be a lifecycle hook even
// though the name matches exactly.
export class NotManaged {
  constructor() {}
  ngOnInit(): void {}
  getOne(): void {}
}
