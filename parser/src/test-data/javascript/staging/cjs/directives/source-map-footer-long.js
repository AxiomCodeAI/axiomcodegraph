// fixture: cjs/directives/source-map-footer-long.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// HALF TWO OF A PAIRED REPRO. See source-map-footer-short.js for the argument.
// This file carries the identical trailing a source-map footer comment line and is
// deliberately larger than the 4,096-byte head window that BUNDLER_PREAMBLES is
// searched within, so the footer is invisible to the classifier and this file is
// PROJECT while its shorter twin is GENERATED_MONOLITH.
//
// The padding below is a real dispatch table rather than filler, so the file is
// a plausible module: a length-sensitive check must not be satisfiable by
// something that only looks like code.

'use strict';

const handlers = Object.create(null);

/**
 * Handler 1. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step01 = function step01(input) {
  const weighted = input.weight * 1;
  return input.id + ':' + weighted;
};

/**
 * Handler 2. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step02 = function step02(input) {
  const weighted = input.weight * 2;
  return input.id + ':' + weighted;
};

/**
 * Handler 3. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step03 = function step03(input) {
  const weighted = input.weight * 3;
  return input.id + ':' + weighted;
};

/**
 * Handler 4. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step04 = function step04(input) {
  const weighted = input.weight * 4;
  return input.id + ':' + weighted;
};

/**
 * Handler 5. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step05 = function step05(input) {
  const weighted = input.weight * 5;
  return input.id + ':' + weighted;
};

/**
 * Handler 6. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step06 = function step06(input) {
  const weighted = input.weight * 6;
  return input.id + ':' + weighted;
};

/**
 * Handler 7. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step07 = function step07(input) {
  const weighted = input.weight * 7;
  return input.id + ':' + weighted;
};

/**
 * Handler 8. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step08 = function step08(input) {
  const weighted = input.weight * 8;
  return input.id + ':' + weighted;
};

/**
 * Handler 9. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step09 = function step09(input) {
  const weighted = input.weight * 9;
  return input.id + ':' + weighted;
};

/**
 * Handler 10. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step10 = function step10(input) {
  const weighted = input.weight * 10;
  return input.id + ':' + weighted;
};

/**
 * Handler 11. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step11 = function step11(input) {
  const weighted = input.weight * 11;
  return input.id + ':' + weighted;
};

/**
 * Handler 12. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step12 = function step12(input) {
  const weighted = input.weight * 12;
  return input.id + ':' + weighted;
};

/**
 * Handler 13. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step13 = function step13(input) {
  const weighted = input.weight * 13;
  return input.id + ':' + weighted;
};

/**
 * Handler 14. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step14 = function step14(input) {
  const weighted = input.weight * 14;
  return input.id + ':' + weighted;
};

/**
 * Handler 15. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step15 = function step15(input) {
  const weighted = input.weight * 15;
  return input.id + ':' + weighted;
};

/**
 * Handler 16. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step16 = function step16(input) {
  const weighted = input.weight * 16;
  return input.id + ':' + weighted;
};

/**
 * Handler 17. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step17 = function step17(input) {
  const weighted = input.weight * 17;
  return input.id + ':' + weighted;
};

/**
 * Handler 18. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step18 = function step18(input) {
  const weighted = input.weight * 18;
  return input.id + ':' + weighted;
};

/**
 * Handler 19. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step19 = function step19(input) {
  const weighted = input.weight * 19;
  return input.id + ':' + weighted;
};

/**
 * Handler 20. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step20 = function step20(input) {
  const weighted = input.weight * 20;
  return input.id + ':' + weighted;
};

/**
 * Handler 21. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step21 = function step21(input) {
  const weighted = input.weight * 21;
  return input.id + ':' + weighted;
};

/**
 * Handler 22. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step22 = function step22(input) {
  const weighted = input.weight * 22;
  return input.id + ':' + weighted;
};

/**
 * Handler 23. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step23 = function step23(input) {
  const weighted = input.weight * 23;
  return input.id + ':' + weighted;
};

/**
 * Handler 24. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step24 = function step24(input) {
  const weighted = input.weight * 24;
  return input.id + ':' + weighted;
};

/**
 * Handler 25. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step25 = function step25(input) {
  const weighted = input.weight * 25;
  return input.id + ':' + weighted;
};

/**
 * Handler 26. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step26 = function step26(input) {
  const weighted = input.weight * 26;
  return input.id + ':' + weighted;
};

/**
 * Handler 27. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step27 = function step27(input) {
  const weighted = input.weight * 27;
  return input.id + ':' + weighted;
};

/**
 * Handler 28. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step28 = function step28(input) {
  const weighted = input.weight * 28;
  return input.id + ':' + weighted;
};

/**
 * Handler 29. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step29 = function step29(input) {
  const weighted = input.weight * 29;
  return input.id + ':' + weighted;
};

/**
 * Handler 30. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step30 = function step30(input) {
  const weighted = input.weight * 30;
  return input.id + ':' + weighted;
};

/**
 * Handler 31. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step31 = function step31(input) {
  const weighted = input.weight * 31;
  return input.id + ':' + weighted;
};

/**
 * Handler 32. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step32 = function step32(input) {
  const weighted = input.weight * 32;
  return input.id + ':' + weighted;
};

/**
 * Handler 33. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step33 = function step33(input) {
  const weighted = input.weight * 33;
  return input.id + ':' + weighted;
};

/**
 * Handler 34. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step34 = function step34(input) {
  const weighted = input.weight * 34;
  return input.id + ':' + weighted;
};

/**
 * Handler 35. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step35 = function step35(input) {
  const weighted = input.weight * 35;
  return input.id + ':' + weighted;
};

/**
 * Handler 36. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step36 = function step36(input) {
  const weighted = input.weight * 36;
  return input.id + ':' + weighted;
};

/**
 * Handler 37. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step37 = function step37(input) {
  const weighted = input.weight * 37;
  return input.id + ':' + weighted;
};

/**
 * Handler 38. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step38 = function step38(input) {
  const weighted = input.weight * 38;
  return input.id + ':' + weighted;
};

/**
 * Handler 39. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step39 = function step39(input) {
  const weighted = input.weight * 39;
  return input.id + ':' + weighted;
};

/**
 * Handler 40. Registered by name so the table is reachable by a computed call.
 *
 * @param {{ id: string, weight: number }} input
 * @returns {string}
 */
handlers.step40 = function step40(input) {
  const weighted = input.weight * 40;
  return input.id + ':' + weighted;
};

function dispatch(name, input) {
  const handler = handlers[name];
  return handler ? handler(input) : null;
}

module.exports = { handlers, dispatch };

//# sourceMappingURL=source-map-footer-long.js.map
