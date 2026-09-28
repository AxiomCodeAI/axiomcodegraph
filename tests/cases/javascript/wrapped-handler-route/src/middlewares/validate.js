const validate = (schema) => (req, res, next) => (schema ? next() : next());
module.exports = validate;
