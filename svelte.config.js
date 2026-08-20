import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Pinned because adapter-vercel refuses to infer a runtime from a local
    // Node it does not recognise (v26 here). This is the Vercel runtime, not
    // the local one.
    adapter: adapter({ runtime: 'nodejs22.x' }),
    alias: {
      $lib: 'src/lib',
      $convex: 'convex'
    }
  }
};

export default config;
