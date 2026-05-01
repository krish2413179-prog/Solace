/**
 * cloud_swarm.ts — Memory-efficient Render deployment
 *
 * Runs broker inline + spawns workers as child processes using
 * pre-compiled JS (node dist/) instead of tsx — much lower memory.
 *
 * Build step: npm run build (tsc)
 * Start: node dist/cloud_swarm.js
 */
export {};
