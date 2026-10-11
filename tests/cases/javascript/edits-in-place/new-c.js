export class Auth {
  constructor({
    users,
    tokens,
    clock,
  }) {
    this.users = users;
    this.tokens = tokens;
    this.clock = clock;
  }

  check(token) {
    return this.tokens.verify(token);
  }
}
