// ==========================================================================
// Kilifi Legacy Estates Data Room — login gate
// Blocks the page behind a full-screen login form until Supabase Auth
// confirms a signed-in team member. Create each team member's account in
// Supabase Dashboard → Authentication → Users → Add user (email + password).
// ==========================================================================
(function () {
  var overlay = null;

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;' +
      'justify-content:center;background:linear-gradient(135deg,#0a0a0f 0%,#1c0f33 55%,#3b1667 100%);';
    overlay.innerHTML =
      '<form id="auth-form" style="width:320px;background:#fff;border-radius:12px;padding:32px 28px;' +
      'box-shadow:0 16px 48px rgba(10,10,15,.25);font-family:Inter,-apple-system,sans-serif;">' +
      '<div style="font-family:Georgia,serif;font-weight:700;font-size:18px;color:#0a0a0f;margin-bottom:4px;">Kilifi Legacy Estates</div>' +
      '<div style="font-size:12px;color:#837e94;margin-bottom:22px;letter-spacing:.03em;text-transform:uppercase;">Team Sign In</div>' +
      '<input id="auth-email" type="email" placeholder="Email" autocomplete="username" required ' +
      'style="width:100%;padding:10px 12px;margin-bottom:10px;border:1px solid #e6e4ec;border-radius:8px;font-size:13.5px;box-sizing:border-box;">' +
      '<input id="auth-password" type="password" placeholder="Password" autocomplete="current-password" required ' +
      'style="width:100%;padding:10px 12px;margin-bottom:14px;border:1px solid #e6e4ec;border-radius:8px;font-size:13.5px;box-sizing:border-box;">' +
      '<button type="submit" style="width:100%;padding:11px;border:none;border-radius:8px;background:#6d28d9;color:#fff;' +
      'font-weight:600;font-size:13.5px;cursor:pointer;">Sign In</button>' +
      '<div id="auth-error" style="color:#c0392b;font-size:12px;margin-top:10px;min-height:16px;"></div>' +
      '</form>';
    document.body.appendChild(overlay);

    document.getElementById('auth-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = document.getElementById('auth-email').value.trim();
      var password = document.getElementById('auth-password').value;
      var errEl = document.getElementById('auth-error');
      errEl.textContent = '';
      var result = await window.sb.auth.signInWithPassword({ email: email, password: password });
      if (result.error) {
        errEl.textContent = result.error.message;
      } else {
        removeOverlay();
        injectLogoutButton();
      }
    });
  }

  function removeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function injectLogoutButton() {
    if (document.getElementById('auth-logout-btn')) return;
    var footer = document.querySelector('.brand-footer');
    if (!footer) return;
    var btn = document.createElement('button');
    btn.id = 'auth-logout-btn';
    btn.textContent = 'Sign out';
    btn.style.cssText =
      'margin-top:8px;background:none;border:1px solid rgba(255,255,255,.2);color:#d3d0dc;' +
      'padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;';
    btn.addEventListener('click', async function () {
      await window.sb.auth.signOut();
      location.reload();
    });
    footer.appendChild(document.createElement('br'));
    footer.appendChild(btn);
  }

  async function checkSession() {
    var { data } = await window.sb.auth.getSession();
    if (data && data.session) {
      injectLogoutButton();
      document.dispatchEvent(new Event('auth:ready'));
    } else {
      buildOverlay();
    }
  }

  document.addEventListener('sb:ready', function () {
    checkSession();
    window.sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_IN' && session) {
        document.dispatchEvent(new Event('auth:ready'));
      }
    });
  });
})();
