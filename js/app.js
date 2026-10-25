import { db } from './db.js';

const durum = document.querySelector('#durum');

// Bağlantı testi: Auth ayarları okunabiliyorsa URL ve anahtar doğrudur
async function baglantiTest() {
  try {
    const { error } = await db().auth.getSession();
    if (error) throw error;
    const r = await fetch(`${db().supabaseUrl}/auth/v1/settings`, { headers: { apikey: db().supabaseKey } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    durum.textContent = 'Supabase bağlantısı başarılı ✓';
    durum.className = 'ok';
  } catch (e) {
    durum.textContent = `Bağlantı hatası: ${e.message}`;
    durum.className = 'hata';
  }
}

baglantiTest();
