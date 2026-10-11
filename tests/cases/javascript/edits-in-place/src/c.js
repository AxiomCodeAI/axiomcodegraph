export class Auth {
  constructor({
    users,
    jwt,
    clock,
  }) {
    this.users = users;
    this.jwt = jwt;
    this.clock = clock;
  }

  check(token) {
    return this.jwt.verify(token);
  }
}
