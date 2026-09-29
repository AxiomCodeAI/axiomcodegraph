<template><div>{{ slug }}</div></template>
<script>
import { slugify } from '../lib/format.js';
export default {
  props: ['title'],
  computed: { slug() { return slugify(this.title); } },
  methods: { refresh() { this.$emit('refresh', slugify(this.title)); } },
};
</script>
<style scoped>div { color: red; }</style>
