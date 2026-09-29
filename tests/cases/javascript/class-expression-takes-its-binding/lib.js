// a class expression in a static field: its members are the nested class's
class Outer {
  static Inner = class {
    ping() {
      return 1;
    }
  };
}

// a class expression bound to a variable
const Plain = class {
  go() {
    return 2;
  }
};

// a class expression assigned to a property of an object
const registry = {};
registry.Widget = class {
  render() {
    return 3;
  }
};

// CONTROL: a named class expression keeps its own name
const Alias = class Real {
  hi() {
    return 4;
  }
};

// CONTROL: a function expression bound to a variable is still named by it
const helper = function () {
  return 5;
};

module.exports = { Outer, Plain, registry, Alias, helper };
