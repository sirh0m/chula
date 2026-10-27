import { createMemoryStore } from './memoryStore.js';
import { createSupabaseStore } from './supabaseStore.js';

export function createStore(config, logger) {
  if (config.supabase.enabled) {
    logger.info('Using Supabase data store', { url: config.supabase.url });
    return createSupabaseStore({ url: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey });
  }
  if (!config.supabase.allowInMemory) {
    throw new Error('Supabase is not configured and ALLOW_IN_MEMORY_STORE is disabled');
  }
  logger.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: using the seeded in-memory store (data resets on restart)');
  return createMemoryStore();
}
