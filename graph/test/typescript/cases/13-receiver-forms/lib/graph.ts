export class Vertex {
  touch(): string {
    return "t";
  }
}
export class Graph {
  readonly root = new Vertex();
  readonly all: Vertex[] = [];
  find(): Vertex {
    return new Vertex();
  }
}
