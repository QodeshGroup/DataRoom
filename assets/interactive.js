// ==========================================================================
// Kilifi Legacy Estates Data Room — live checklist, uploads & progress
// Requires: supabase-config.js + auth-gate.js loaded first, and the
// "sb:ready" / "auth:ready" events they fire.
// Works on: any sections/*.html page (reads body[data-section]) and on
// readiness-dashboard.html (matches workstream cards by heading text).
// ==========================================================================
(function () {
  var SECTION_SLUG = document.body.hasAttribute('data-section')
    ? 'sec-' + document.body.getAttribute('data-section')
    : null;

  var WORKSTREAM_LABELS = {
    'Land Acquisition & Title': 'ws-land-acquisition',
    'Zoning & Entitlements': 'ws-zoning',
    'Utility Confirmations': 'ws-utilities',
    'Permitting & Government Approvals': 'ws-permitting',
    'Engineering & Infrastructure Design': 'ws-engineering',
    'Legal Documentation': 'ws-legal',
    'Financing Readiness': 'ws-financing'
  };

  var STATUS_META = {
    not_started: { label: 'Not Started', pill: 'status-notstarted' },
    pending:     { label: 'Pending',     pill: 'status-pending' },
    approved:    { label: 'Approved',    pill: 'status-approved' },
    at_risk:     { label: 'At Risk',     pill: 'status-atrisk' }
  };

  var CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>';
  var CURRENT_USER_EMAIL = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pctFor(items) {
    var total = 0, done = 0;
    items.forEach(function (it) {
      total += Number(it.weight);
      if (it.status === 'approved') done += Number(it.weight);
    });
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  function barClassFor(p) { return p >= 70 ? 'green' : (p >= 40 ? 'amber' : 'red'); }
  function pillClassFor(p) { return p >= 70 ? 'status-approved' : (p >= 40 ? 'status-pending' : 'status-atrisk'); }

  // ---------- data access ----------
  async function fetchChecklist(slug) {
    var res = await window.sb.from('checklist_items').select('*').eq('slug', slug).order('sort_order');
    if (res.error) { console.error(res.error); return []; }
    return res.data || [];
  }

  async function fetchDocuments(slug) {
    var res = await window.sb.from('documents').select('*').eq('slug', slug).order('uploaded_at', { ascending: false });
    if (res.error) { console.error(res.error); return []; }
    return res.data || [];
  }

  async function updateChecklistStatus(id, status) {
    await window.sb.from('checklist_items').update({
      status: status, updated_by: CURRENT_USER_EMAIL, updated_at: new Date().toISOString()
    }).eq('id', id);
  }

  async function uploadFile(slug, file, checklistItemId) {
    var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    var path = slug + '/' + Date.now() + '-' + safeName;
    var up = await window.sb.storage.from('dataroom-files').upload(path, file);
    if (up.error) { alert('Upload failed: ' + up.error.message); return false; }
    await window.sb.from('documents').insert({
      slug: slug, checklist_item_id: checklistItemId || null,
      file_name: file.name, storage_path: path, size_bytes: file.size, uploaded_by: CURRENT_USER_EMAIL
    });
    if (checklistItemId) { await updateChecklistStatus(checklistItemId, 'pending'); }
    return true;
  }

  async function downloadDoc(doc) {
    var res = await window.sb.storage.from('dataroom-files').createSignedUrl(doc.storage_path, 60);
    if (!res.error) window.open(res.data.signedUrl, '_blank');
  }

  async function deleteDoc(doc, slug) {
    if (!confirm('Delete "' + doc.file_name + '"?')) return;
    await window.sb.storage.from('dataroom-files').remove([doc.storage_path]);
    await window.sb.from('documents').delete().eq('id', doc.id);
    await refreshSection(slug);
  }

  // ---------- checklist row builder (shared by section pages + dashboard) ----------
  function checklistRow(item, onChange) {
    var row = document.createElement('div');
    row.className = 'check-item' + (item.status === 'approved' ? ' done' : '');
    row.style.padding = '10px 14px';
    row.innerHTML =
      '<div class="box" style="width:16px;height:16px;">' + (item.status === 'approved' ? CHECK_SVG : '') + '</div>' +
      '<div class="info"><div class="title" style="font-size:13px;">' + escapeHtml(item.label) + '</div>' +
      (item.requires_document ? '<div class="meta">Requires document upload</div>' : '') +
      '</div>' +
      '<div class="right">' +
      '<select class="status-select" style="font-size:10.5px;padding:4px 6px;border-radius:6px;border:1px solid var(--gray-200,#e6e4ec);">' +
      Object.keys(STATUS_META).map(function (k) {
        return '<option value="' + k + '"' + (k === item.status ? ' selected' : '') + '>' + STATUS_META[k].label + '</option>';
      }).join('') +
      '</select>' +
      (item.owner ? '<div class="agency" style="min-width:130px;">' + escapeHtml(item.owner) + '</div>' : '') +
      '</div>';
    row.querySelector('.status-select').addEventListener('change', function (e) {
      updateChecklistStatus(item.id, e.target.value).then(onChange);
    });
    return row;
  }

  // ---------- section page rendering ----------
  function ensureChecklistBlock() {
    var existing = document.getElementById('live-checklist-block');
    if (existing) return existing;
    var uploadsHeading = Array.prototype.find.call(
      document.querySelectorAll('.section-block h2'),
      function (h2) { return h2.textContent.indexOf('Team Uploads') !== -1; }
    );
    var block = document.createElement('div');
    block.className = 'section-block';
    block.id = 'live-checklist-block';
    block.innerHTML =
      '<h2><span class="icon-badge">' + CHECK_SVG + '</span>Diligence Checklist</h2>' +
      '<p class="intro">Live status, synced for the whole team. Changing a status updates this section\'s progress immediately.</p>' +
      '<div class="card"><div class="checklist" id="live-checklist-list"></div></div>';
    if (uploadsHeading) {
      uploadsHeading.closest('.section-block').before(block);
    } else {
      document.querySelector('.content').appendChild(block);
    }
    return block;
  }

  function renderChecklistList(items) {
    ensureChecklistBlock();
    var list = document.getElementById('live-checklist-list');
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<p style="font-size:13px;color:var(--gray-500,#837e94);">No checklist items yet — add rows to <code>checklist_items</code> for this slug in Supabase.</p>';
      return;
    }
    items.forEach(function (item) {
      list.appendChild(checklistRow(item, function () { refreshSection(SECTION_SLUG); }));
    });
  }

  function ensureUploadsCard() {
    var uploadsHeading = Array.prototype.find.call(
      document.querySelectorAll('.section-block h2'),
      function (h2) { return h2.textContent.indexOf('Team Uploads') !== -1; }
    );
    if (!uploadsHeading) return null;
    return uploadsHeading.closest('.section-block').querySelector('.card');
  }

  function renderUploadsCard(items, docs) {
    var card = ensureUploadsCard();
    if (!card) return;
    var itemOptions = items.map(function (it) {
      return '<option value="' + it.id + '">' + escapeHtml(it.label) + '</option>';
    }).join('');
    var docRows = docs.map(function (d) {
      return '<div class="doc-chip" style="cursor:default;">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>' +
        '<span style="cursor:pointer;text-decoration:underline;" data-download="' + d.id + '">' + escapeHtml(d.file_name) + '</span>' +
        '<span style="color:var(--gray-500,#837e94);">· ' + escapeHtml(d.uploaded_by || '') + '</span>' +
        '<span data-delete="' + d.id + '" style="cursor:pointer;color:var(--red,#c0392b);">✕</span>' +
        '</div>';
    }).join('');
    card.innerHTML =
      '<div class="td-title">Upload a document</div>' +
      '<div class="td-hint" style="margin-bottom:12px;">Files are stored privately in Supabase and only visible to signed-in team members.</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">' +
      '<input type="file" id="live-upload-input" style="font-size:12.5px;">' +
      (items.length ? '<select id="live-upload-item" style="font-size:12.5px;padding:6px 8px;border-radius:6px;border:1px solid var(--gray-200,#e6e4ec);"><option value="">(general — not tied to a checklist item)</option>' + itemOptions + '</select>' : '') +
      '<button id="live-upload-btn" class="btn-purple">Upload</button>' +
      '</div>' +
      '<div class="td-title" style="margin-bottom:8px;">Documents on file</div>' +
      '<div class="doc-list">' + (docRows || '<span style="font-size:12.5px;color:var(--gray-500,#837e94);">None uploaded yet.</span>') + '</div>';

    card.querySelector('#live-upload-btn').addEventListener('click', async function () {
      var input = document.getElementById('live-upload-input');
      var select = document.getElementById('live-upload-item');
      if (!input.files.length) { alert('Choose a file first.'); return; }
      var btn = this;
      btn.textContent = 'Uploading…';
      btn.classList.add('disabled');
      var ok = await uploadFile(SECTION_SLUG, input.files[0], select && select.value ? select.value : null);
      if (ok) refreshSection(SECTION_SLUG);
      btn.textContent = 'Upload';
      btn.classList.remove('disabled');
    });
    card.querySelectorAll('[data-download]').forEach(function (el) {
      el.addEventListener('click', function () {
        var doc = docs.find(function (d) { return String(d.id) === el.getAttribute('data-download'); });
        if (doc) downloadDoc(doc);
      });
    });
    card.querySelectorAll('[data-delete]').forEach(function (el) {
      el.addEventListener('click', function () {
        var doc = docs.find(function (d) { return String(d.id) === el.getAttribute('data-delete'); });
        if (doc) deleteDoc(doc, SECTION_SLUG);
      });
    });
  }

  function updateHeroProgress(p) {
    var hero = document.querySelector('.hero-content');
    if (!hero) return;
    var pill = hero.querySelector('.status-pill');
    if (pill) {
      pill.className = 'status-pill ' + pillClassFor(p);
      var label = p >= 70 ? 'On Track' : (p >= 40 ? 'In Progress' : 'Early Stage');
      pill.innerHTML = '<span class="dot"></span>' + label + ' · ' + p + '%';
    }
    var bar = document.getElementById('live-hero-progress');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'live-hero-progress';
      bar.style.cssText = 'margin-top:12px;max-width:340px;';
      bar.innerHTML = '<div class="progress-wrap"><div class="progress-track"><div class="progress-fill" data-width="0"></div></div><div class="progress-pct"></div></div>';
      var pillWrap = pill ? pill.parentElement : null;
      if (pillWrap) pillWrap.after(bar); else hero.appendChild(bar);
    }
    var fill = bar.querySelector('.progress-fill');
    fill.className = 'progress-fill ' + barClassFor(p);
    fill.style.width = p + '%';
    bar.querySelector('.progress-pct').textContent = p + '%';
  }

  async function refreshSection(slug) {
    var items = await fetchChecklist(slug);
    var docs = await fetchDocuments(slug);
    var p = pctFor(items);
    updateHeroProgress(p);
    renderChecklistList(items);
    renderUploadsCard(items, docs);
  }

  // ---------- readiness dashboard rendering ----------
  function findWorkstreamCards() {
    var map = {};
    document.querySelectorAll('.card').forEach(function (card) {
      var h3 = card.querySelector('h3');
      if (!h3) return;
      var slug = WORKSTREAM_LABELS[h3.textContent.trim()];
      if (slug) map[slug] = card;
    });
    return map;
  }

  function updateWorkstreamCard(card, items, p) {
    var pill = card.querySelector('h3').parentElement.querySelector('.status-pill');
    if (pill) {
      pill.className = 'status-pill ' + pillClassFor(p);
      var label = p >= 70 ? 'On Track' : (p >= 40 ? 'In Progress' : 'Early Stage');
      pill.innerHTML = '<span class="dot"></span>' + label;
    }
    var fill = card.querySelector('.progress-fill');
    if (fill) { fill.className = 'progress-fill ' + barClassFor(p); fill.style.width = p + '%'; }
    var pctEl = card.querySelector('.progress-pct');
    if (pctEl) pctEl.textContent = p + '%';
    var checklistContainer = card.querySelector('.progress-wrap').nextElementSibling;
    if (checklistContainer) {
      checklistContainer.innerHTML = '';
      items.forEach(function (item) {
        checklistContainer.appendChild(checklistRow(item, function () { refreshDashboard(); }));
      });
    }
  }

  function updateOverallRing(overall) {
    var ring = document.querySelector('.ring-fill');
    if (ring) {
      var r = parseFloat(ring.getAttribute('r'));
      var circumference = 2 * Math.PI * r;
      ring.setAttribute('data-pct', overall);
      ring.style.strokeDasharray = circumference;
      ring.style.strokeDashoffset = circumference * (1 - overall / 100);
      var textEl = ring.parentElement.querySelector('text');
      if (textEl) textEl.textContent = overall + '%';
    }
    var heroPill = document.querySelector('.hero-content .status-pill');
    if (heroPill) heroPill.innerHTML = '<span class="dot"></span>' + overall + '% Overall Complete';
  }

  async function refreshDashboard() {
    var map = findWorkstreamCards();
    var pcts = [];
    for (var slug in map) {
      var items = await fetchChecklist(slug);
      var p = pctFor(items);
      pcts.push(p);
      updateWorkstreamCard(map[slug], items, p);
    }
    var overall = pcts.length ? Math.round(pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length) : 0;
    updateOverallRing(overall);
  }

  // ---------- boot ----------
  document.addEventListener('auth:ready', async function () {
    var session = await window.sb.auth.getSession();
    CURRENT_USER_EMAIL = session.data && session.data.session ? session.data.session.user.email : null;
    if (SECTION_SLUG) {
      refreshSection(SECTION_SLUG);
    } else if (document.querySelector('.ring-fill')) {
      refreshDashboard();
    }
  });
})();
