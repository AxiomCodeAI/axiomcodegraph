<script setup>
import Child from "../components/Child.vue";
import MyWidget from "../components/MyWidget.vue";
import Legacy from "../components/Legacy.vue";
import Defined from "../components/Defined.vue";
import { Badge } from "../components/badge.js";
import Store from "../components/store.js";
import { defineComponent } from "vue";
const Local = defineComponent({ setup() { return localSetup(); } });
function localSetup() { return 1; }
function fmt(x) { return String(x); }
</script>
<template>
  <div>
    <Child />
    <my-widget :count="1" />
    <Legacy></Legacy>
    <Defined />
    <Local />
    <Badge />
    <Store />
    <span>{{ fmt(Store) }}</span>
  </div>
</template>
