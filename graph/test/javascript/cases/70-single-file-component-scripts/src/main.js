// CONTROL: a plain .js module importing a component; unchanged by the component support.
import { createApp } from 'vue';
import Price from './components/Price.vue';
import { slugify } from './lib/format.js';
createApp(Price).mount('#' + slugify('App'));
