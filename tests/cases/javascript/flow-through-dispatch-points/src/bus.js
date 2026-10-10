export class TopicBus {
  constructor() {
    this.subscribers = new Map();
  }

  subscribe(topic, handler) {
    if (!this.subscribers.has(topic)) this.subscribers.set(topic, []);
    this.subscribers.get(topic).push(handler);
  }

  publish(topic, payload) {
    const envelope = { topic, payload };
    this.deliver(envelope);
    return envelope;
  }

  deliver(envelope) {
    for (const handler of this.subscribers.get(envelope.topic) ?? []) this.runHandler(handler, envelope);
  }

  runHandler(handler, envelope) {
    handler(envelope);
  }
}

export class InvoiceService {
  constructor(bus, store) {
    this.bus = bus;
    this.store = store;
  }

  issue(invoice) {
    this.store.save(invoice);
    this.bus.publish('invoice.issued', invoice);
  }
}

function onInvoiceIssued(envelope) { return envelope.payload; }
function onInvoicePaid(envelope) { return envelope.payload; }
function onInvoiceVoided(envelope) { return envelope.payload; }
function onInvoiceOverdue(envelope) { return envelope.payload; }

export function wireInvoiceHandlers(bus) {
  bus.subscribe('invoice.issued', onInvoiceIssued);
  bus.subscribe('invoice.paid', onInvoicePaid);
  bus.subscribe('invoice.voided', onInvoiceVoided);
  bus.subscribe('invoice.overdue', onInvoiceOverdue);
  return bus;
}

export function createBilling(store) {
  const bus = wireInvoiceHandlers(new TopicBus());
  return new InvoiceService(bus, store);
}
