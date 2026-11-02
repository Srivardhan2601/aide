// ---------------------------------------------------------------------------
// Aide: UI logic (no build step, no framework)
// Sections: utils · icons · state · shell (sidebar/topbar/tab bar) · views
// (home, chat, approvals, activity, apps, tasks, rules, settings) · motion ·
// sheets (More, quick capture) · toasts · command palette · events · boot.
// Every place a real API call belongs is marked TODO(api).
//
// Motion: springs are CSS `linear()` easing curves plus a little JS for
// count-ups and staggering, so there's no framework or build step.
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  const M = window.MOCK;

  // ===== Utils ==============================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const nowTime = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const initials = (name) => name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#';
  const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

  // localStorage only for per-viewer conveniences (theme, last view, sidebar).
  const store = {
    get(k, d) { try { const v = localStorage.getItem('aide.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('aide.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // ===== API ================================================================
  // The backend (aide-backend) serves this UI and the API from the same origin.
  // Opened any other way (file://, the static preview on :5173), it tries localhost:8000,
  // and falls back to mock-data.js when the API can't be reached.
  const API_BASE = /^https?:$/.test(location.protocol) && location.port !== '5173' ? '' : 'http://localhost:8000';

  async function api(path, { method = 'GET', body, timeout = 8000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(API_BASE + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error((data && data.detail && (typeof data.detail === 'string' ? data.detail : 'Invalid input')) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  // "9:14 AM" for today, "Yesterday", or a short date.
  function fmtWhen(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d)) return '';
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Server approval -> the shape the views already use.
  const fromServer = (a) => ({
    id: String(a.id),
    from: a.from,
    channel: M.channels[a.channel] ? a.channel : 'gmail',
    time: fmtWhen(a.createdAt),
    createdAt: a.createdAt,
    confidence: a.confidence,
    autoSend: false,
    original: a.original,
    draft: a.draft,
    tone: a.tone,
    bucket: a.bucket,
    bucketLabel: a.bucketLabel,
    reason: a.reason,
    status: a.status,
    sendAt: a.sendAt,
  });

  // ===== Icons ==============================================================
  const ICONS = {
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    approvals: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    tasks: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    rules: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    apps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    flame: '<path d="M12 22c4 0 7-2.9 7-7 0-3.5-2.4-5.6-3.6-8.6-.5 1.9-1.6 3-3.1 3.4C12.7 6.9 11.3 4.4 9 3c.3 4.1-5 6.5-5 12 0 4.1 3.6 7 8 7z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  };
  const checkDraw = () => '<svg class="check-draw" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';
  const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  // ===== State ==============================================================
  const VIEWS = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'chat', label: 'Chat', icon: 'chat' },
    { id: 'apps', label: 'Apps', icon: 'apps' },
    { id: 'approvals', label: 'Approvals', icon: 'approvals' },
    { id: 'activity', label: 'Activity', icon: 'activity' },
    { id: 'tasks', label: 'Tasks', icon: 'tasks' },
    { id: 'rules', label: 'Rules', icon: 'rules' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  // Mobile bottom bar: 5 items, Chat in the middle. Everything else lives under More.
  const TABS = ['home', 'approvals', 'chat', 'activity', 'more'];
  const MORE_VIEWS = ['apps', 'tasks', 'rules', 'settings'];

  const urlView = new URLSearchParams(location.search).get('view');
  const state = {
    view: VIEWS.some((v) => v.id === urlView) ? urlView : 'home', // Home is the default screen
    appId: store.get('appId', null), // which app is open when view === 'app'
    animate: true, // play entrance motion on the next render (set on navigation)
    celebrate: false, // confetti when approvals hit zero
    editingDraft: null, // approval id being edited inline in the feed
    inbox: clone(M.inbox),
    collapsed: store.get('collapsed', false),
    theme: store.get('theme', null), // null = follow system
    agentActive: true, // TODO(api): GET /api/agent/status
    typing: false,
    stats: clone(M.stats),
    messages: clone(M.messages),
    approvals: clone(M.approvals),
    activity: clone(M.activity),
    tasks: clone(M.tasks),
    rules: clone(M.rules),
    accounts: clone(M.accounts),
    settings: clone(M.settings),
    activityFilter: { channel: 'all', status: 'all' },
    editingRule: null,
    // Live API state. Until the first successful call we show mock data.
    live: false, // approvals + stats come from the backend
    offline: false, // the backend couldn't be reached; showing sample data
    sending: {}, // approval id -> 'sending' | 'sent' while the undo window runs
    regenerating: {}, // approval id -> tone being generated
    // Live Activity / Rules / Settings data (null until loaded from the backend).
    profile: null, // { name, formOfAddress, availability, needsConfirming, exampleReplies, learnedReplies }
    learned: null, // replies Aide learned from your edits
    hardRules: [], // safety rules enforced in code (read-only in the UI)
    liveRules: false, // state.rules came from the backend, so edits are saved there
    liveActivity: false,
  };

  // Replies still waiting on you (cards that are mid-send don't count).
  const pendingList = () => state.approvals.filter((a) => !state.sending[a.id]);
  const pendingCount = () => pendingList().length;

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (state.theme ? state.theme === 'dark' : systemDark.matches);

  // ===== Shared bits ========================================================
  const channelBadge = (id) => {
    const c = M.channels[id] || { label: id, color: 'var(--muted)' };
    return `<span class="channel"><i style="background:${c.color}"></i>${esc(c.label)}</span>`;
  };

  const switchEl = (id, on, label, attrs = '') =>
    `<span class="switch-row"><button class="switch" role="switch" id="${id}" aria-checked="${on}" aria-labelledby="${id}-l" ${attrs}></button><span id="${id}-l" data-for="${id}">${esc(label)}</span></span>`;

  const emptyState = (iconName, title, text) =>
    `<div class="empty"><div class="empty-icon">${icon(iconName)}</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;

  // Colored letter tile standing in for an app's logo.
  const appGlyph = (id, size = '') => {
    const c = M.channels[id] || { label: id, color: 'var(--muted)' };
    return `<span class="app-glyph ${size}" style="background:${c.color}" aria-hidden="true">${esc(c.label[0])}</span>`;
  };

  // Accounts merged with per-app counts, in channel order.
  function appList() {
    return Object.keys(M.channels).map((id) => {
      const acct = state.accounts.find((a) => a.id === id) || { id, connected: false, autonomy: 'off', handledToday: 0, detail: '' };
      return {
        ...acct,
        id,
        label: M.channels[id].label,
        unread: state.inbox.filter((i) => i.channel === id && i.unread).length,
        pending: state.approvals.filter((a) => a.channel === id).length,
      };
    });
  }

  const AUTONOMY = {
    auto: { label: 'Auto-reply', pill: 's-sent', desc: 'Replies on its own when a message matches your Auto-handle rules. Everything else goes to Approvals.' },
    ask: { label: 'Ask me first', pill: 's-scheduled', desc: 'Drafts every reply and waits for your OK before sending anything.' },
    off: { label: 'Read only', pill: 's-paused', desc: 'Reads and summarizes, but never drafts or sends.' },
  };

  // ===== Shell: sidebar & top bar ==========================================
  function renderSidebar() {
    const pending = pendingCount();
    $('#sidebar').innerHTML = `
      <div class="brand">
        <span class="logo">${icon('sparkle')}</span>
        <span class="brand-name">${esc(M.agent.name)}</span>
        <button class="icon-btn sm" data-action="toggle-sidebar" aria-label="${state.collapsed ? 'Expand' : 'Collapse'} sidebar" aria-expanded="${!state.collapsed}">${icon('panel')}</button>
      </div>
      <nav class="nav">
        ${VIEWS.map((v) => {
          const active = state.view === v.id || (v.id === 'apps' && state.view === 'app');
          return `
          <button class="nav-item ${active ? 'active' : ''}" data-action="nav" data-view="${v.id}"
            ${active ? 'aria-current="page"' : ''} title="${v.label}">
            ${icon(v.icon)}<span class="nav-label">${v.label}</span>
            ${v.id === 'approvals' && pending ? `<span class="badge-count" aria-label="${pending} pending">${pending}</span>` : ''}
          </button>`;
        }).join('')}
      </nav>
      <div class="nav-section" id="apps-heading">Apps</div>
      <nav class="nav apps-nav" aria-labelledby="apps-heading">
        ${appList().map((a) => {
          const active = state.view === 'app' && state.appId === a.id;
          return `
          <button class="nav-item app-item ${active ? 'active' : ''} ${a.connected ? '' : 'is-off'}" data-action="open-app" data-app="${a.id}"
            ${active ? 'aria-current="page"' : ''} title="${esc(a.label)}${a.connected ? '' : ' (not connected)'}">
            ${appGlyph(a.id)}<span class="nav-label">${esc(a.label)}</span>
            ${a.unread ? `<span class="count-muted" aria-label="${a.unread} unread">${a.unread}</span>` : ''}
          </button>`;
        }).join('')}
      </nav>
      <button class="kbd-hint" data-action="palette" aria-label="Open command palette">
        ${icon('search')}<span class="nav-label">Search or jump</span><kbd>${MOD} K</kbd>
      </button>`;
    $('#app').classList.toggle('collapsed', state.collapsed);
  }

  function renderTopbar() {
    const on = state.agentActive;
    let title;
    if (state.view === 'app') {
      title = `<button class="crumb" data-action="nav" data-view="apps">Apps</button><span class="crumb-sep" aria-hidden="true">${icon('chevron')}</span>${appGlyph(state.appId)}<span>${esc(M.channels[state.appId].label)}</span>`;
    } else if (state.view === 'home') {
      // Phones show the brand here (no sidebar); desktop just says Home.
      title = `<span class="logo sm mobile-only" aria-hidden="true">${icon('sparkle')}</span><span class="mobile-only">${esc(M.agent.name)}</span><span class="desktop-only">Home</span>`;
    } else {
      title = VIEWS.find((v) => v.id === state.view).label;
    }
    $('#topbar').innerHTML = `
      <h1 class="page-title">${title}</h1>
      <div class="topbar-right">
        <span class="status ${on ? 'on' : 'off'}" role="status"><span class="dot"></span>${on ? 'Active' : 'Paused'}</span>
        <button class="icon-btn desktop-only" data-action="toggle-theme" aria-label="Switch to ${isDark() ? 'light' : 'dark'} mode">${icon(isDark() ? 'sun' : 'moon')}</button>
        <button class="pause-pill ${on ? '' : 'is-paused'}" data-action="toggle-agent" aria-label="${on ? 'Pause agent' : 'Resume agent'}">
          ${icon(on ? 'pause' : 'play')}<span>${on ? 'Pause' : 'Resume'}</span>
        </button>
      </div>`;
  }

  function renderTabbar() {
    const pending = pendingCount();
    const inMore = MORE_VIEWS.includes(state.view) || state.view === 'app';
    const LABEL = { home: 'Home', approvals: 'Approvals', chat: 'Chat', activity: 'Activity', more: 'More' };
    const ICON = { home: 'home', approvals: 'approvals', chat: 'chat', activity: 'activity', more: 'more' };
    $('#tabbar').innerHTML = TABS.map((t) => {
      const active = t === 'more' ? inMore : state.view === t;
      const attrs = t === 'more' ? 'data-action="more" aria-haspopup="dialog"' : `data-action="nav" data-view="${t}"`;
      return `
        <button class="tab ${t === 'chat' ? 'tab-center' : ''} ${active ? 'active' : ''}" ${attrs} ${active ? 'aria-current="page"' : ''}>
          <span class="tab-icon">${icon(ICON[t])}</span>
          <span class="tab-label">${LABEL[t]}</span>
          ${t === 'approvals' && pending ? `<span class="badge-count" aria-label="${pending} pending">${pending}</span>` : ''}
        </button>`;
    }).join('');
  }

  // ===== View: Home =========================================================
  const partOfDay = () => { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };
  const suggestions = () => M.suggestions[partOfDay()];

  // Confetti burst, shown once when approvals reach zero.
  function confetti() {
    const colors = ['#818cf8', '#a78bfa', '#f472b6', '#4ade80', '#fbbf24'];
    return `<div class="confetti" aria-hidden="true">${Array.from({ length: 22 }, (_, i) =>
      `<i style="--a:${Math.round((i / 22) * 360)}deg;--d:${70 + Math.round(Math.random() * 60)}px;--c:${colors[i % colors.length]};--r:${Math.round(Math.random() * 360)}deg"></i>`).join('')}</div>`;
  }

  const offlineBanner = () => state.offline
    ? `<div class="banner offline-banner" role="status">${icon('inbox')}<span>Offline – showing sample data</span><button class="btn btn-ghost btn-sm" data-action="retry-live">Retry</button></div>`
    : '';

  function heroCard() {
    const pending = pendingList();
    const n = pending.length;
    if (!n) {
      return `
        <section class="hero hero-done">
          ${state.celebrate ? confetti() : ''}
          <div class="done-badge">${icon('check')}</div>
          <h3 class="hero-title">You're all caught up</h3>
          <p class="hero-sub">No replies need you right now. ${esc(M.agent.name)} will let you know when something does.</p>
        </section>`;
    }
    const top = pending[0];
    const c = M.channels[top.channel];
    return `
      <section class="hero pressable" role="button" tabindex="0" data-action="nav" data-view="approvals"
        aria-label="${n} ${n === 1 ? 'reply needs' : 'replies need'} you. Review all.">
        <div class="hero-kicker">${icon('sparkle')}Needs you</div>
        <h3 class="hero-title"><span class="grad-text">${n}</span> ${n === 1 ? 'reply needs' : 'replies need'} you</h3>
        <div class="draft-stack">
          ${n > 2 ? '<div class="stack-layer l2"></div>' : ''}
          ${n > 1 ? '<div class="stack-layer l1"></div>' : ''}
          <div class="stack-top glow" style="--app:${c.edge || c.color}">
            <div class="stack-head">${appGlyph(top.channel, 'sm')}<b>${esc(top.from)}</b><span class="muted">${esc(c.label)} · ${esc(top.time)}</span></div>
            <p class="stack-text">${esc(top.draft)}</p>
          </div>
        </div>
        <span class="btn btn-primary btn-lg btn-block">Review all</span>
      </section>`;
  }

  function viewHome() {
    const s = state.stats;
    const week = s.timeSavedWeek;
    const max = Math.max(...week, 1);
    const dayLetters = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      return d.toLocaleDateString([], { weekday: 'narrow' });
    });
    const total = week.reduce((a, b) => a + b, 0);
    const part = partOfDay();
    return `
      <div class="page home" data-stagger>
        ${offlineBanner()}
        <header class="greet">
          <h2 class="greet-title">Good ${part}, ${esc(M.user.name)}</h2>
          <p class="greet-sub">${esc(M.agent.name)} handled <b class="grad-text">${s.handledToday}</b> things today.</p>
        </header>

        ${heroCard()}

        <div class="home-stats">
          <div class="card stat-card">
            <div class="stat-card-head">${icon('clock')}Time saved</div>
            <div class="big grad-text" data-countup="${s.timeSavedMinutes}" data-format="mins">${fmtMins(s.timeSavedMinutes)}</div>
            <div class="stat-foot">today</div>
          </div>
          <div class="card stat-card">
            <div class="stat-card-head"><span class="flame">${icon('flame')}</span>Day streak</div>
            <div class="big grad-text" data-countup="${s.streakDays}">${s.streakDays}</div>
            <div class="stat-foot">days in a row</div>
          </div>
        </div>

        <section class="card chart-card" aria-labelledby="week-h">
          <div class="chart-head"><h3 id="week-h">Time saved this week</h3><span class="muted">${fmtMins(total)} total</span></div>
          <div class="bars" role="img" aria-label="Minutes saved per day, oldest first: ${week.join(', ')}">
            ${week.map((v, i) => `
              <div class="bar-col" title="${fmtMins(v)}">
                <div class="bar ${i === 6 ? 'is-today' : ''}" style="--h:${(v / max).toFixed(3)};--i:${i}"></div>
                <span class="bar-label ${i === 6 ? 'is-today' : ''}">${i === 6 ? 'Today' : dayLetters[i]}</span>
              </div>`).join('')}
          </div>
        </section>

        <section class="suggest" aria-labelledby="sug-h">
          <div class="suggest-label" id="sug-h">Suggested this ${part}</div>
          <div class="chips">
            ${suggestions().map((q) => `<button class="chip pressable" data-action="suggest" data-text="${esc(q)}">${icon('sparkle')}${esc(q)}</button>`).join('')}
          </div>
        </section>
      </div>`;
  }

  // ===== View: Chat (the feed) ==============================================

  // Clickable tag naming the app a message came from.
  const appTag = (a) => {
    const label = (M.channels[a.id] || { label: a.id }).label;
    return `<button class="app-tag" data-action="open-app" data-app="${a.id}" title="Open ${esc(label)}">${appGlyph(a.id, 'sm')}<span>${esc(label)}</span>${a.note ? `<span class="app-tag-note">${esc(a.note)}</span>` : ''}</button>`;
  };

  // Draft attached to a feed message: Approve / Edit / Skip, or its outcome once resolved.
  function inlineDraft(m) {
    if (!m.approvalId) return '';
    const ap = state.approvals.find((a) => a.id === m.approvalId);
    if (!ap) {
      if (!m.resolved) return '';
      const fresh = !m.animSeen; // play the check animation only the first time
      m.animSeen = true;
      return m.resolved === 'sent'
        ? `<div class="inline-resolved is-sent ${fresh ? 'fresh' : ''}">${checkDraw()}Sent</div>`
        : `<div class="inline-resolved is-skipped">Skipped</div>`;
    }
    const editing = state.editingDraft === ap.id;
    return `
      <div class="inline-draft">
        <div class="inline-draft-label">${editing ? 'Editing reply' : 'Draft reply'} to ${esc(ap.from)}</div>
        ${editing
          ? `<label class="sr-only" for="inl-${ap.id}">Edit reply to ${esc(ap.from)}</label><textarea class="draft-input" id="inl-${ap.id}" data-input="draft" data-id="${ap.id}" rows="3">${esc(ap.draft)}</textarea>`
          : `<p class="inline-draft-text">${esc(ap.draft)}</p>`}
        <div class="inline-actions">
          <button class="btn btn-primary btn-sm" data-action="approve" data-id="${ap.id}">${icon('check')}${editing ? 'Send' : 'Approve'}</button>
          ${editing
            ? `<button class="btn btn-secondary btn-sm" data-action="feed-edit-done" data-id="${ap.id}">Done</button>`
            : `<button class="btn btn-secondary btn-sm" data-action="feed-edit" data-id="${ap.id}">${icon('edit')}Edit</button>`}
          <button class="btn btn-ghost btn-sm" data-action="reject" data-id="${ap.id}">Skip</button>
        </div>
      </div>`;
  }

  function msgHTML(m) {
    if (m.role === 'user') {
      return `
        <div class="msg user">
          <div>
            <div class="msg-bubble"><span class="sr-only">You: </span><div class="msg-text">${esc(m.text)}</div></div>
            <div class="msg-time">${esc(m.time)}</div>
          </div>
        </div>`;
    }
    const apps = (m.apps || []).filter((a) => M.channels[a.id]);
    const single = apps.length === 1 ? apps[0] : null;
    const color = single ? M.channels[single.id].edge || M.channels[single.id].color : '';
    return `
      <div class="msg agent">
        <div class="msg-avatar" aria-hidden="true">${icon('sparkle')}</div>
        <div class="msg-body">
          <div class="msg-name">${esc(M.agent.name)}${single ? `<span class="msg-via">via</span>${appTag(single)}` : ''}</div>
          <div class="msg-bubble ${single ? 'has-source glow' : ''}" ${single ? `style="--app:${color}"` : ''}>
            <div class="msg-text">${esc(m.text)}</div>
            ${inlineDraft(m)}
            ${m.readOnly && m.manualUrl ? `<a class="manual-link" href="${esc(m.manualUrl)}" target="_blank" rel="noopener noreferrer">Reply manually${icon('external')}</a>` : ''}
          </div>
          ${apps.length > 1 ? `<div class="msg-apps" role="group" aria-label="Apps this is about">${apps.map(appTag).join('')}</div>` : ''}
          <div class="msg-time">${esc(m.time)}</div>
        </div>
      </div>`;
  }

  const daySep = (label) => `<div class="day-sep" role="separator"><span>${esc(label)}</span></div>`;

  const typingHTML = () => `
    <div class="msg agent" aria-label="${M.agent.name} is typing">
      <div class="msg-avatar" aria-hidden="true">${icon('sparkle')}</div>
      <div class="msg-bubble typing"><span></span><span></span><span></span></div>
    </div>`;

  function viewChat() {
    return `
      <div class="chat">
        ${state.agentActive ? '' : `<div class="banner">${icon('pause')} ${esc(M.agent.name)} is paused. It won't send or schedule anything until you resume.</div>`}
        <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="Conversation"></div>
        <div class="composer-wrap">
          <div class="chips" role="group" aria-label="Suggestions">
            ${suggestions().map((q) => `<button class="chip pressable" data-action="quick" data-text="${esc(q)}">${esc(q)}</button>`).join('')}
          </div>
          <form class="composer" data-form="chat">
            <label for="chat-input" class="sr-only">Message ${esc(M.agent.name)}</label>
            <textarea id="chat-input" rows="1" placeholder="Ask ${esc(M.agent.name)} anything…"></textarea>
            <button class="send-btn" type="submit" aria-label="Send message">${icon('send')}</button>
          </form>
          <p class="composer-hint">Enter to send · Shift + Enter for a new line · ${MOD} K for commands</p>
        </div>
      </div>`;
  }

  // keepScroll: re-render in place (e.g. after approving a mid-feed draft) instead of jumping to the bottom.
  function refreshChatLog(keepScroll) {
    const log = $('#chat-log');
    if (!log) return;
    const prev = log.scrollTop;
    let lastDay = null;
    log.innerHTML = state.messages.map((m) => {
      const day = m.day || 'Today';
      const sep = day !== lastDay ? daySep(day) : '';
      lastDay = day;
      return sep + msgHTML(m);
    }).join('') + (state.typing ? typingHTML() : '');
    log.style.scrollBehavior = 'auto';
    log.scrollTop = keepScroll ? prev : log.scrollHeight;
    log.style.scrollBehavior = '';
    if (state.editingDraft) { const t = $(`#inl-${state.editingDraft}`); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
  }

  function cannedReply(text) {
    const t = text.toLowerCase();
    const hit = M.cannedReplies.find((r) => t.includes(r.match));
    return hit ? { text: hit.text, apps: hit.apps } : { text: M.defaultReply };
  }

  // channel (optional): the app this question is about, so the reply is tagged with it.
  function sendChat(text, channel) {
    text = text.trim();
    if (!text) return;
    state.messages.push({ id: uid(), role: 'user', text, time: nowTime() });
    state.typing = true;
    refreshChatLog();
    // TODO(api): POST /api/chat { message: text, channel } and stream the reply (with its source apps) into state.messages.
    setTimeout(() => {
      state.typing = false;
      const reply = cannedReply(text);
      const apps = channel ? [{ id: channel }] : reply.apps;
      state.messages.push({ id: uid(), role: 'agent', text: reply.text, apps, time: nowTime() });
      refreshChatLog();
    }, 900 + Math.random() * 700);
  }

  // ===== View: Approvals ====================================================
  const BUCKET_LABEL = { auto: 'Auto-handle', ask: 'Ask first', never: 'Never' };
  const TONES = [
    { key: 'shorter', label: 'Shorter' },
    { key: 'warmer', label: 'Warmer' },
    { key: 'formal', label: 'More formal' },
  ];

  function approvalCard(a) {
    const phase = state.sending[a.id]; // 'sending' | 'sent' | undefined
    const regen = state.regenerating[a.id];
    const color = M.channels[a.channel].edge || M.channels[a.channel].color;
    const foot = phase
      ? `<footer class="approval-foot send-state ${phase === 'sent' ? 'is-sent fresh' : ''}" role="status">
          ${phase === 'sent' ? `${checkDraw()}<span>Sent</span>` : `<span class="spinner" aria-hidden="true"></span><span>Sending…</span><span class="muted send-hint">Undo from the toast</span>`}
        </footer>`
      : `<footer class="approval-foot">
          ${a.bucket ? `<div class="tone-row" role="group" aria-label="Rewrite the draft">
            ${TONES.map((t) => `<button class="chip chip-sm pressable ${regen === t.key ? 'is-busy' : ''}" data-action="tone-draft" data-id="${a.id}" data-tone="${t.key}" ${regen ? 'disabled' : ''}>${esc(t.label)}</button>`).join('')}
          </div>` : switchEl('auto-' + a.id, a.autoSend, 'Always auto-send this type', `data-action="autosend" data-id="${a.id}"`)}
          <div class="actions">
            <button class="btn btn-ghost" data-action="reject" data-id="${a.id}">Skip</button>
            <button class="btn btn-secondary" data-action="edit-draft" data-id="${a.id}">${icon('edit')}Edit</button>
            <button class="btn btn-primary" data-action="approve" data-id="${a.id}" ${regen ? 'disabled' : ''}>${icon('send')}Approve</button>
          </div>
        </footer>`;
    return `
      <div class="swipe" data-swipe="${a.id}">
        <div class="swipe-reveal" aria-hidden="true">
          <span class="reveal-approve">${icon('check')}Approve</span>
          <span class="reveal-skip">Skip${icon('x')}</span>
        </div>
        <article class="card approval glow ${phase ? 'is-' + phase : ''}" data-card="${a.id}" style="--app:${color}" aria-label="Draft reply to ${esc(a.from)}">
          <header class="approval-head">
            <div class="avatar" aria-hidden="true">${esc(initials(a.from))}</div>
            <div class="who">
              <div class="who-name">${esc(a.from)}</div>
              <div class="who-meta">${channelBadge(a.channel)}<span aria-hidden="true">·</span>${esc(a.time)}</div>
            </div>
            <span class="pill c-${a.confidence}">${cap(a.confidence)} confidence</span>
          </header>
          ${a.bucket ? `
          <div class="bucket-row">
            <span class="pill b-${a.bucket}"><span class="marker m-${a.bucket}" aria-hidden="true"></span>${esc(BUCKET_LABEL[a.bucket] || a.bucket)}</span>
            <span class="bucket-reason">${esc(a.reason || '')}</span>
          </div>` : ''}
          <div>
            <div class="field-label">Original message</div>
            <div class="original">${esc(a.original)}</div>
          </div>
          <div class="draft-wrap ${regen ? 'is-loading' : ''}">
            <label class="field-label" for="draft-${a.id}">${regen ? 'Rewriting…' : 'Drafted reply'}</label>
            <textarea class="draft-input" id="draft-${a.id}" data-input="draft" data-id="${a.id}" rows="3" ${regen || phase ? 'readonly' : ''} aria-busy="${!!regen}">${esc(a.draft)}</textarea>
          </div>
          ${foot}
        </article>
      </div>`;
  }

  function viewApprovals() {
    const n = state.approvals.length;
    const waiting = pendingCount();
    const pasteBtn = `<button class="btn btn-secondary btn-sm" data-action="paste">${icon('plus')}Paste a message</button>`;
    if (!n) {
      return `
        <div class="page">
          ${offlineBanner()}
          <div class="zero">
            ${state.celebrate ? confetti() : ''}
            <div class="done-badge lg">${icon('check')}</div>
            <h2>Inbox zero. Nice work.</h2>
            <p>Every reply is handled. ${esc(M.agent.name)} will ping you when something new needs your OK.</p>
            <div class="zero-actions">
              <button class="btn btn-secondary" data-action="nav" data-view="home">${icon('home')}Back to Home</button>
              ${pasteBtn}
            </div>
          </div>
        </div>`;
    }
    return `
      <div class="page">
        ${offlineBanner()}
        <div class="page-head">
          <p class="page-sub">${waiting ? `${waiting} ${waiting === 1 ? 'draft is' : 'drafts are'} waiting for your review. Edit any reply before sending.` : 'Sending your replies…'}</p>
          ${pasteBtn}
        </div>
        <p class="swipe-hint mobile-only">Swipe right to approve, left to skip.</p>
        <div class="stack" data-stagger>${state.approvals.map(approvalCard).join('')}</div>
      </div>`;
  }

  // Re-render just one approval card (keeps scroll and other cards' state intact).
  function refreshCard(id) {
    const wrap = document.querySelector(`[data-swipe="${id}"]`);
    const a = state.approvals.find((x) => x.id === id);
    if (!wrap || !a || state.view !== 'approvals') { renderAll(); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = approvalCard(a).trim();
    wrap.replaceWith(tmp.firstElementChild);
    renderSidebar(); renderTabbar(); updateBadge();
  }

  async function refreshStats() {
    try { state.stats = await api('/api/stats'); } catch (e) { /* keep the last numbers */ }
  }

  // Approve: server holds it for the undo window (status "sending"), then sends.
  async function approveLive(id) {
    const item = state.approvals.find((a) => a.id === id);
    if (!item || state.sending[id]) return;
    state.sending[id] = 'sending';
    if (state.editingDraft === id) state.editingDraft = null;
    refreshCard(id);
    let res;
    try {
      res = await api(`/api/approvals/${id}/approve`, { method: 'POST', body: { draft: item.draft } });
    } catch (e) {
      delete state.sending[id];
      refreshCard(id);
      toast(e.status === 409 ? 'That reply was already handled' : "Couldn't reach the server. Nothing was sent.");
      if (e.status === 409) loadLive();
      return;
    }
    if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(12);
    let undone = false;
    toast(`Sending to ${item.from}…`, {
      action: 'Undo',
      onAction: async () => {
        undone = true;
        try {
          await api(`/api/approvals/${id}/undo`, { method: 'POST' });
          delete state.sending[id];
          renderAll();
          toast('Undone. The draft is back in your queue.');
        } catch (e) {
          undone = false;
          toast(e.status === 409 ? 'Too late, it was already sent' : "Couldn't undo. Check your connection.");
        }
      },
    });
    // Wait for the window to close, then confirm with the server.
    const wait = Math.max(0, new Date(res.sendAt) - Date.now()) + 250;
    setTimeout(() => confirmSent(id, () => undone, 0), wait);
  }

  async function confirmSent(id, isUndone, tries) {
    if (isUndone() || !state.sending[id]) return;
    let a;
    try { a = await api(`/api/approvals/${id}`); } catch (e) { a = null; }
    if (a && a.status === 'sent') {
      state.sending[id] = 'sent';
      refreshCard(id);
      const item = state.approvals.find((x) => x.id === id);
      if (item) state.activity.unshift({ id: uid(), type: 'reply', channel: item.channel, status: 'sent', time: nowTime(), undoable: false, text: `Sent your reply to ${item.from}` });
      await refreshStats();
      setTimeout(() => removeApproval(id), 1300);
      return;
    }
    if (a && a.status === 'pending') { delete state.sending[id]; renderAll(); return; } // undone elsewhere
    if (tries < 30) setTimeout(() => confirmSent(id, isUndone, tries + 1), 400);
  }

  function removeApproval(id) {
    const card = document.querySelector(`[data-card="${id}"]`);
    const done = () => {
      state.approvals = state.approvals.filter((a) => a.id !== id);
      delete state.sending[id];
      delete state.regenerating[id];
      if (!state.approvals.length) state.celebrate = true;
      renderAll();
      state.celebrate = false;
    };
    if (card) { card.classList.add('leaving'); setTimeout(done, 170); } else done();
  }

  async function rejectLive(id) {
    const item = state.approvals.find((a) => a.id === id);
    if (!item || state.sending[id]) return;
    try {
      await api(`/api/approvals/${id}/reject`, { method: 'POST' });
    } catch (e) {
      toast(e.status === 409 ? 'That reply was already handled' : "Couldn't reach the server. Try again.");
      if (e.status === 409) loadLive();
      return;
    }
    removeApproval(id);
    toast(`Skipped the draft for ${item.from}`);
    refreshStats();
  }

  async function regenerateLive(id, tone) {
    const item = state.approvals.find((a) => a.id === id);
    if (!item || state.regenerating[id] || state.sending[id]) return;
    if (!state.live) { toast('Rewriting needs the Aide server'); return; }
    state.regenerating[id] = tone;
    refreshCard(id);
    try {
      const a = await api(`/api/approvals/${id}/regenerate`, { method: 'POST', body: { tone }, timeout: 60000 });
      Object.assign(item, fromServer(a));
    } catch (e) {
      toast("Couldn't rewrite the draft. Try again.");
    }
    delete state.regenerating[id];
    refreshCard(id);
  }

  // Save a manual edit (on blur), so the server copy matches what you see.
  async function saveDraft(id) {
    const item = state.approvals.find((a) => a.id === id);
    if (!state.live || !item || state.sending[id] || !item.draft.trim()) return;
    try { await api(`/api/approvals/${id}`, { method: 'PATCH', body: { draft: item.draft } }); } catch (e) { /* approve sends the draft too */ }
  }

  function resolveApproval(id, verdict) {
    if (state.live) { verdict === 'approve' ? approveLive(id) : rejectLive(id); return; }
    const idx = state.approvals.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const item = state.approvals[idx];
    const card = document.querySelector(`[data-card="${id}"]`);
    const feedMsgs = state.messages.filter((m) => m.approvalId === id);
    const finish = () => {
      state.approvals.splice(idx, 1);
      if (state.editingDraft === id) state.editingDraft = null;
      feedMsgs.forEach((m) => { m.resolved = verdict === 'approve' ? 'sent' : 'skipped'; m.animSeen = false; });
      let entry = null;
      if (verdict === 'approve') {
        // Offline (mock) path. Live approvals go through approveLive() -> POST /api/approvals/:id/approve
        entry = { id: uid(), type: 'reply', channel: item.channel, status: 'sent', time: nowTime(), undoable: true, text: `Sent your reply to ${item.from}` };
        state.activity.unshift(entry);
        state.stats.handledToday++;
        // Tiny haptic tick on phones (browsers only allow it after a real tap).
        if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(12);
      } else {
        // Offline (mock) path. Live: rejectLive() -> POST /api/approvals/:id/reject
      }
      if (!state.approvals.length) state.celebrate = true;
      renderAll();
      state.celebrate = false;
      toast(verdict === 'approve' ? `Reply sent to ${item.from}` : `Skipped the draft for ${item.from}`, {
        action: 'Undo',
        onAction: () => {
          // Offline (mock) path only. Live undo: POST /api/approvals/:id/undo
          state.approvals.splice(Math.min(idx, state.approvals.length), 0, item);
          feedMsgs.forEach((m) => { delete m.resolved; });
          if (entry) { state.activity = state.activity.filter((e) => e !== entry); state.stats.handledToday--; }
          renderAll();
        },
      });
    };
    if (card) { card.classList.add('leaving'); setTimeout(finish, 170); } else finish();
  }

  // ===== View: Activity =====================================================
  const TYPE_ICON = { reply: 'mail', meeting: 'calendar', flag: 'flag', summary: 'inbox' };
  const STATUS_LABEL = { sent: 'Sent', skipped: 'Skipped', scheduled: 'Scheduled', flagged: 'Flagged', undone: 'Undone', failed: 'Failed' };

  function viewActivity() {
    const f = state.activityFilter;
    const items = state.activity.filter((e) => (f.channel === 'all' || e.channel === f.channel) && (f.status === 'all' || e.status === f.status));
    const opt = (val, label, cur) => `<option value="${val}" ${val === cur ? 'selected' : ''}>${label}</option>`;
    return `
      <div class="page">
        <div class="toolbar">
          <label class="sr-only" for="f-channel">Filter by channel</label>
          <select class="select" id="f-channel" data-filter="channel">
            ${opt('all', 'All channels', f.channel)}
            ${Object.entries(M.channels).map(([k, c]) => opt(k, c.label, f.channel)).join('')}
          </select>
          <label class="sr-only" for="f-status">Filter by status</label>
          <select class="select" id="f-status" data-filter="status">
            ${opt('all', 'Any status', f.status)}
            ${Object.entries(STATUS_LABEL).map(([k, l]) => opt(k, l, f.status)).join('')}
          </select>
          <span class="spacer"></span>
          ${f.channel !== 'all' || f.status !== 'all' ? `<button class="btn btn-ghost btn-sm" data-action="clear-filters">Clear filters</button>` : ''}
        </div>
        ${items.length ? `
          <ol class="timeline" aria-label="Agent activity" data-stagger>
            ${(() => {
              let last = null;
              return items.map((e) => {
                const day = e.at ? dayLabel(e.at) : (e.time === 'Yesterday' ? 'Yesterday' : 'Today');
                const sep = day !== last ? `<li class="day-sep" role="separator"><span>${day}</span></li>` : '';
                last = day;
                return sep + tlItem(e);
              }).join('');
            })()}
          </ol>` : (state.liveActivity && !state.activity.length
            ? emptyState('activity', 'Nothing here yet', `Replies you send or skip will show up here.`)
            : emptyState('activity', 'Nothing matches these filters', 'Try another channel or status.'))}
      </div>`;
  }

  const tlItem = (e) => `
    <li class="tl-item ${e.status === 'undone' ? 'is-undone' : ''}">
      <div class="tl-icon">${icon(TYPE_ICON[e.type] || 'activity')}</div>
      <div class="tl-body">
        <div class="tl-text">${esc(e.text)}</div>
        ${e.detail ? `<div class="tl-detail">"${esc(e.detail)}"</div>` : ''}
        <div class="tl-meta">${channelBadge(e.channel)}<span aria-hidden="true">·</span>${esc(e.time)}${e.transport === 'mock' ? '<span aria-hidden="true">·</span><span title="Sending is simulated for this app until it is connected">simulated</span>' : ''}</div>
      </div>
      <div class="tl-right">
        ${e.learned ? `<span class="pill s-learned" title="You edited this before sending, so ${esc(M.agent.name)} learned from it">${icon('sparkle')}Learned</span>` : ''}
        <span class="pill s-${e.status}">${STATUS_LABEL[e.status] || e.status}</span>
        ${e.undoable && e.status !== 'undone' ? `<button class="btn btn-ghost btn-sm" data-action="undo-activity" data-id="${e.id}">${icon('undo')}Undo</button>` : ''}
      </div>
    </li>`;

  // ===== View: Apps (overview of every app) =================================
  function viewApps() {
    return `
      <div class="page page-wide">
        <p class="page-sub">Each app has its own inbox, approvals and level of control for ${esc(M.agent.name)}.</p>
        <div class="app-grid">
          ${appList().map((a) => `
            <button class="card app-card ${a.connected ? '' : 'is-off'}" data-action="open-app" data-app="${a.id}" aria-label="Open ${esc(a.label)}">
              <div class="app-card-head">
                ${appGlyph(a.id, 'lg')}
                <div class="app-card-title">
                  <div class="row-title">${esc(a.label)}</div>
                  <div class="row-sub">${a.connected ? esc(a.detail) : 'Not connected'}</div>
                </div>
                ${a.connected ? `<span class="pill ${AUTONOMY[a.autonomy].pill}">${AUTONOMY[a.autonomy].label}</span>` : `<span class="pill">Connect</span>`}
              </div>
              <div class="app-card-stats">
                <div><b>${a.unread}</b><span>Unread</span></div>
                <div><b>${a.pending}</b><span>Awaiting</span></div>
                <div><b>${a.handledToday}</b><span>Handled today</span></div>
              </div>
            </button>`).join('')}
        </div>
      </div>`;
  }

  // ===== View: single app ===================================================
  const INBOX_STATUS = {
    new: { label: 'New', pill: 's-scheduled' },
    awaiting: { label: 'Draft ready', pill: 's-flagged' },
    handled: { label: 'Handled', pill: 's-sent' },
    flagged: { label: 'Flagged', pill: 'c-low' },
  };

  function viewApp() {
    const a = appList().find((x) => x.id === state.appId);
    if (!a) return viewApps();
    const isCal = a.id === 'calendar';

    const hero = `
      <div class="card app-hero">
        ${appGlyph(a.id, 'xl')}
        <div class="app-hero-main">
          <h2>${esc(a.label)}</h2>
          <div class="row-sub">${a.connected ? esc(a.detail) : 'Not connected'}</div>
        </div>
        ${a.connected
          ? `<span class="pill success">Connected</span><button class="btn btn-ghost btn-sm" data-action="account-toggle" data-id="${a.id}">Disconnect</button>`
          : `<button class="btn btn-primary" data-action="account-toggle" data-id="${a.id}">Connect ${esc(a.label)}</button>`}
      </div>`;

    if (!a.connected) {
      return `<div class="page">${hero}${emptyState('apps', `${a.label} isn't connected yet`, `Connect it to let ${M.agent.name} read, summarize and draft replies here.`)}</div>`;
    }

    const items = state.inbox.filter((i) => i.channel === a.id);
    const approvals = state.approvals.filter((x) => x.channel === a.id);
    const activity = state.activity.filter((e) => e.channel === a.id);

    return `
      <div class="page">
        ${hero}

        <section class="section" aria-labelledby="ctl-h">
          <div class="section-head"><h2 id="ctl-h">What ${esc(M.agent.name)} can do in ${esc(a.label)}</h2></div>
          <div class="segmented" role="radiogroup" aria-labelledby="ctl-h">
            ${Object.entries(AUTONOMY).map(([k, v]) => `<button role="radio" aria-checked="${a.autonomy === k}" data-action="app-autonomy" data-app="${a.id}" data-level="${k}">${v.label}</button>`).join('')}
          </div>
          <p class="autonomy-desc">${AUTONOMY[a.autonomy].desc}</p>
        </section>

        <div class="stats">
          <div class="stat"><div class="stat-value">${a.unread}</div><div class="stat-label">Unread</div></div>
          <div class="stat"><div class="stat-value">${a.pending}</div><div class="stat-label">Awaiting approval</div></div>
          <div class="stat"><div class="stat-value">${a.handledToday}</div><div class="stat-label">Handled today</div></div>
        </div>

        ${approvals.length ? `
          <section class="section" aria-labelledby="ap-h">
            <div class="section-head"><h2 id="ap-h">Waiting for your OK</h2></div>
            <div class="stack">${approvals.map(approvalCard).join('')}</div>
          </section>` : ''}

        <section class="section" aria-labelledby="ib-h">
          <div class="section-head"><h2 id="ib-h">${isCal ? 'Events' : 'Conversations'}</h2></div>
          ${items.length ? `
            <div class="list" role="list">
              ${items.map((i) => `
                <div class="row convo ${i.unread ? 'is-unread' : ''}" role="listitem">
                  ${isCal ? `<div class="avatar">${icon('calendar')}</div>` : `<div class="avatar" aria-hidden="true">${esc(initials(i.from))}</div>`}
                  <button class="row-main convo-open" data-action="inbox-open" data-id="${i.id}" aria-label="${esc(i.from)}: ${esc(i.preview)}${i.unread ? ' (unread)' : ''}">
                    <div class="row-title">${i.unread ? '<span class="unread-dot" aria-hidden="true"></span>' : ''}${esc(i.from)}</div>
                    <div class="row-sub row-preview">${esc(i.preview)}</div>
                  </button>
                  <span class="convo-time">${esc(i.time)}</span>
                  <span class="pill ${INBOX_STATUS[i.status].pill}">${INBOX_STATUS[i.status].label}</span>
                  <button class="icon-btn sm" data-action="ask-about" data-id="${i.id}" aria-label="Ask ${esc(M.agent.name)} about ${esc(i.from)}" title="Ask ${esc(M.agent.name)}">${icon('sparkle')}</button>
                </div>`).join('')}
            </div>` : emptyState('inbox', 'Inbox zero', `Nothing new in ${a.label}.`)}
        </section>

        <section class="section" aria-labelledby="ac-h">
          <div class="section-head"><h2 id="ac-h">Recent activity</h2></div>
          ${activity.length ? `<ol class="timeline">${activity.map(tlItem).join('')}</ol>` : `<p class="autonomy-desc">${esc(M.agent.name)} hasn't done anything in ${esc(a.label)} yet today.</p>`}
        </section>
      </div>`;
  }

  // ===== View: Tasks ========================================================
  const TASK_LABEL = { running: 'In progress', scheduled: 'Scheduled', paused: 'Paused', done: 'Done' };

  function viewTasks() {
    return `
      <div class="page">
        <form class="add-form" data-form="task" aria-label="Add task">
          <label class="sr-only" for="task-title">Task</label>
          <input class="input" id="task-title" placeholder="What should ${esc(M.agent.name)} handle?" autocomplete="off" />
          <label class="sr-only" for="task-when">When</label>
          <input class="input" id="task-when" placeholder="When? e.g. Every Friday 5 PM" autocomplete="off" />
          <button class="btn btn-primary" type="submit">${icon('plus')}Add task</button>
        </form>
        ${state.tasks.length ? `
          <div class="list" role="list">
            ${state.tasks.map((t) => `
              <div class="row ${t.status === 'done' ? 'is-done' : ''}" role="listitem">
                <div class="row-main">
                  <div class="row-title">${esc(t.title)}</div>
                  <div class="row-sub">${icon('clock')}${esc(t.when)}</div>
                </div>
                <span class="pill s-${t.status}">${TASK_LABEL[t.status]}</span>
                <div class="row-actions">
                  ${t.status === 'done' ? '' : `<button class="icon-btn sm" data-action="task-toggle" data-id="${t.id}" aria-label="${t.status === 'paused' ? 'Resume' : 'Pause'} ${esc(t.title)}">${icon(t.status === 'paused' ? 'play' : 'pause')}</button>`}
                  <button class="icon-btn sm" data-action="task-delete" data-id="${t.id}" aria-label="Delete ${esc(t.title)}">${icon('trash')}</button>
                </div>
              </div>`).join('')}
          </div>` : emptyState('tasks', 'No tasks yet', 'Add something above, like a daily summary or a follow-up.')}
      </div>`;
  }

  // ===== View: Rules ========================================================
  const RULE_COLS = [
    { key: 'auto', title: 'Auto-handle', desc: 'Done without asking. Shows up in Activity.', marker: 'm-auto' },
    { key: 'ask', title: 'Ask me first', desc: 'Drafted, then sent to Approvals.', marker: 'm-ask' },
    { key: 'never', title: 'Never do', desc: 'Hard limits, even if asked in a message.', marker: 'm-never' },
  ];

  function viewRules() {
    return `
      <div class="page page-wide">
        <p class="page-sub">Decide how much ${esc(M.agent.name)} can do on its own. Rules are checked top to bottom, and "Never do" always wins.${state.liveRules ? ' Changes are saved and guide every new draft.' : ''}</p>
        ${state.hardRules.length ? `
          <section class="card hard-rules" aria-labelledby="hard-h">
            <div class="rule-col-head">${icon('rules')}<h2 id="hard-h">Always on</h2></div>
            <p class="rule-col-desc">Safety rules built into ${esc(M.agent.name)}. They apply to every draft and can't be switched off here.</p>
            <ul>${state.hardRules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          </section>` : ''}
        <div class="rules-grid">
          ${RULE_COLS.map((col) => `
            <section class="card rule-col" aria-labelledby="col-${col.key}">
              <div class="rule-col-head"><span class="marker ${col.marker}"></span><h2 id="col-${col.key}">${col.title}</h2></div>
              <p class="rule-col-desc">${col.desc}</p>
              ${state.rules[col.key].length ? state.rules[col.key].map((r) => state.editingRule === r.id ? `
                <div class="rule">
                  <label class="sr-only" for="edit-${r.id}">Edit rule</label>
                  <input class="input" id="edit-${r.id}" data-input="rule-edit" data-col="${col.key}" data-id="${r.id}" value="${esc(r.text)}" />
                </div>` : `
                <div class="rule">
                  <span class="rule-text">${esc(r.text)}</span>
                  <button class="icon-btn sm" data-action="rule-edit" data-id="${r.id}" aria-label="Edit rule: ${esc(r.text)}">${icon('edit')}</button>
                  <button class="icon-btn sm" data-action="rule-delete" data-col="${col.key}" data-id="${r.id}" aria-label="Remove rule: ${esc(r.text)}">${icon('x')}</button>
                </div>`).join('') : `<p class="rule-col-desc">No rules yet.</p>`}
              <form class="rule-add" data-form="rule" data-col="${col.key}">
                <label class="sr-only" for="add-${col.key}">Add a rule to ${col.title}</label>
                <input class="input" id="add-${col.key}" placeholder="Add a rule…" autocomplete="off" />
                <button class="icon-btn" type="submit" aria-label="Add rule to ${col.title}">${icon('plus')}</button>
              </form>
            </section>`).join('')}
        </div>
      </div>`;
  }

  function saveRuleEdit(input) {
    const list = state.rules[input.dataset.col];
    const rule = list.find((r) => r.id === input.dataset.id);
    const text = input.value.trim();
    state.editingRule = null;
    if (rule && text && text !== rule.text) {
      rule.text = text;
      syncRules();
      toast('Rule updated');
    }
    renderView();
  }

  // ===== View: Settings =====================================================
  // "About you" + "Learned from your edits": live only (they read and write the backend).
  function settingsLiveSections() {
    const p = state.profile;
    if (!p) return '';
    const confirm = (k) => p.needsConfirming.includes(k) ? '<span class="pill s-flagged">Please confirm</span>' : '';
    const learned = state.learned || [];
    return `
      <section class="section" aria-labelledby="s-you">
        <div class="section-head"><h2 id="s-you">About you</h2><p>${esc(M.agent.name)} uses this in every draft.</p></div>
        <form class="card about-form" data-form="profile">
          <label class="field">
            <span class="field-label">What should ${esc(M.agent.name)} call you? ${confirm('form_of_address')}</span>
            <input class="input" id="pf-address" maxlength="60" value="${esc(p.formOfAddress)}" placeholder="e.g. Sri" autocomplete="off" />
          </label>
          <label class="field">
            <span class="field-label">When are you usually free? ${confirm('availability')}</span>
            <input class="input" id="pf-availability" maxlength="200" value="${esc(p.availability)}" placeholder="e.g. after 6 PM on weekdays" autocomplete="off" />
          </label>
          <div class="about-actions"><button class="btn btn-primary btn-sm" type="submit">Save</button></div>
        </form>
      </section>

      <section class="section" aria-labelledby="s-learned">
        <div class="section-head"><h2 id="s-learned">Learned from your edits</h2>
          <p>When you change a draft before sending, ${esc(M.agent.name)} keeps your version as an example of how you write. The newest 8 are used for every draft.</p></div>
        ${learned.length ? `
          <div class="list" role="list">
            ${learned.map((l) => `
              <div class="row learned-row" role="listitem">
                <div class="row-main">
                  <div class="row-sub">${channelBadge(M.channels[l.channel] ? l.channel : 'gmail')}<span aria-hidden="true">·</span>${esc(l.from)}<span aria-hidden="true">·</span>${esc(fmtWhen(l.at))}</div>
                  <div class="learned-pair">
                    <div><span class="field-label">${esc(M.agent.name)} wrote</span><p class="learned-ai">${esc(l.aiDraft)}</p></div>
                    <div><span class="field-label">You sent</span><p class="learned-you">${esc(l.reply)}</p></div>
                  </div>
                </div>
                <button class="icon-btn sm" data-action="forget-learned" data-id="${l.id}" aria-label="Forget this example" title="Forget this example">${icon('trash')}</button>
              </div>`).join('')}
          </div>` : `<div class="card learned-empty">${icon('sparkle')}<span>Nothing yet. Edit a draft before you approve it and ${esc(M.agent.name)} will start learning your style.</span></div>`}
      </section>`;
  }

  function viewSettings() {
    const s = state.settings;
    return `
      <div class="page">
        ${settingsLiveSections()}
        <section class="section" aria-labelledby="s-accounts">
          <div class="section-head"><h2 id="s-accounts">Connected accounts</h2><p>Where ${esc(M.agent.name)} can read and reply.</p></div>
          <div class="list">
            ${state.accounts.map((a) => `
              <div class="row">
                <div class="acct-icon" style="background:${(M.channels[a.id] || {}).color || 'var(--muted)'}" aria-hidden="true">${esc(a.name[0])}</div>
                <div class="row-main">
                  <div class="row-title">${esc(a.name)}</div>
                  <div class="row-sub">${a.connected ? esc(a.detail) : 'Not connected'}</div>
                </div>
                ${a.connected ? `<span class="pill success">Connected</span>` : ''}
                <button class="btn ${a.connected ? 'btn-ghost' : 'btn-secondary'} btn-sm" data-action="account-toggle" data-id="${a.id}">${a.connected ? 'Disconnect' : 'Connect'}</button>
              </div>`).join('')}
          </div>
        </section>

        <section class="section" aria-labelledby="s-tone">
          <div class="section-head"><h2 id="s-tone">Tone and writing style</h2><p>How drafted replies should sound.</p></div>
          <div class="card">
            <div class="segmented" role="radiogroup" aria-label="Tone">
              ${Object.entries(M.tones).map(([k, t]) => `<button role="radio" aria-checked="${s.tone === k}" data-action="tone" data-tone="${k}">${t.label}</button>`).join('')}
            </div>
            <div class="preview-label">Preview</div>
            <p class="preview" aria-live="polite">${esc(M.tones[s.tone].preview)}</p>
          </div>
        </section>

        <section class="section" aria-labelledby="s-notif">
          <div class="section-head"><h2 id="s-notif">Notifications</h2><p>What's worth interrupting you for.</p></div>
          <div class="list">
            ${s.notifications.map((n) => `
              <div class="row">
                <div class="row-main"><div class="row-title" id="n-${n.id}-t">${esc(n.label)}</div><div class="row-sub">${esc(n.desc)}</div></div>
                <button class="switch" role="switch" aria-checked="${n.on}" aria-labelledby="n-${n.id}-t" data-action="notif" data-id="${n.id}"></button>
              </div>`).join('')}
          </div>
        </section>

        <section class="section" aria-labelledby="s-limit">
          <div class="section-head"><h2 id="s-limit">Daily send limit</h2><p>${esc(M.agent.name)} stops sending and asks you once it reaches this many messages in a day.</p></div>
          <div class="card range-row">
            <label class="sr-only" for="limit">Messages per day</label>
            <input type="range" id="limit" min="0" max="200" step="5" value="${s.dailyLimit}" data-input="limit" />
            <span class="range-value" id="limit-value">${s.dailyLimit} / day</span>
          </div>
        </section>
      </div>`;
  }

  // ===== Render =============================================================
  const VIEW_FNS = { home: viewHome, chat: viewChat, apps: viewApps, app: viewApp, approvals: viewApprovals, activity: viewActivity, tasks: viewTasks, rules: viewRules, settings: viewSettings };

  // ===== Motion =============================================================
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let enterTimer = null;

  // Count a number up from 0 (ease-out), e.g. "Time saved" and "Day streak".
  function countUp(el) {
    const target = +el.dataset.countup;
    const fmt = el.dataset.format === 'mins' ? fmtMins : (v) => String(v);
    if (reducedMotion.matches) { el.textContent = fmt(target); return; }
    const dur = 900;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min((t - t0) / dur, 1);
      el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = fmt(0);
    requestAnimationFrame(step);
  }

  // Spring entrance for a newly opened screen, with list items staggered.
  function playEnter(content) {
    content.classList.remove('is-entering');
    void content.offsetWidth; // restart the CSS animation
    content.querySelectorAll('[data-stagger]').forEach((list) => {
      [...list.children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)));
    });
    content.classList.add('is-entering');
    content.querySelectorAll('[data-countup]').forEach(countUp);
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => content.classList.remove('is-entering'), 1100);
  }

  function renderView() {
    const content = $('#content');
    content.classList.toggle('is-chat', state.view === 'chat');
    content.innerHTML = VIEW_FNS[state.view]();
    if (state.view === 'chat') refreshChatLog();
    if (state.animate) { playEnter(content); state.animate = false; }
    else content.classList.remove('is-entering');
    if (state.editingRule) { const el = $(`#edit-${state.editingRule}`); if (el) { el.focus(); el.select(); } }
  }

  // App icon badge + tab title show how many replies need you.
  function updateBadge() {
    const n = pendingCount();
    document.title = n ? `(${n}) ${M.agent.name}` : M.agent.name;
    try {
      if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
      else if (!n && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
    } catch (e) { /* not supported */ }
  }

  function renderAll() {
    // Preserve focus/scroll where we can when re-rendering.
    const focusId = document.activeElement && document.activeElement.id;
    const scroll = $('#content').scrollTop;
    const log = $('#chat-log');
    const logScroll = log && !state.animate ? log.scrollTop : null;
    document.body.dataset.view = state.view;
    renderSidebar();
    renderTopbar();
    renderTabbar();
    renderView();
    updateBadge();
    $('#content').scrollTop = scroll;
    if (logScroll !== null && $('#chat-log')) { const l = $('#chat-log'); l.style.scrollBehavior = 'auto'; l.scrollTop = logScroll; l.style.scrollBehavior = ''; }
    if (focusId && $('#' + focusId)) $('#' + focusId).focus();
  }

  function applyTheme() {
    if (state.theme) document.documentElement.setAttribute('data-theme', state.theme);
    else document.documentElement.removeAttribute('data-theme');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark() ? '#0b0b0f' : '#f7f7fb');
  }

  function go(view, appId) {
    if (!VIEW_FNS[view]) return;
    const same = view === state.view && (!appId || appId === state.appId);
    state.view = view;
    if (appId) { state.appId = appId; store.set('appId', appId); }
    state.editingRule = null;
    state.editingDraft = null;
    state.animate = !same;
    renderAll();
    $('#content').scrollTop = 0;
    if (state.live && ['activity', 'rules', 'settings'].includes(view)) loadExtras();
  }

  // ===== Sheets (More menu, quick capture) ==================================
  const sheet = { open: false, returnFocus: null, onClose: null };

  function openSheet(html, { focus, onClose } = {}) {
    sheet.open = true;
    sheet.returnFocus = document.activeElement;
    sheet.onClose = onClose || null;
    $('#sheet-body').innerHTML = html;
    const bd = $('#sheet');
    bd.hidden = false;
    bd.classList.remove('closing');
    requestAnimationFrame(() => {
      const el = (focus && $(focus)) || $('#sheet-panel').querySelector('button, textarea, input');
      if (el) el.focus();
    });
  }

  function closeSheet() {
    if (!sheet.open) return;
    sheet.open = false;
    if (sheet.onClose) sheet.onClose();
    const bd = $('#sheet');
    bd.classList.add('closing');
    setTimeout(() => { bd.hidden = true; bd.classList.remove('closing'); }, reducedMotion.matches ? 0 : 200);
    if (sheet.returnFocus && document.contains(sheet.returnFocus)) sheet.returnFocus.focus();
  }

  function openMore() {
    const L = { apps: 'Apps', tasks: 'Tasks', rules: 'Rules', settings: 'Settings' };
    const sub = {
      apps: `${appList().filter((a) => a.connected).length} connected`,
      tasks: `${state.tasks.filter((t) => t.status !== 'done').length} active`,
      rules: `${Object.values(state.rules).reduce((n, l) => n + l.length, 0)} rules`,
      settings: 'Accounts, tone, limits',
    };
    openSheet(`
      <h2 class="sheet-title" id="sheet-title">More</h2>
      <div class="more-grid">
        ${MORE_VIEWS.map((v) => `
          <button class="more-tile pressable ${state.view === v || (v === 'apps' && state.view === 'app') ? 'active' : ''}" data-action="sheet-nav" data-view="${v}">
            <span class="more-icon">${icon(VIEWS.find((x) => x.id === v).icon)}</span>
            <span class="more-label">${L[v]}</span>
            <span class="more-sub">${sub[v]}</span>
          </button>`).join('')}
      </div>
      <div class="sheet-row">
        <span>Appearance</span>
        <div class="segmented" role="radiogroup" aria-label="Appearance">
          <button role="radio" aria-checked="${!isDark()}" data-action="set-theme" data-theme="light">${icon('sun')}Light</button>
          <button role="radio" aria-checked="${isDark()}" data-action="set-theme" data-theme="dark">${icon('moon')}Dark</button>
        </div>
      </div>`);
  }

  // Quick capture: "Tell Aide something", by text or voice.
  let recognition = null;

  function stopMic() { if (recognition) { recognition.stop(); recognition = null; } }

  function openCapture() {
    openSheet(`
      <h2 class="sheet-title" id="sheet-title">Tell ${esc(M.agent.name)} something</h2>
      <p class="sheet-sub">A reminder, a preference, or something to handle later.</p>
      <form class="capture" data-form="capture">
        <label class="sr-only" for="capture-input">Message</label>
        <textarea id="capture-input" class="capture-input" rows="3" placeholder="e.g. Remind me to call Mom at 7"></textarea>
        <div class="capture-actions">
          <button type="button" class="mic-btn" data-action="mic" aria-pressed="false">${icon('mic')}<span class="mic-label">Speak</span></button>
          <button type="submit" class="btn btn-primary">${icon('send')}Send</button>
        </div>
      </form>`, { focus: '#capture-input', onClose: stopMic });
  }

  // Simulate an incoming message: the backend drafts a reply and queues it in Approvals.
  function openPaste() {
    const opts = Object.entries(M.channels).filter(([id]) => id !== 'calendar')
      .map(([id, c]) => `<option value="${id}">${esc(c.label)}</option>`).join('');
    openSheet(`
      <h2 class="sheet-title" id="sheet-title">Paste a message</h2>
      <p class="sheet-sub">Pretend it just arrived. ${esc(M.agent.name)} will draft a reply and put it in Approvals.</p>
      <form class="capture paste-form" data-form="paste">
        <div class="paste-row">
          <div class="paste-field">
            <label class="field-label" for="paste-channel">Channel</label>
            <select class="select" id="paste-channel">${opts}</select>
          </div>
          <div class="paste-field grow">
            <label class="field-label" for="paste-from">From</label>
            <input class="input" id="paste-from" placeholder="e.g. Professor, Team lead, @maya.designs" autocomplete="off" required />
          </div>
        </div>
        <label class="field-label" for="paste-text">Message</label>
        <textarea id="paste-text" class="capture-input" rows="3" placeholder="Paste the message here" required></textarea>
        <div class="capture-actions">
          <span class="muted paste-note">${state.live ? 'Nothing is sent until you approve.' : 'Needs the Aide server (currently offline).'}</span>
          <button type="submit" class="btn btn-primary">${icon('sparkle')}Draft a reply</button>
        </div>
      </form>`, { focus: '#paste-from' });
  }

  async function submitPaste(form) {
    const channel = $('#paste-channel').value;
    const from = $('#paste-from').value.trim();
    const text = $('#paste-text').value.trim();
    if (!from) { $('#paste-from').focus(); return; }
    if (!text) { $('#paste-text').focus(); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.classList.add('is-busy');
    try {
      const a = await api('/api/messages', { method: 'POST', body: { channel, from, text }, timeout: 60000 });
      if (!state.live) await loadLive({ render: false });
      if (!state.approvals.some((x) => x.id === String(a.id))) state.approvals.push(fromServer(a));
      state.offline = false;
      state.live = true;
      closeSheet();
      refreshStats();
      if (state.view === 'approvals') renderAll(); else go('approvals');
      toast(`Draft ready for ${from} · ${BUCKET_LABEL[a.bucket]}`);
    } catch (e) {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      toast(e.status ? `Couldn't add it: ${e.message}` : "Can't reach the Aide server. Start it and try again.");
    }
  }

  function toggleMic(btn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Voice input isn't supported in this browser"); return; }
    if (recognition) { stopMic(); return; }
    const input = $('#capture-input');
    const base = input.value ? input.value.trimEnd() + ' ' : '';
    recognition = new SR();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.onresult = (e) => { input.value = base + [...e.results].map((r) => r[0].transcript).join(''); };
    recognition.onerror = (e) => { if (e.error !== 'aborted') toast("Couldn't hear that. Try again."); };
    recognition.onend = () => {
      recognition = null;
      btn.classList.remove('listening');
      btn.setAttribute('aria-pressed', 'false');
      btn.querySelector('.mic-label').textContent = 'Speak';
    };
    recognition.start();
    btn.classList.add('listening');
    btn.setAttribute('aria-pressed', 'true');
    btn.querySelector('.mic-label').textContent = 'Listening…';
  }

  // ===== Toasts =============================================================
  function toast(message, opts = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="toast-msg">${esc(message)}</span>${opts.action ? `<button type="button">${esc(opts.action)}</button>` : ''}<button type="button" aria-label="Dismiss">${icon('x')}</button>`;
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 180); };
    const btns = el.querySelectorAll('button');
    if (opts.action) btns[0].addEventListener('click', () => { opts.onAction(); close(); });
    btns[btns.length - 1].addEventListener('click', close);
    // Keep it uncluttered: at most two toasts at once, oldest goes first.
    const live = [...$('#toasts').querySelectorAll('.toast:not(.out)')];
    if (live.length >= 2) live.slice(0, live.length - 1).forEach((t) => { t.classList.add('out'); setTimeout(() => t.remove(), 180); });
    $('#toasts').appendChild(el);
    setTimeout(close, opts.action ? 5000 : 3000);
  }

  // ===== Command palette ====================================================
  const palette = { open: false, index: 0, items: [], returnFocus: null };

  function commands() {
    return [
      ...VIEWS.map((v) => ({ label: `Go to ${v.label}`, icon: v.icon, run: () => go(v.id) })),
      ...Object.entries(M.channels).map(([id, c]) => ({ label: `Open ${c.label}`, icon: 'apps', hint: 'App', run: () => go('app', id) })),
      { label: state.agentActive ? 'Pause agent' : 'Resume agent', icon: state.agentActive ? 'pause' : 'play', run: toggleAgent },
      { label: `Switch to ${isDark() ? 'light' : 'dark'} mode`, icon: isDark() ? 'sun' : 'moon', run: toggleTheme },
      { label: `Tell ${M.agent.name} something`, icon: 'mic', run: openCapture },
      { label: 'Paste a message', icon: 'inbox', run: openPaste },
      { label: 'Add a task', icon: 'plus', run: () => { go('tasks'); $('#task-title').focus(); } },
      { label: 'Add a rule', icon: 'rules', run: () => { go('rules'); $('#add-auto').focus(); } },
      ...M.quickActions.map((q) => ({ label: q, icon: 'chat', hint: 'Ask', run: () => { go('chat'); sendChat(q); } })),
    ];
  }

  function renderPalette() {
    const q = $('#palette-input').value.trim().toLowerCase();
    palette.items = commands().filter((c) => c.label.toLowerCase().includes(q));
    palette.index = Math.min(palette.index, Math.max(palette.items.length - 1, 0));
    $('#palette-list').innerHTML = palette.items.length
      ? palette.items.map((c, i) => `<li class="palette-item" role="option" id="pal-${i}" data-index="${i}" aria-selected="${i === palette.index}">${icon(c.icon)}<span>${esc(c.label)}</span>${c.hint ? `<span class="hint">${c.hint}</span>` : ''}</li>`).join('')
      : `<li class="palette-empty">No matching commands</li>`;
    $('#palette-input').setAttribute('aria-activedescendant', palette.items.length ? `pal-${palette.index}` : '');
    const sel = $(`#pal-${palette.index}`);
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function openPalette() {
    palette.open = true;
    palette.index = 0;
    palette.returnFocus = document.activeElement;
    $('#palette').hidden = false;
    $('#palette-input').value = '';
    renderPalette();
    $('#palette-input').focus();
  }

  function closePalette() {
    palette.open = false;
    $('#palette').hidden = true;
    if (palette.returnFocus && document.contains(palette.returnFocus)) palette.returnFocus.focus();
  }

  function runPaletteItem(i) {
    const cmd = palette.items[i];
    if (!cmd) return;
    palette.returnFocus = null;
    closePalette();
    cmd.run();
  }

  // ===== Actions ============================================================
  function toggleAgent() {
    state.agentActive = !state.agentActive;
    // TODO(api): POST /api/agent/{pause|resume}
    renderAll();
    toast(state.agentActive ? `${M.agent.name} resumed` : `${M.agent.name} paused. Nothing will be sent.`);
  }

  function toggleTheme() {
    state.theme = isDark() ? 'light' : 'dark';
    store.set('theme', state.theme);
    applyTheme();
    renderTopbar();
  }

  const ACTIONS = {
    nav: (el) => go(el.dataset.view),
    more: () => openMore(),
    'sheet-nav': (el) => { closeSheet(); go(el.dataset.view); },
    'set-theme': (el) => {
      state.theme = el.dataset.theme;
      store.set('theme', state.theme);
      applyTheme();
      renderTopbar();
      document.querySelectorAll('[data-action="set-theme"]').forEach((b) => b.setAttribute('aria-checked', b === el));
    },
    capture: () => openCapture(),
    mic: (el) => toggleMic(el),
    suggest: (el) => { go('chat'); sendChat(el.dataset.text); },
    'feed-edit': (el) => { state.editingDraft = el.dataset.id; refreshChatLog(true); },
    'feed-edit-done': () => { state.editingDraft = null; refreshChatLog(true); toast('Draft updated'); },
    'open-app': (el) => go('app', el.dataset.app),
    'app-autonomy': (el) => {
      const acct = state.accounts.find((x) => x.id === el.dataset.app);
      acct.autonomy = el.dataset.level; // TODO(api): PATCH /api/apps/:id { autonomy }
      renderAll();
      toast(`${M.channels[acct.id].label}: ${AUTONOMY[acct.autonomy].label}`);
    },
    'inbox-open': (el) => {
      const item = state.inbox.find((x) => x.id === el.dataset.id);
      item.unread = false; // TODO(api): POST /api/apps/:channel/inbox/:id/read
      renderSidebar();
      renderView();
    },
    'ask-about': (el) => {
      const item = state.inbox.find((x) => x.id === el.dataset.id);
      item.unread = false;
      go('chat');
      sendChat(`Summarize my ${M.channels[item.channel].label} conversation with ${item.from}`, item.channel);
    },
    palette: () => openPalette(),
    'toggle-sidebar': () => { state.collapsed = !state.collapsed; store.set('collapsed', state.collapsed); renderSidebar(); },
    'toggle-theme': toggleTheme,
    'toggle-agent': toggleAgent,
    quick: (el) => sendChat(el.dataset.text),

    approve: (el) => resolveApproval(el.dataset.id, 'approve'),
    reject: (el) => resolveApproval(el.dataset.id, 'reject'),
    'tone-draft': (el) => regenerateLive(el.dataset.id, el.dataset.tone),
    paste: () => openPaste(),
    'retry-live': async (el) => {
      el.disabled = true;
      await loadLive();
      if (state.offline) toast("Still can't reach the Aide server");
      else toast('Connected. Showing live data.');
    },
    'edit-draft': (el) => { const t = $(`#draft-${el.dataset.id}`); t.focus(); t.setSelectionRange(t.value.length, t.value.length); },
    autosend: (el) => {
      const a = state.approvals.find((x) => x.id === el.dataset.id);
      a.autoSend = !a.autoSend; // TODO(api): POST /api/rules { col: 'auto', fromApproval: a.id }
      el.setAttribute('aria-checked', a.autoSend);
      toast(a.autoSend ? 'Similar messages will be auto-sent' : 'Auto-send turned off for this type');
    },

    'undo-activity': (el) => {
      const e = state.activity.find((x) => x.id === el.dataset.id);
      e.status = 'undone'; // TODO(api): POST /api/activity/:id/undo
      renderView();
      toast('Action undone');
    },
    'clear-filters': () => { state.activityFilter = { channel: 'all', status: 'all' }; renderView(); },

    'task-toggle': (el) => {
      const t = state.tasks.find((x) => x.id === el.dataset.id);
      t.status = t.status === 'paused' ? 'scheduled' : 'paused'; // TODO(api): PATCH /api/tasks/:id { status }
      renderView();
      toast(t.status === 'paused' ? 'Task paused' : 'Task resumed');
    },
    'task-delete': (el) => {
      const idx = state.tasks.findIndex((x) => x.id === el.dataset.id);
      const [removed] = state.tasks.splice(idx, 1); // TODO(api): DELETE /api/tasks/:id
      renderView();
      toast('Task removed', { action: 'Undo', onAction: () => { state.tasks.splice(idx, 0, removed); renderView(); } });
    },

    'forget-learned': (el) => {
      api(`/api/learned/${el.dataset.id}`, { method: 'DELETE' })
        .then(() => { state.learned = (state.learned || []).filter((l) => String(l.id) !== el.dataset.id); renderView(); toast('Forgotten. It won’t be used for new drafts.'); })
        .catch((err) => toast(`Couldn't remove it: ${err.message}`));
    },
    'rule-edit': (el) => { state.editingRule = el.dataset.id; renderView(); },
    'rule-delete': (el) => {
      const list = state.rules[el.dataset.col];
      const idx = list.findIndex((r) => r.id === el.dataset.id);
      const [removed] = list.splice(idx, 1);
      syncRules();
      renderView();
      toast('Rule removed', { action: 'Undo', onAction: () => { list.splice(idx, 0, removed); syncRules(); renderView(); } });
    },

    'account-toggle': (el) => {
      const a = state.accounts.find((x) => x.id === el.dataset.id);
      // TODO(api): start OAuth for connect (GET /api/accounts/:id/connect) or POST /api/accounts/:id/disconnect
      a.connected = !a.connected;
      if (a.connected && !a.detail) a.detail = 'Connected just now';
      if (a.connected && a.autonomy === 'off') a.autonomy = 'ask';
      renderAll();
      toast(`${a.name} ${a.connected ? 'connected' : 'disconnected'}`);
    },
    tone: (el) => { state.settings.tone = el.dataset.tone; renderView(); /* TODO(api): PATCH /api/settings { tone } */ },
    notif: (el) => {
      const n = state.settings.notifications.find((x) => x.id === el.dataset.id);
      n.on = !n.on; // TODO(api): PATCH /api/settings/notifications/:id
      el.setAttribute('aria-checked', n.on);
    },
  };

  // ===== Events =============================================================
  document.addEventListener('click', (e) => {
    // Clicking a switch's text label toggles the switch.
    const lbl = e.target.closest('[data-for]');
    if (lbl) { $('#' + lbl.dataset.for).click(); return; }
    const el = e.target.closest('[data-action]');
    if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el);
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;

    if (kind === 'chat') {
      const input = $('#chat-input');
      sendChat(input.value);
      input.value = '';
      input.style.height = '';
      input.focus();
    }

    if (kind === 'capture') {
      const text = $('#capture-input').value.trim();
      if (!text) { $('#capture-input').focus(); return; }
      stopMic();
      // TODO(api): POST /api/capture { text } (reminders, preferences, to-dos)
      state.messages.push({ id: uid(), role: 'user', day: 'Today', text, time: nowTime() });
      state.messages.push({ id: uid(), role: 'agent', day: 'Today', text: "Got it. I'll take care of that and let you know if I need anything.", time: nowTime() });
      closeSheet();
      if (state.view === 'chat') refreshChatLog();
      toast(`Sent to ${M.agent.name}`, { action: 'View', onAction: () => go('chat') });
    }

    if (kind === 'paste') submitPaste(form);

    if (kind === 'task') {
      const title = $('#task-title').value.trim();
      if (!title) { $('#task-title').focus(); return; }
      const when = $('#task-when').value.trim() || 'Whenever it comes up';
      state.tasks.unshift({ id: uid(), title, when, status: 'scheduled' }); // TODO(api): POST /api/tasks
      renderView();
      $('#task-title').focus();
      toast('Task added');
    }

    if (kind === 'profile') {
      const body = { formOfAddress: $('#pf-address').value.trim(), availability: $('#pf-availability').value.trim() };
      if (!body.formOfAddress || !body.availability) { toast('Please fill in both fields'); return; }
      api('/api/profile', { method: 'PATCH', body })
        .then((p) => { state.profile = p; renderView(); toast('Saved. New drafts will use this.'); })
        .catch((err) => toast(`Couldn't save: ${err.message}`));
    }

    if (kind === 'rule') {
      const col = form.dataset.col;
      const input = $(`#add-${col}`);
      const text = input.value.trim();
      if (!text) return;
      state.rules[col].push({ id: uid(), text });
      syncRules();
      renderView();
      $(`#add-${col}`).focus();
      toast(`Rule added to ${RULE_COLS.find((c) => c.key === col).title}`);
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'chat-input') { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }
    if (t.dataset.input === 'draft') { const a = state.approvals.find((x) => x.id === t.dataset.id); if (a) a.draft = t.value; }
    if (t.dataset.input === 'limit') { state.settings.dailyLimit = +t.value; $('#limit-value').textContent = `${t.value} / day`; }
    if (t.id === 'palette-input') { palette.index = 0; renderPalette(); }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.filter) { state.activityFilter[t.dataset.filter] = t.value; renderView(); $('#' + t.id).focus(); }
    if (t.dataset.input === 'draft') saveDraft(t.dataset.id); // fires on blur after an edit
    if (t.dataset.input === 'limit') { /* TODO(api): PATCH /api/settings { dailyLimit } */ toast(`Daily limit set to ${t.value}`); }
  });

  document.addEventListener('focusout', (e) => {
    if (e.target.dataset && e.target.dataset.input === 'rule-edit' && state.editingRule) saveRuleEdit(e.target);
  });

  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+K: command palette
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palette.open ? closePalette() : openPalette();
      return;
    }

    if (sheet.open) {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
      // Cmd/Ctrl+Enter sends a quick capture
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'capture-input') { e.preventDefault(); e.target.form.requestSubmit(); return; }
    }

    // Card-sized buttons (e.g. the Home hero) respond to Enter/Space like real buttons.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button' && e.target.dataset.action) {
      e.preventDefault();
      e.target.click();
      return;
    }

    if (palette.open) {
      if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); palette.index = (palette.index + 1) % Math.max(palette.items.length, 1); renderPalette(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palette.index = (palette.index - 1 + palette.items.length) % Math.max(palette.items.length, 1); renderPalette(); }
      else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(palette.index); }
      else if (e.key === 'Tab') { e.preventDefault(); $('#palette-input').focus(); } // keep focus trapped
      return;
    }

    // Enter sends chat, Shift+Enter adds a newline
    if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }

    // Enter saves / Escape cancels inline rule edit
    if (e.target.dataset && e.target.dataset.input === 'rule-edit') {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Escape') { state.editingRule = null; renderView(); }
    }
  });

  $('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });
  $('#palette-list').addEventListener('click', (e) => { const li = e.target.closest('[data-index]'); if (li) runPaletteItem(+li.dataset.index); });
  $('#palette-list').addEventListener('mousemove', (e) => {
    const li = e.target.closest('[data-index]');
    if (!li || +li.dataset.index === palette.index) return;
    palette.index = +li.dataset.index;
    document.querySelectorAll('.palette-item').forEach((n) => n.setAttribute('aria-selected', n === li));
    $('#palette-input').setAttribute('aria-activedescendant', li.id);
  });

  $('#sheet').addEventListener('mousedown', (e) => { if (e.target.id === 'sheet') closeSheet(); });

  // ===== Swipe (touch): right = approve, left = skip ========================
  // Pointer events on the card; a colored reveal sits behind it. Releasing past the
  // threshold commits; otherwise the card springs back (CSS --spring easing).
  const swipe = { el: null, wrap: null, id: null, x0: 0, y0: 0, dx: 0, active: false, pid: null };

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.button !== 0) return;
    const card = e.target.closest('.approval[data-card]');
    if (!card || e.target.closest('button, textarea, input, select, a, label')) return;
    const id = card.dataset.card;
    if (state.sending[id] || state.regenerating[id]) return;
    Object.assign(swipe, { el: card, wrap: card.parentElement, id, x0: e.clientX, y0: e.clientY, dx: 0, active: false, pid: e.pointerId });
  });

  document.addEventListener('pointermove', (e) => {
    if (!swipe.el || e.pointerId !== swipe.pid) return;
    const dx = e.clientX - swipe.x0;
    const dy = e.clientY - swipe.y0;
    if (!swipe.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe.el = null; return; } // vertical scroll wins
      if (Math.abs(dx) < 10) return;
      swipe.active = true;
      swipe.el.setPointerCapture(e.pointerId);
      swipe.el.classList.add('is-dragging');
    }
    swipe.dx = dx;
    swipe.el.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
    swipe.wrap.dataset.dir = dx > 0 ? 'right' : 'left';
    swipe.wrap.style.setProperty('--reveal', Math.min(Math.abs(dx) / 120, 1).toFixed(2));
  });

  function endSwipe(e) {
    if (!swipe.el || (e && e.pointerId !== swipe.pid)) return;
    const { el, wrap, id, dx, active } = swipe;
    swipe.el = null;
    if (!active) return;
    el.classList.remove('is-dragging');
    const commit = Math.abs(dx) > Math.min(120, el.offsetWidth * 0.33);
    if (commit && e && e.type === 'pointerup') {
      const dir = dx > 0 ? 1 : -1;
      el.style.transform = `translateX(${dir * (el.offsetWidth + 40)}px) rotate(${dir * 8}deg)`;
      el.classList.add('flung');
      setTimeout(() => {
        el.style.transform = '';
        el.classList.remove('flung');
        wrap.style.removeProperty('--reveal');
        resolveApproval(id, dir > 0 ? 'approve' : 'reject');
      }, 220);
    } else {
      el.classList.add('snap-back');
      el.style.transform = '';
      wrap.style.setProperty('--reveal', '0');
      setTimeout(() => el.classList.remove('snap-back'), 600);
    }
  }
  document.addEventListener('pointerup', endSwipe);
  document.addEventListener('pointercancel', endSwipe);

  // ===== Live data ==========================================================
  // Load pending approvals + stats from the backend. Falls back to mock data if unreachable.
  async function loadLive({ render = true } = {}) {
    try {
      const [pending, stats] = await Promise.all([api('/api/approvals?status=pending', { timeout: 4000 }), api('/api/stats', { timeout: 4000 })]);
      const wasLive = state.live;
      const local = new Map(state.approvals.map((a) => [a.id, a]));
      const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.input === 'draft' ? document.activeElement.dataset.id : null;
      const next = pending.map((p) => {
        const a = fromServer(p);
        const old = wasLive && local.get(a.id);
        if (old && (old.id === focused || state.regenerating[a.id])) a.draft = old.draft; // don't clobber typing
        return a;
      });
      // Keep cards that are mid-send (the server no longer lists them as pending).
      if (wasLive) state.approvals.filter((a) => state.sending[a.id]).forEach((a) => { if (!next.some((n) => n.id === a.id)) next.push(a); });
      next.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || (+a.id - +b.id));
      const changed = !wasLive || JSON.stringify(next.map((a) => [a.id, a.draft, a.bucket])) !== JSON.stringify(state.approvals.map((a) => [a.id, a.draft, a.bucket]));
      const statsChanged = JSON.stringify(stats) !== JSON.stringify(state.stats);
      state.approvals = next;
      state.stats = stats;
      state.live = true;
      if (!wasLive) loadExtras();
      const wasOffline = state.offline;
      state.offline = false;
      if (render && (changed || statsChanged || wasOffline) && !focused) renderAll();
    } catch (e) {
      if (!state.live) {
        state.offline = true;
        if (render) renderAll();
      }
    }
  }

  // Activity history, rules, profile and learned replies. Loaded when going live and
  // when one of those screens opens (they change rarely, so no 10s polling).
  function dayLabel(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d)) return 'Earlier';
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }

  async function loadExtras() {
    try {
      const [activity, rules, profile, learned] = await Promise.all([
        api('/api/activity'), api('/api/rules'), api('/api/profile'), api('/api/learned'),
      ]);
      state.activity = activity.map((a) => ({
        id: 'h' + a.id,
        type: 'reply',
        channel: M.channels[a.channel] ? a.channel : 'gmail',
        status: a.status,
        at: a.at,
        time: fmtWhen(a.at),
        text: a.status === 'sent' ? `Sent your reply to ${a.from}` : `Skipped the draft for ${a.from}`,
        detail: a.text,
        learned: a.learned,
        transport: a.transport,
        undoable: false,
      }));
      state.liveActivity = true;
      if (state.editingRule === null) {
        state.rules = Object.fromEntries(['auto', 'ask', 'never'].map((k) => [k, rules[k].map((text) => ({ id: uid(), text }))]));
        state.liveRules = true;
      }
      state.hardRules = rules.hardRules || [];
      state.profile = profile;
      state.learned = learned;
      if (['activity', 'rules', 'settings'].includes(state.view) && !document.activeElement.matches('input, textarea')) renderView();
    } catch (e) { /* stay on sample data for these screens */ }
  }

  // Save the three rule lists to rules.json. On failure, reload what the server has.
  async function syncRules() {
    if (!state.liveRules) return;
    try {
      await api('/api/rules', { method: 'PUT', body: Object.fromEntries(['auto', 'ask', 'never'].map((k) => [k, state.rules[k].map((r) => r.text)])) });
    } catch (e) {
      toast(`Couldn't save the rule: ${e.message}`);
      loadExtras();
    }
  }

  systemDark.addEventListener('change', () => { if (!state.theme) { applyTheme(); renderTopbar(); } });

  // ===== Boot ===============================================================
  applyTheme();
  renderAll();
  if (new URLSearchParams(location.search).get('capture')) openCapture(); // home-screen shortcut
  // Live data: first load, then refresh every 10s while the tab is visible (new messages show up).
  loadLive();
  setInterval(() => { if (!document.hidden && !sheet.open && !swipe.active) loadLive(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadLive(); });

  // Offline support + installability. Service workers need http(s), so skip on file://.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
