import * as K from './k';

export function oneViaNamespace() {
  return K.ROUTES.one;
}

export function lateKey() {
  return K.bag.late;
}
