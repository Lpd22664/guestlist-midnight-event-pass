import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import inject from '@rollup/plugin-inject';

/** Native modern Chrome supports WASM top-level await. Do not import Node adapters. */
export default defineConfig({
  plugins: [wasm()],
  resolve: {
    conditions: ['browser', 'module', 'import'],
    alias: { assert: 'assert/' },
    dedupe: ['@midnight-ntwrk/compact-runtime', '@midnight-ntwrk/onchain-runtime-v3', '@midnight-ntwrk/ledger-v8', '@midnight-ntwrk/midnight-js-network-id'],
  },
  optimizeDeps: { exclude: ['@midnight-ntwrk/ledger-v8', '@midnight-ntwrk/onchain-runtime-v3'] },
  build: {
    rollupOptions: { plugins: [inject({ Buffer: ['buffer', 'Buffer'], process: ['process/browser.js', 'default'] })] },
    target: 'esnext', outDir: 'bundle', emptyOutDir: true, minify: false,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'event-pass' },
  },
});
