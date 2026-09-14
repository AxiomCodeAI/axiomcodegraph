'use strict';
const dep = require('dep');
const { Client, helper } = require('dep');
const c = dep({});
c.get('/x');
new Client().request('GET', '/y');
helper();
dep.helper();
