// The declarations live in the case's LIBRARY, parsed separately and handed to the engine
// with --library, exactly as a real dependency is. #241's targets are all in
// lib.dom.d.ts, so the client/library boundary is part of the shape.
export interface WidgetMap { video: VideoWidget; source: SourceWidget; }
export interface BaseWidget { attach(name: string): void; }
export interface VideoWidget extends BaseWidget { attach(name: string): void; play(): void; }
export interface SourceWidget extends BaseWidget { attach(name: string): void; reload(): void; }
export interface Factory {
  create<K extends keyof WidgetMap>(kind: K): WidgetMap[K];
  create(kind: string): BaseWidget;
}
