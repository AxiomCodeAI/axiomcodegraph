module.exports = function upper(C) {
  const proto = C.prototype
  const old = proto.parse
  proto.parse = function (v) {
    return old.call(this, v).toUpperCase()
  }
}
