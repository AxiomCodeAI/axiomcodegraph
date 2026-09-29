<template><b>{{ n }}</b></template>
<script setup lang="ts">
import { onlyInMarkup } from '../lib/format.js';
const n: number = onlyInMarkup(1);
</script>
