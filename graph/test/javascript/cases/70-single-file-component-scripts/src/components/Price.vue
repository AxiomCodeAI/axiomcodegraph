<template><span @click="onClick">{{ label }} {{ onlyInMarkup(label) }}</span></template>
<!-- <script>onlyInMarkup(1)</script> -->
<script setup>
import { computed } from 'vue';
import { formatPrice } from '../lib/format.js';
const props = defineProps({ value: Number });
const label = computed(() => formatPrice(props.value));
function onClick() { console.log(label.value); }
</script>
