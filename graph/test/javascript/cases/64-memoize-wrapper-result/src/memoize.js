// A memoizing wrapper: its closure returns what calling its parameter returned.
const memoize = fn => {
  let cache = false;
  let result = undefined;
  return () => {
    if (cache) return result;
    result = fn();
    cache = true;
    fn = undefined;
    return result;
  };
};
module.exports = memoize;
