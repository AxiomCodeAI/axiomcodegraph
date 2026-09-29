<script>
import Child from "./Child.vue";
function legacyInit() { return 0; }
export default { name: "Legacy", components: { Child }, data() { return { n: legacyInit() }; } };
</script>
<template><i><Child /></i></template>
