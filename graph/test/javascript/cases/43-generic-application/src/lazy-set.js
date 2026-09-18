class LazySet { constructor() { this._set = new Set(); } addAll(items) { return items.length; } }
module.exports = LazySet;
