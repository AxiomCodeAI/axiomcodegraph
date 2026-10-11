'use strict';
// A model made by an ORM factory, `connection.model(name, schema)`, is a class the
// package builds at runtime from the schema: its statics are the functions written
// onto `schema.statics` (or handed to `schema.static(...)`), and a document it
// constructs has the schema's methods. The package is not installed, so nothing in
// the tree declares the model; the schema argument is what carries its members.
const mongoose = require('mongoose');
const { Schema } = mongoose;

const docSchema = new Schema({ title: String });
docSchema.statics.findLive = function () { return this.find({}); };
docSchema.static('claim', function () { return this.findLive(); });
docSchema.static({ purge() { return 0; } });
docSchema.methods.toRecord = function () { return this.title; };
docSchema.method('touch', function () { return this.toRecord(); });

// The options form, on the package's namespace.
const jobSchema = new mongoose.Schema({}, { statics: { due() { return 1; } } });

// Control: a schema-like object from a package that is not modelled stays unknown.
const { Schema: OtherSchema } = require('other-orm');
const otherSchema = new OtherSchema({});
otherSchema.statics.findLive = function () { return 2; };

function registerModels(connection) {
  return {
    Doc: connection.models.Doc || connection.model('Doc', docSchema),
    Job: mongoose.model('Job', jobSchema),
    Other: connection.model('Other', otherSchema),
  };
}
module.exports = { registerModels };
