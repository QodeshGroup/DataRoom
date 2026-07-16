// ==========================================================================
// Kilifi Legacy Estates Data Room — Supabase connection settings
// Fill these two values in from Supabase Dashboard → Settings → API
// ==========================================================================
window.SUPABASE_URL = 'https://qhnksapkqrqkczzsjzaq.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_v6xtrOQ0bBAr2Eku-SKaCg_1ecRkfjC';

// Loads the Supabase JS SDK from CDN and creates one shared client
// used by auth-gate.js and interactive.js.
(function () {
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  script.onload = function () {
    window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    document.dispatchEvent(new Event('sb:ready'));
  };
  document.head.appendChild(script);
})();
