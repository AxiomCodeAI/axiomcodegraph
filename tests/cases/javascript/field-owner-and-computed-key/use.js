const { Store, Queue, Counter, Legacy, settings } = require('./lib');

function run() {
  const s = new Store();
  s.insert(1);
  const q = new Queue();
  q.push(2);
  const c = new Counter();
  for (const n of c) console.log(n, c instanceof Counter);
  const l = new Legacy('a');
  return l.describe() + settings.debug;
}

module.exports = { run };
