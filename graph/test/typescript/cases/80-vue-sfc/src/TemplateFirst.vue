<template>
  <section>
    <my-badge v-if="shown()" />
    <input @input="
      onInput()
    " />
  </section>
</template>

<script setup lang="ts">
import { MyBadge } from './child';
function shown(): boolean { return true; }
function onInput(): void {}
</script>
