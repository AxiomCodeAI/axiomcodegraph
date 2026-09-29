function normalize(s) {
  return String(s).trim().toLowerCase();
}

function shout(s) {
  return normalize(s).toUpperCase() + '!';
}

module.exports = { normalize, shout };
