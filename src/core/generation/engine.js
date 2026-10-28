/**
 * Create's generation engine. Batches frozen by another engine (the removed strict
 * compose/validator, `strict-layout-*`) are regenerable history and are dropped on load.
 */
export const ENGINE_VERSION = 'qwen-layout-1';
export const ITEM_STATES = ['succeeded', 'failed', 'cancelled'];
