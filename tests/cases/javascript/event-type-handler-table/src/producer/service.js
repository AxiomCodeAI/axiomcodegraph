import { TOPICS } from '../pkg/topics.js';

export class DocService {
  constructor(bus) { this.bus = bus; }

  create(doc) {
    this.bus.publish(TOPICS.CREATED, doc);
    return doc;
  }

  archive(doc) {
    this.bus.publish('doc.archived', doc);
  }
}
