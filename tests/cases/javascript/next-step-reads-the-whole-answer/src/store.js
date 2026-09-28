class Store {
    tally() { return 1; }
    spare() { return 2; }
    counted() { return 3; }
}

function use(s) { return s.tally(); }

function lonely() { return 1; }

function onEvent(e) { return e; }
module.exports = { Store, use, lonely, onEvent };
