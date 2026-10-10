import label from './label.js';
function secret() { return 42; }
export default label(secret);
