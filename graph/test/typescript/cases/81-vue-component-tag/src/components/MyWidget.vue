<script setup lang="ts">
defineProps<{ count: number }>();
function widgetLabel(): string { return 'w'; }
</script>
<template><span>{{ widgetLabel() }}</span></template>
