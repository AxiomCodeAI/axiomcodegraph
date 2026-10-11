declare module '@nestjs/microservices' {
  export class ClientProxy {
    emit(pattern: unknown, data: unknown): unknown;
    send(pattern: unknown, data: unknown): unknown;
  }
  export enum Transport { KAFKA, RMQ }
  export function EventPattern(pattern: unknown, transport?: unknown): MethodDecorator;
  export function MessagePattern(pattern: unknown, transport?: unknown): MethodDecorator;
}
declare module 'kafkajs' {
  export interface Producer { send(record: { topic: string; messages: unknown[] }): Promise<unknown>; }
  export interface Consumer { subscribe(s: { topic?: string; topics?: string[] }): Promise<void>; run(c: unknown): Promise<void>; }
}
