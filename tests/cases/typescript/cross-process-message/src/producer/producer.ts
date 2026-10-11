import { EventEmitter } from 'events';
import type { ClientProxy } from '@nestjs/microservices';
import type { Producer } from 'kafkajs';
import { CMD, COMMANDS, TOPICS } from '../shared/topics';

export class ItemPublisher {
  constructor(private readonly client: ClientProxy) {}

  // emit on a const-object member: joins the handler that spells the same member
  announce(id: string) { return this.client.emit(TOPICS.created, { id }); }

  // send on a plain const: joins the request/reply handler
  place(id: string) { return this.client.send(CMD, { id }); }

  // a key nothing here handles: an unserved send
  shout() { return this.client.emit('nobody.listens', {}); }
}

export class CommandClient {
  constructor(private readonly proxy: ClientProxy) {}

  // the key is the wrapper's argument: the send joins from here
  cancel(id: string) { return this.dispatch(COMMANDS.cancel, { id }); }

  private dispatch(pattern: string, body: unknown) { return this.proxy.send(pattern, body); }
}

export class RawProducer {
  constructor(private readonly producer: Producer) {}

  // kafkajs: the topic is a property of the record
  removed(id: string) { return this.producer.send({ topic: TOPICS.removed, messages: [{ value: id }] }); }
}

// CONTROL: a Node event emitter's emit is not a broker send, however its key reads
export class LocalBus {
  private readonly emitter = new EventEmitter();
  fire() { this.emitter.emit(TOPICS.created, {}); }
}
