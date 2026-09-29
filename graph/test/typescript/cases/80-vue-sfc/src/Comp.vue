<script setup lang="ts">
import { Child, format } from './child';
function sfcHelper(): number { return 1; }
function onSave(value: number): void { void value; }
const total = 3;
</script>

<template>
  <div class="card">
    <Child msg="from sfc" @ping="sfcHelper" />
    <button @click="onSave(total)">{{ format(total) }}</button>
  </div>
</template>

<style scoped>
.card { color: red; }
</style>
