<script setup>
function childLocal() { return "c"; }
</script>
<template><b>{{ childLocal() }}</b></template>
