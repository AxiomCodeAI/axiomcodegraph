export class Session {
  constructor(id) { this.id = id; }
  close() { this.closed = true; }
}

export function shutdown(anything) {
  anything.close();
}

export function run() {
  const s = new Session(1);
  shutdown(s);
}
