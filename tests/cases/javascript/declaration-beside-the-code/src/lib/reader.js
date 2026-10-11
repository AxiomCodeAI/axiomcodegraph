class Reader {
  readAll(argv) { return this.skipBlank(argv); }
  skipBlank(argv) { return argv.length; }
}
exports.Reader = Reader;
