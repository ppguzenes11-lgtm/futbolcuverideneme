import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

let client;
export function db() {
  client ||= window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}
