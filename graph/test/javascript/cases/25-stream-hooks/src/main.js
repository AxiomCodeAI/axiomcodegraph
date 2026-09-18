'use strict';
const { Out, Src, Up, Both, SubOut, Plain } = require('./streams');
function main() {
  const o = new Out(); o.write('x'); o.end(); o.destroy();
  new Src().resume();
  new Up().write('y'); new Up().end();
  const b = new Both(); b.write('z'); b.resume();
  new SubOut().write('w');
  new Plain().write();
}
main();
