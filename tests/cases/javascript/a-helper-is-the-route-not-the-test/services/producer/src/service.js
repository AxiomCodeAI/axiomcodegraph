import { TOPICS } from '@demo/topics';

export class DocService {
  constructor(bus) { this.bus = bus; }

  create(doc) {
    this.bus.publish(TOPICS.CREATED, doc);
    return doc;
  }
}
