<script setup>
defineProps({ count: Number });
function widgetLabel() { return "w"; }
</script>
<template><span>{{ widgetLabel() }}</span></template>
