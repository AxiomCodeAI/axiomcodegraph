const { Greeter } = require("greeter");

function welcome(name) {
  return new Greeter().hello(name).shout();
}

module.exports = { welcome };
