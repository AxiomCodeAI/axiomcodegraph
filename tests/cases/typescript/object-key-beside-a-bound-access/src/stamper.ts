import { PublishOptions } from './types';

export class Stamper {
  stamp(options: PublishOptions): string {
    return options.eventId ?? 'none';
  }
}
