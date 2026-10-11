import { Articles, helpers, Routes } from './api';

export function run() {
  Articles.all(1);
  Articles.get('x');
  Articles.del('x');
  Articles.tags.list();
  helpers.titleCase('a');
  helpers.alias('b');
  Routes.home();
}
