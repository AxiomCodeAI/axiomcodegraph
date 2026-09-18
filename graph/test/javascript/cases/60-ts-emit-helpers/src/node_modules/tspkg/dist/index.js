"use strict";
// What `tsc` emits for `export * from './api'` targeting CommonJS: the barrel binds no
// name of its own, every export arrives through the helper, and that is the construct
// this case exists for (#717).
var __createBinding = (this && this.__createBinding) || function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function () { return m[k]; } });
};
var __exportStar = (this && this.__exportStar) || function (m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./api"), exports);
