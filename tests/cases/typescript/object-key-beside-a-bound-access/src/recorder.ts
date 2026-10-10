import { EventMeta } from './types';

export class Recorder {
  wrap(meta: EventMeta): string {
    return meta.eventId;
  }
}
