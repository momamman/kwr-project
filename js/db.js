const SUPABASE_URL = 'https://zqqnoowtzijxxkmfphlk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dOYoMnrnT-lOcb_rI-0Cjg_luLMwTtF';
// Note: We expect the supabase script to be loaded before this.
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.db = db;
