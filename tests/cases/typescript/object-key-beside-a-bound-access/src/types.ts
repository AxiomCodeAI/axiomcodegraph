export interface EventMeta {
  readonly eventId: string;
  readonly name: string;
}

export interface PublishOptions {
  readonly eventId?: string;
}
