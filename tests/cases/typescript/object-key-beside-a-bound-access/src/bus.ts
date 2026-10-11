import { EventMeta, PublishOptions } from './types';

export class Bus {
  publish(name: string, options: PublishOptions = {}): EventMeta {
    const meta: EventMeta = { eventId: options.eventId ?? name, name };
    return meta;
  }
}
