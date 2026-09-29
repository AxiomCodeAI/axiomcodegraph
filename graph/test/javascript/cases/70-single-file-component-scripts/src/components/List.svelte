<script>
  import { onMount } from 'svelte';
  import { fetchProducts, formatPrice, onlyInMarkup } from '../lib/format.js';
  let items = [];
  onMount(async () => { items = await fetchProducts(); });
  function show(p) { return formatPrice(p.price); }
</script>
{#each items as p}<li>{show(p)} {onlyInMarkup(p)}</li>{/each}
