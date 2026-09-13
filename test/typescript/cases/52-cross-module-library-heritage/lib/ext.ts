// A library class extending a class declared in ANOTHER library module. The supertype is
// neither declared here nor in the library's global scope -- it is bound by this module's
// own IMPORT -- and that was the one route heritage resolution did not take, so both
// classes below inherited nothing and neither joined the base type's dispatch set.
import { Shape, Rect } from "./core";
export declare class Square extends Rect { side(): number; }
export declare class Circle extends Shape { area(): number; }
