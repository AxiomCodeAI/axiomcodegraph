'use strict';

class Session {
  constructor() {
    this.token = null;
  }
  refresh() {
    this.token = 'x';
  }
}

// a module-level function: it has no owner, which is what put its reads in no rule at all
function describeSession(s) {
  return `token=${s.token}`;
}

module.exports = { Session, describeSession };
