export class Session {
  constructor(id) { this.id = id; }
  close() { this.closed = true; }
}

export class FileHandle {
  close() { this.fd = -1; }
}

export function shutdown(anything) {
  anything.close();
}

export function run() {
  shutdown(new Session(1));
  shutdown(new FileHandle());
}
