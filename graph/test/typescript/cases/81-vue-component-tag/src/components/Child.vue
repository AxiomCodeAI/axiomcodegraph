<script setup lang="ts">
function childLocal(): string { return 'c'; }
</script>
<template><b>{{ childLocal() }}</b></template>
