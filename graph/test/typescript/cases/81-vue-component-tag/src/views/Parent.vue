<script setup lang="ts">
import Child from '../components/Child.vue';
import MyWidget from '../components/MyWidget.vue';
import Legacy from '../components/Legacy.vue';
import { Badge } from '../components/badge';
import Store from '../components/store';
</script>
<template>
  <Child />
  <my-widget :count="1" />
  <Legacy></Legacy>
  <Badge />
  <Store />
  <div>{{ Store }}</div>
</template>
