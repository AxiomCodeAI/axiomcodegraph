<script setup>
import { Child, MyBadge } from './child.js';
function sfcHelper() { return 1; }
function onSave(value) { return value; }
const total = 3;
</script>

<template>
  <div>
    <Child msg="from sfc" @ping="sfcHelper" />
    <my-badge v-if="total" />
    <button @click="onSave(total)">{{ sfcHelper() }}</button>
  </div>
</template>
