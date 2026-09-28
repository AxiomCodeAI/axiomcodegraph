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

// Dependency injection. The container, not the code, hands AuditService its
// OrderService and OrderController its OrderService: both slots are keyed by the class.
// The Clock slot is keyed by a TOKEN, so its declared type (an interface nobody
// provides) says nothing about what arrives, and it must not be reported as a slot.
function Inject(_token: string) { return (_t: object, _k: string | symbol | undefined, _i: number): void => {}; }
interface Clock { now(): number; }

@Injectable()
export class AuditService {
  constructor(private readonly orders: OrderService, @Inject("CLOCK") private readonly clock: Clock) {}
  record(id: string): string { return this.orders.find(id) + this.clock.now(); }
}

// A slot on a container-owned class that no provider answers: reported, never dropped.
export class Unprovided { ping(): void {} }
@Controller("/audit")
export class AuditController {
  constructor(private readonly audit: AuditService, private readonly extra: Unprovided) {}
  @Get(":id")
  one(id: string): string { this.extra.ping(); return this.audit.record(id); }
}

// The DI control: the same constructor parameter on a class no decorator marks. Its
// caller is in the code (`new HandBuilt(svc)`), so it is NOT an injection point.
export class HandBuilt {
  constructor(private readonly svc: OrderService) {}
  run(): string { return this.svc.find("x"); }
}

// A PLAIN class, the negative control. It carries no framework decorator, so its
// constructor must NOT be a root and its ngOnInit must NOT be a lifecycle hook even
// though the name matches exactly.
export class NotManaged {
  constructor() {}
  ngOnInit(): void {}
  getOne(): void {}
}
