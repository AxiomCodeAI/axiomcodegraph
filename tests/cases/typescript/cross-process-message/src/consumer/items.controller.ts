import { EventPattern, MessagePattern, Transport } from '@nestjs/microservices';
import type { Consumer } from 'kafkajs';
import { CMD, COMMANDS, TOPICS } from '@acme/shared';

export class ItemsController {
  @EventPattern(TOPICS.created, Transport.KAFKA)
  onCreated(event: unknown) { return event; }

  @MessagePattern(CMD, Transport.RMQ)
  placeItem(command: unknown) { return command; }

  @MessagePattern(COMMANDS.cancel)
  cancelItem(command: unknown) { return command; }

  // no sender here: an unsent handler
  @EventPattern('other.topic')
  unused(event: unknown) { return event; }
}

export async function listenRemovals(consumer: Consumer) {
  await consumer.subscribe({ topic: TOPICS.removed });
  await consumer.run({ eachMessage: async () => undefined });
}
