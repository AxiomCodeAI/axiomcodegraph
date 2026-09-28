import { pickOther, PickedInner } from "./parts";

// CONTROL: a default-exported call that is NOT a wrapper renders what it returns.
export default pickOther(PickedInner);
