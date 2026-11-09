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
      // A phone on the Wi-Fi that isn't paired yet: show the PIN screen.
      if (res.status === 401 && data && data.detail === 'pair' && !state.needsPair) {
        state.needsPair = true;
        renderAll();
      }
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
    urgent: !!a.urgent,
    snoozeUntil: a.snoozeUntil,
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
    food: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7c0-1.2.8-1.8.8-3M12 7c0-1.2.8-1.8.8-3M16 7c0-1.2.8-1.8.8-3"/>',
    minus: '<path d="M5 12h14"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6a5 5 0 0 1 5.5 5.4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
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
    { id: 'food', label: 'Food', icon: 'food' },
    { id: 'study', label: 'Study', icon: 'book' },
    { id: 'tasks', label: 'Tasks', icon: 'tasks' },
    { id: 'people', label: 'People', icon: 'people' },
    { id: 'rules', label: 'Rules', icon: 'rules' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  // Mobile bottom bar: 5 items, Chat in the middle. Everything else lives under More.
  const TABS = ['home', 'approvals', 'chat', 'activity', 'more'];
  const MORE_VIEWS = ['study', 'tasks', 'food', 'people', 'apps', 'rules', 'settings'];

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
    brief: null, // /api/brief: what needs you today, deadlines, quiet mode
    deadlines: null, // /api/deadlines (Tasks screen)
    seenPending: null, // approval ids already seen, to spot new drafts for notifications
    needsPair: false, // a phone on the Wi-Fi that hasn't entered the PIN yet
    lan: null, // phone access info (only answered on the computer running Aide)
    weekly: null, // /api/weekly (Activity screen)
    study: null, // /api/study
    people: null, // /api/people
    peopleFilter: '',
    snoozed: null, // replies you asked to be reminded about later
    autosend: null,
    pendingRestore: null,
    wasQuiet: false,
    // Food: carts planned and checked in Aide, then placed by Claude with the official connector.
    food: { orders: null, profile: null, app: null, busy: false, showPrefs: false },
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
        <button class="icon-btn talk-btn" data-action="talk-open" aria-label="Talk to ${esc(M.agent.name)}" title="Talk to ${esc(M.agent.name)}">${icon('mic')}</button>
        <button class="icon-btn" data-action="search-open" aria-label="Search" title="Search">${icon('search')}</button>
        ${quiet().active ? `<button class="status quiet" data-action="quiet-open" title="Quiet mode until ${esc(fmtClock(quiet().until))}">${icon('moon')}<span class="desktop-only">Quiet</span></button>` : ''}
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

        ${briefCard()}

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
            ${micButton('#chat-input')}
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
            ${state.live && voiceSupported() ? `<button class="chip chip-sm pressable voice-chip ${regen === 'voice' ? 'is-busy' : ''}" data-action="voice-edit" data-id="${a.id}" aria-pressed="false" title="Say how to change this draft" ${regen ? 'disabled' : ''}>${icon('mic')}Say a change</button>` : ''}
          </div>` : switchEl('auto-' + a.id, a.autoSend, 'Always auto-send this type', `data-action="autosend" data-id="${a.id}"`)}
          <div class="actions">
            ${state.live ? `<button class="btn btn-ghost" data-action="snooze-open" data-id="${a.id}" title="Remind me later">${icon('clock')}Later</button>` : ''}
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
          ${snoozedSection()}
        </div>`;
    }
    return `
      <div class="page">
        ${offlineBanner()}
        <div class="page-head">
          <p class="page-sub">${waiting ? `${waiting} ${waiting === 1 ? 'draft is' : 'drafts are'} waiting for your review. Edit any reply before sending.` : 'Sending your replies…'}</p>
          <div class="page-head-actions">
            ${state.live && waiting ? `<button class="btn btn-secondary btn-sm" data-action="talk-replies">${icon('mic')}Go through by voice</button>` : ''}
            ${pasteBtn}
          </div>
        </div>
        <p class="swipe-hint mobile-only">Swipe right to approve, left to skip.</p>
        <div class="stack" data-stagger>${state.approvals.map(approvalCard).join('')}</div>
        ${snoozedSection()}
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
        ${weeklyCard()}
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
        ${e.auto ? '<span class="pill s-scheduled" title="Sent by auto-send">Auto-sent</span>' : ''}
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
    if (state.live && state.deadlines) return viewDeadlines(); // real deadlines from the server
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
  // ===== Brief, deadlines, quiet mode, notifications ========================
  const DL_ICON = { exam: 'flag', assignment: 'tasks', meeting: 'calendar', payment: 'inbox', other: 'clock' };
  const KIND_NAME = { exam: 'Exam', assignment: 'Due', meeting: 'Meeting', payment: 'Payment', other: 'Task' };
  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); };
  const fmt12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const fmtDay = (iso) => new Date(`${iso}T00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtClock = (isoStr) => new Date(isoStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  function dlWhen(d) {
    const day = d.dueDate === localDate() ? 'Today' : d.dueDate === addDays(1) ? 'Tomorrow' : fmtDay(d.dueDate);
    return d.dueTime ? `${day}, ${fmt12(d.dueTime)}` : day;
  }

  async function loadDeadlines() {
    try {
      state.deadlines = await api('/api/deadlines?include_done=true');
      if (state.view === 'tasks' && !document.activeElement.matches('input, select')) renderView();
    } catch (e) { /* keep sample tasks */ }
  }

  const quiet = () => (state.brief && state.brief.quiet) || { active: false, allow: [], held: 0 };

  function briefCard() {
    const b = state.brief;
    if (!state.live || !b) return '';
    const q = quiet();
    const item = (d, overdue) => `
      <li class="brief-item ${overdue ? 'is-overdue' : ''}">
        <span class="bi-icon k-${d.kind}">${icon(DL_ICON[d.kind] || 'clock')}</span>
        <span class="bi-title">${esc(d.title)}</span>
        <span class="bi-when">${esc(overdue ? fmtDay(d.dueDate) : (d.dueTime ? fmt12(d.dueTime) : KIND_NAME[d.kind]))}</span>
      </li>`;
    const groups = [['Overdue', b.overdue, true], ['Today', b.today], ['Tomorrow', b.tomorrow]].filter((g) => g[1].length);
    return `
      <section class="card brief" aria-labelledby="brief-h">
        <div class="brief-head">
          <h3 id="brief-h">${icon('calendar')}Today</h3>
          ${q.active ? `<span class="pill s-scheduled">${icon('moon')}Quiet until ${esc(fmtClock(q.until))}</span>` : ''}
        </div>
        <p class="brief-headline">${esc(b.headline)}</p>
        ${b.urgent.length ? `
          <button class="brief-urgent" data-action="nav" data-view="approvals">${icon('alert')}<span>Urgent: ${esc(b.urgent.map((u) => u.from).join(', '))}</span>${icon('chevron')}</button>` : ''}
        ${groups.map(([label, list, overdue]) => `
          <div class="brief-group">
            <div class="brief-label">${label}</div>
            <ul>${list.slice(0, 4).map((d) => item(d, overdue)).join('')}</ul>
          </div>`).join('')}
        ${b.study && b.study.length ? `
          <div class="brief-group">
            <div class="brief-label">Study today</div>
            <ul>${b.study.slice(0, 4).map((x) => `
              <li class="brief-item ${x.done ? 'is-done' : ''}">
                <span class="bi-icon k-exam">${icon(x.done ? 'check' : 'book')}</span>
                <span class="bi-title">${esc(x.subject)}: ${esc(x.topic)}</span>
                <span class="bi-when">${fmtMinsLong(x.minutes)}</span>
              </li>`).join('')}</ul>
          </div>` : ''}
        ${b.snoozed ? `<button class="brief-link" data-action="nav" data-view="approvals">${icon('clock')}${b.snoozed} snoozed repl${b.snoozed === 1 ? 'y' : 'ies'} coming back later</button>` : ''}
        ${b.thisWeek.length ? `<button class="brief-link" data-action="nav" data-view="tasks">${icon('tasks')}${b.thisWeek.length} more this week</button>` : ''}
        ${b.foodOpen ? `<button class="brief-link" data-action="nav" data-view="food">${icon('food')}${b.foodOpen} food cart${b.foodOpen === 1 ? '' : 's'} waiting for you</button>` : ''}
        <div class="brief-actions">
          <button class="btn btn-ghost btn-sm" data-action="nav" data-view="tasks">${icon('tasks')}Deadlines</button>
          ${q.active
            ? `<button class="btn btn-secondary btn-sm" data-action="quiet-off">${icon('sun')}End quiet mode${q.held ? ` (${q.held} waiting)` : ''}</button>`
            : `<button class="btn btn-secondary btn-sm" data-action="quiet-open">${icon('moon')}Quiet mode</button>`}
        </div>
      </section>`;
  }

  function viewDeadlines() {
    const key = (d) => `${d.dueDate} ${d.dueTime || '99:99'}`;
    const all = [...state.deadlines].sort((a, b) => key(a).localeCompare(key(b)) || a.id - b.id);
    const today = localDate(), tomorrow = addDays(1), weekEnd = addDays(7);
    const open = all.filter((d) => !d.done);
    const done = all.filter((d) => d.done);
    const groups = [
      ['Overdue', open.filter((d) => d.dueDate < today), 'is-overdue'],
      ['Today', open.filter((d) => d.dueDate === today)],
      ['Tomorrow', open.filter((d) => d.dueDate === tomorrow)],
      ['This week', open.filter((d) => d.dueDate > tomorrow && d.dueDate <= weekEnd)],
      ['Later', open.filter((d) => d.dueDate > weekEnd)],
    ].filter((g) => g[1].length);
    const row = (d) => `
      <div class="row dl-row ${d.done ? 'is-done' : ''}" role="listitem">
        <button class="dl-check" role="checkbox" aria-checked="${d.done}" data-action="dl-done" data-id="${d.id}" aria-label="Mark ${esc(d.title)} ${d.done ? 'not done' : 'done'}">${d.done ? icon('check') : ''}</button>
        <span class="bi-icon k-${d.kind}">${icon(DL_ICON[d.kind] || 'clock')}</span>
        <div class="row-main">
          <div class="row-title">${esc(d.title)}</div>
          <div class="row-sub">${esc(KIND_NAME[d.kind])} · ${esc(dlWhen(d))}${d.source === 'message' ? ` · from ${esc(d.sender)}` : ''}</div>
        </div>
        <button class="icon-btn sm" data-action="dl-delete" data-id="${d.id}" aria-label="Remove ${esc(d.title)}">${icon('trash')}</button>
      </div>`;
    return `
      <div class="page">
        <p class="page-sub">Exams, deadlines, meetings and payments. ${esc(M.agent.name)} adds them when a message mentions one ("report due Monday", "viva on 12th"), and you can add your own.</p>
        <form class="card dl-form" data-form="deadline">
          <div class="with-mic dl-title-wrap"><input class="input dl-title" id="dl-title" name="title" maxlength="120" placeholder="e.g. DBMS end-sem exam" aria-label="What's due" autocomplete="off" required />${micButton('#dl-title')}</div>
          <select class="select" name="kind" aria-label="Type">
            ${Object.entries(KIND_NAME).map(([k, l]) => `<option value="${k}" ${k === 'exam' ? 'selected' : ''}>${l === 'Due' ? 'Assignment' : l}</option>`).join('')}
          </select>
          <input class="input" type="date" name="dueDate" value="${tomorrow}" min="${today}" aria-label="Date" required />
          <input class="input" type="time" name="dueTime" aria-label="Time (optional)" />
          <button class="btn btn-primary" type="submit">${icon('plus')}Add</button>
        </form>
        ${groups.length ? groups.map(([label, list, cls]) => `
          <section class="section dl-group ${cls || ''}">
            <div class="section-head"><h2>${label}</h2></div>
            <div class="list" role="list">${list.map(row).join('')}</div>
          </section>`).join('')
          : emptyState('tasks', 'Nothing due', `When a message mentions a deadline, ${M.agent.name} adds it here. You can also add one above.`)}
        ${done.length ? `
          <details class="dl-done">
            <summary>${done.length} done</summary>
            <div class="list" role="list">${done.slice(0, 30).map(row).join('')}</div>
          </details>` : ''}
      </div>`;
  }

  function quietEnd(choice) {
    const d = new Date();
    if (choice === 'morning') {
      const [h, m] = state.notify.briefTime.split(':').map(Number);
      d.setDate(d.getDate() + 1);
      d.setHours(h, m, 0, 0);
    } else {
      d.setMinutes(d.getMinutes() + Number(choice));
    }
    return d;
  }

  function openQuiet() {
    const q = quiet();
    const opts = [['60', '1 hour'], ['120', '2 hours'], ['180', '3 hours'], ['morning', 'Until tomorrow morning']];
    openSheet(`
      <h2 class="sheet-title" id="sheet-title">Quiet mode</h2>
      <p class="sheet-sub">For study time. ${esc(M.agent.name)} keeps drafting, but only urgent messages and the people below can notify you. You get one summary when it ends.</p>
      <div class="more-grid quiet-opts">
        ${opts.map(([v, l]) => `
          <button class="more-tile pressable" data-action="quiet-start" data-until="${v}">
            <span class="more-icon">${icon('moon')}</span><span class="more-label">${l}</span>
            <span class="more-sub">until ${esc(quietEnd(v).toLocaleString([], { weekday: v === 'morning' ? 'short' : undefined, hour: 'numeric', minute: '2-digit' }))}</span>
          </button>`).join('')}
      </div>
      <form class="quiet-allow" data-form="quiet-allow">
        <label class="field-label" for="quiet-allow">Always let these people through (comma-separated)</label>
        <div class="rule-add">
          <input id="quiet-allow" class="input" maxlength="300" value="${esc(q.allow.join(', '))}" placeholder="e.g. Mom, Professor" autocomplete="off" />
          <button class="btn btn-secondary btn-sm" type="submit">Save</button>
        </div>
        <p class="sheet-sub">Messages with words like "urgent", "asap" or "emergency" always come through.</p>
      </form>`);
  }

  async function setQuiet(body, msg) {
    try {
      const q = await api('/api/quiet', { method: 'PUT', body });
      if (state.brief) state.brief.quiet = q;
      state.wasQuiet = q.active;
      renderAll();
      if (msg) toast(typeof msg === 'function' ? msg(q) : msg);
      loadLive();
      return q;
    } catch (e) { toast(`Couldn't change quiet mode: ${e.message}`); return null; }
  }

  // Notifications: shown while Aide is open (a tab or the installed app). Settings are per device.
  const NOTIFY_DEFAULTS = { on: false, drafts: true, deadlines: true, brief: true, briefTime: '08:00' };
  state.notify = { ...NOTIFY_DEFAULTS, ...store.get('notify', {}) };
  const saveNotify = () => store.set('notify', state.notify);
  const canNotify = () => 'Notification' in window && Notification.permission === 'granted' && state.notify.on;

  // force: show a system notification even while you're looking at Aide (the test button).
  function notify(title, body, { tag, view = 'home', important = false, force = false } = {}) {
    if (!canNotify()) return;
    if (quiet().active && !important) return; // quiet mode: only urgent things get through
    if (!force && document.visibilityState === 'visible' && document.hasFocus()) { toast(`${title}: ${body}`); return; }
    const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { view }, renotify: !!tag };
    const fallback = () => { const n = new Notification(title, opts); n.onclick = () => { window.focus(); go(view); n.close(); }; };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((r) => r.showNotification(title, opts)).catch(fallback);
    } else fallback();
  }

  // New drafts since the last refresh (called from loadLive).
  function notifyNewDrafts(pending) {
    const ids = new Set(pending.map((p) => String(p.id)));
    if (state.seenPending) {
      const fresh = pending.filter((p) => !state.seenPending.has(String(p.id)));
      const urgent = fresh.filter((p) => p.urgent);
      const normal = fresh.filter((p) => !p.urgent);
      urgent.forEach((p) => notify(`Urgent: ${p.from}`, p.original.slice(0, 140), { tag: `a${p.id}`, view: 'approvals', important: true }));
      if (normal.length && state.notify.drafts) {
        notify(normal.length === 1 ? `Reply ready for ${normal[0].from}` : `${normal.length} replies ready`,
          normal.length === 1 ? normal[0].draft.slice(0, 140) : normal.map((p) => p.from).join(', '), { tag: 'drafts', view: 'approvals' });
      }
    }
    state.seenPending = ids;
  }

  // Runs every 30s: morning brief, deadlines within the hour, end of quiet mode.
  function scheduleTick() {
    if (!state.live || !state.brief) return;
    const now = new Date();
    const today = localDate(now);
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const b = state.brief;
    if (state.notify.brief && hhmm >= state.notify.briefTime && store.get('briefNotified') !== today) {
      store.set('briefNotified', today);
      const due = [...b.today, ...b.tomorrow.filter((d) => d.kind === 'exam')].map((d) => d.title);
      notify(`Good ${partOfDay()}, ${M.user.name}`, `${b.headline}${due.length ? ` · ${due.slice(0, 3).join(', ')}` : ''}`, { tag: 'brief', view: 'home' });
    }
    if (state.notify.deadlines) {
      const sent = new Set(store.get('dlNotified', []));
      b.today.filter((d) => d.dueTime).forEach((d) => {
        const mins = Math.round((new Date(`${d.dueDate}T${d.dueTime}`) - now) / 60000);
        const key = `${d.id}@${d.dueDate}`;
        if (mins > 0 && mins <= 60 && !sent.has(key)) {
          sent.add(key);
          notify(`${KIND_NAME[d.kind]} in ${mins} min`, d.title, { tag: `d${d.id}`, view: 'tasks', important: d.kind === 'exam' });
        }
      });
      store.set('dlNotified', [...sent].slice(-200));
    }
    const q = b.quiet;
    if (state.wasQuiet && !q.active) {
      notify('Quiet mode is over', b.pending ? `${b.pending} ${b.pending === 1 ? 'reply is' : 'replies are'} waiting for you` : 'Nothing is waiting for you.', { tag: 'quiet', view: 'approvals', important: true });
    }
    state.wasQuiet = q.active;
  }
  setInterval(scheduleTick, 30000);

  function notificationsSection() {
    const n = state.notify;
    const supported = 'Notification' in window;
    const perm = supported ? Notification.permission : 'unsupported';
    const sw = (key, label, sub) => `
      <div class="row">
        <div class="row-main"><div class="row-title" id="np-${key}">${label}</div><div class="row-sub">${sub}</div></div>
        <button class="switch" role="switch" aria-checked="${n[key]}" aria-labelledby="np-${key}" data-action="notif-pref" data-key="${key}" ${n.on ? '' : 'disabled'}></button>
      </div>`;
    const q = quiet();
    return `
      <section class="section" aria-labelledby="s-alerts">
        <div class="section-head"><h2 id="s-alerts">Notifications</h2><p>Alerts while ${esc(M.agent.name)} is open, in a tab or installed as an app. Saved on this device.</p></div>
        <div class="card notif-status">
          ${!supported ? `<span>${icon('info')}This browser can't show notifications.</span>`
            : perm === 'denied' ? `<span>${icon('alert')}Notifications are blocked for this site. Allow them in your browser's site settings, then come back.</span>`
            : n.on && perm === 'granted' ? `<span class="ok">${icon('check')}Notifications are on.</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-action="notif-test">Send a test</button><button class="btn btn-ghost btn-sm" data-action="notif-off">Turn off</button>`
            : `<span>${icon('info')}Get alerts for new replies, deadlines and your morning brief.</span><span class="spacer"></span><button class="btn btn-primary btn-sm" data-action="notif-enable">Turn on notifications</button>`}
        </div>
        <div class="list">
          ${sw('drafts', 'New replies to review', 'When a draft is ready. Urgent ones always come through.')}
          ${sw('deadlines', 'Deadline reminders', 'An hour before anything with a time, like an exam or meeting.')}
          ${sw('brief', 'Morning brief', 'What needs you and what\'s due, once a day.')}
          <div class="row">
            <div class="row-main"><div class="row-title"><label for="brief-time">Brief time</label></div><div class="row-sub">Also when "Until tomorrow morning" quiet mode ends.</div></div>
            <input class="input brief-time" type="time" id="brief-time" value="${n.briefTime}" />
          </div>
        </div>
      </section>
      <section class="section" aria-labelledby="s-quiet">
        <div class="section-head"><h2 id="s-quiet">Quiet mode</h2><p>For study time: drafts keep coming, alerts stay silent except urgent ones and the people you choose.</p></div>
        <div class="card notif-status">
          ${q.active
            ? `<span class="ok">${icon('moon')}On until ${esc(fmtClock(q.until))}${q.held ? `, ${q.held} waiting` : ''}.</span><span class="spacer"></span><button class="btn btn-secondary btn-sm" data-action="quiet-off">End now</button>`
            : `<span>${icon('moon')}Off.${q.allow.length ? ` Always allowed: ${esc(q.allow.join(', '))}.` : ''}</span><span class="spacer"></span><button class="btn btn-primary btn-sm" data-action="quiet-open">Start quiet mode</button>`}
        </div>
      </section>`;
  }

  // ===== Study planner ======================================================
  async function loadStudy() {
    try {
      state.study = await api('/api/study');
      if (state.view === 'study' && !document.activeElement.matches('input, textarea, select')) renderView();
    } catch (e) { /* shows the offline state */ }
  }

  async function studyCall(path, opts, msg) {
    try {
      state.study = await api(path, opts);
      renderView();
      if (msg) toast(msg);
      loadLive();
    } catch (e) { toast(`Couldn't update the plan: ${e.message}`); }
  }

  const fmtMinsLong = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
  const daysUntil = (iso) => Math.round((new Date(`${iso}T00:00`) - new Date(`${localDate()}T00:00`)) / 86400000);

  function sessionRow(s) {
    return `
      <li class="st-session ${s.done ? 'is-done' : ''} ${s.kind === 'revision' ? 'is-revision' : ''}">
        <button class="dl-check" role="checkbox" aria-checked="${s.done}" data-action="study-done" data-id="${s.id}" aria-label="${s.done ? 'Not done' : 'Done'}: ${esc(s.subject)}, ${esc(s.topic)}">${s.done ? icon('check') : ''}</button>
        <span class="st-subject">${esc(s.subject)}</span>
        <span class="st-topic">${esc(s.topic)}</span>
        <span class="st-mins">${fmtMinsLong(s.minutes)}</span>
      </li>`;
  }

  function viewStudy() {
    if (!state.live) return `<div class="page">${emptyState('book', 'The study planner needs the Aide server', 'Start Aide with start.cmd, then open Study again.')}</div>`;
    const s = state.study;
    if (!s) return `<div class="page"><p class="page-sub">Loading your plan…</p></div>`;
    const today = localDate();
    const upcoming = s.sessions.filter((x) => x.day > today);
    const days = [...new Set(upcoming.map((x) => x.day))].slice(0, 14);
    const daily = s.settings.dailyMinutes;
    const subjectStats = (sub) => {
      const mine = s.sessions.filter((x) => x.subjectId === sub.id && x.kind === 'study');
      const done = mine.filter((x) => x.done).length;
      return { done, total: mine.length };
    };
    return `
      <div class="page study-page">
        <p class="page-sub">Add each exam and its topics. ${esc(M.agent.name)} spreads them over the days before, keeps the day before each exam for full revision, and moves anything you miss forward.</p>
        ${s.suggestions.length ? `
          <div class="card st-suggest">${icon('sparkle')}<span>Exams found in your messages:</span>
            ${s.suggestions.map((x) => `<button class="chip pressable" data-action="study-suggest" data-title="${esc(x.title)}" data-date="${esc(x.dueDate)}">${icon('plus')}${esc(x.title.slice(0, 40))} · ${esc(fmtDay(x.dueDate))}</button>`).join('')}
          </div>` : ''}


        ${s.warnings.map((w) => `<div class="chk warn">${icon('alert')}<span>${esc(w)}</span></div>`).join('')}

        ${s.subjects.length ? `
          <section class="card st-today" aria-labelledby="st-today-h">
            <div class="chart-head"><h3 id="st-today-h">Today</h3><span class="muted">${fmtMinsLong(s.today.filter((x) => !x.done).reduce((n, x) => n + x.minutes, 0))} left</span></div>
            ${s.today.length ? `<ul class="st-list">${s.today.map(sessionRow).join('')}</ul>` : `<p class="muted">Nothing planned today. Rest, or add a subject.</p>`}
          </section>

          ${days.length ? `
            <section class="section" aria-labelledby="st-next-h">
              <div class="section-head"><h2 id="st-next-h">Coming up</h2></div>
              ${days.map((d) => `
                <div class="st-day">
                  <div class="st-day-label">${esc(d === addDays(1) ? 'Tomorrow' : fmtDay(d))}</div>
                  <ul class="st-list">${upcoming.filter((x) => x.day === d).map(sessionRow).join('')}</ul>
                </div>`).join('')}
            </section>` : ''}

          <section class="section" aria-labelledby="st-subj-h">
            <div class="section-head"><h2 id="st-subj-h">Subjects</h2></div>
            <div class="list">
              ${s.subjects.map((sub) => {
                const st = subjectStats(sub);
                const left = daysUntil(sub.examDate);
                return `
                  <div class="row">
                    <span class="bi-icon k-exam">${icon('book')}</span>
                    <div class="row-main">
                      <div class="row-title">${esc(sub.name)}</div>
                      <div class="row-sub">Exam ${esc(fmtDay(sub.examDate))} · ${left > 0 ? `in ${left} day${left === 1 ? '' : 's'}` : left === 0 ? 'today' : 'done'} · ${sub.topics.length || 4} topics · ${st.done}/${st.total} sessions done</div>
                      <div class="st-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${st.total}" aria-valuenow="${st.done}"><i style="width:${st.total ? Math.round((st.done / st.total) * 100) : 0}%"></i></div>
                    </div>
                    <button class="icon-btn sm" data-action="study-delete" data-id="${sub.id}" aria-label="Remove ${esc(sub.name)}">${icon('trash')}</button>
                  </div>`;
              }).join('')}
            </div>
          </section>`
        : emptyState('book', 'No exams in the plan yet', 'Add one below. You can speak the topics too.')}

        <details class="card st-add" ${s.subjects.length ? '' : 'open'}>
          <summary>${icon('plus')}Add an exam</summary>
        <form class="st-form" data-form="study-subject">
          <div class="st-form-row">
            <label class="field grow"><span class="field-label">Subject</span>
              <div class="with-mic"><input class="input" id="st-name" name="name" maxlength="80" placeholder="e.g. DBMS" required autocomplete="off" />${micButton('#st-name')}</div></label>
            <label class="field"><span class="field-label">Exam date</span>
              <input class="input" type="date" name="examDate" min="${addDays(1)}" value="${addDays(7)}" required /></label>
          </div>
          <label class="field"><span class="field-label">Topics (one per line or comma-separated; leave empty and ${esc(M.agent.name)} splits it into 4 parts)</span>
            <div class="with-mic"><textarea class="input" id="st-topics" name="topics" rows="3" placeholder="ER model, SQL joins, Normalization, Transactions, Indexing"></textarea>${micButton('#st-topics', 'Say the topics')}</div></label>
          <div class="st-form-row">
            <label class="field"><span class="field-label">Time per topic</span>
              <select class="select" name="minutesPerTopic">${[30, 45, 60, 90, 120].map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${fmtMinsLong(m)}</option>`).join('')}</select></label>
            <span class="spacer"></span>
            <button class="btn btn-primary" type="submit">${icon('plus')}Add to plan</button>
          </div>
        </form>
        </details>

        <div class="st-daily">
          <label for="study-daily">Study time per day</label>
          <select class="select" id="study-daily">${[60, 90, 120, 180, 240, 300, 360, 480].map((m) => `<option value="${m}" ${m === daily ? 'selected' : ''}>${fmtMinsLong(m)}</option>`).join('')}</select>
          ${s.subjects.length ? `<button class="btn btn-ghost btn-sm" data-action="study-replan">${icon('undo')}Replan</button>` : ''}
        </div>
      </div>`;
  }

  // ===== People =============================================================
  async function loadPeople() {
    try {
      state.people = await api('/api/people');
      if (state.view === 'people' && !document.activeElement.matches('input, textarea')) renderView();
    } catch (e) { /* offline */ }
  }

  function viewPeople() {
    if (!state.live) return `<div class="page">${emptyState('people', 'People needs the Aide server', 'Start Aide with start.cmd, then open People again.')}</div>`;
    if (!state.people) return `<div class="page"><p class="page-sub">Loading…</p></div>`;
    const f = (state.peopleFilter || '').toLowerCase();
    const list = state.people.filter((p) => !f || p.name.toLowerCase().includes(f) || p.notes.toLowerCase().includes(f));
    return `
      <div class="page">
        <p class="page-sub">Notes about the people who message you. ${esc(M.agent.name)} reads them every time it drafts a reply to that person, like "Prefers formal emails" or "My roommate, keep it casual".</p>
        <div class="toolbar">
          <div class="with-mic grow"><input class="input" id="people-filter" placeholder="Find someone" value="${esc(state.peopleFilter || '')}" autocomplete="off" aria-label="Find someone" />${micButton('#people-filter')}</div>
        </div>
        ${list.length ? `
          <div class="list people-list">
            ${list.map((p, i) => `
              <div class="row person-row">
                <div class="avatar" aria-hidden="true">${esc(initials(p.name))}</div>
                <div class="row-main">
                  <div class="row-title">${esc(p.name)}</div>
                  <div class="row-sub">${p.messages ? `${p.messages} message${p.messages === 1 ? '' : 's'}` : 'Added by you'}${p.channels.length ? ` · ${p.channels.map((c) => esc((M.channels[c] || { label: c }).label)).join(', ')}` : ''}</div>
                  <div class="with-mic">
                    <textarea class="input person-notes" id="pn-${i}" rows="2" maxlength="1000" data-person="${esc(p.name)}" placeholder="Notes for ${esc(M.agent.name)}, e.g. teaches DBMS, prefers formal emails">${esc(p.notes)}</textarea>
                    ${micButton(`#pn-${i}`)}
                  </div>
                </div>
              </div>`).join('')}
          </div>` : emptyState('people', f ? 'Nobody matches' : 'No one yet', 'People show up here once they message you. You can also add someone below.')}
        <form class="card add-person" data-form="person">
          <input class="input" name="name" maxlength="200" placeholder="Name, exactly as it appears in messages" required autocomplete="off" />
          <input class="input grow" name="notes" maxlength="1000" placeholder="Notes" required autocomplete="off" />
          <button class="btn btn-secondary" type="submit">${icon('plus')}Add</button>
        </form>
      </div>`;
  }

  // ===== Search =============================================================
  let searchTimer = null;

  function openSearch() {
    openSheet(`
      <h2 class="sheet-title" id="sheet-title">Search</h2>
      <div class="with-mic">
        <input id="search-input" class="input search-input" placeholder="Messages, replies, deadlines, food, people, subjects…" autocomplete="off" aria-label="Search" />
        ${micButton('#search-input', 'Search by voice')}
      </div>
      <div id="search-results" class="search-results" aria-live="polite"><p class="sheet-sub">Type at least 2 letters.</p></div>`,
    { focus: '#search-input', onClose: stopMic });
  }

  async function runSearch(q) {
    const box = $('#search-results');
    if (!box) return;
    if (q.trim().length < 2) { box.innerHTML = '<p class="sheet-sub">Type at least 2 letters.</p>'; return; }
    if (!state.live) { box.innerHTML = '<p class="sheet-sub">Search needs the Aide server.</p>'; return; }
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q.trim())}`);
      if ($('#search-input') && $('#search-input').value.trim() !== q.trim()) return; // a newer search is coming
      const item = (view, title, sub, ic) => `<button class="search-item" data-action="search-go" data-view="${view}">${icon(ic)}<span><b>${esc(title)}</b><small>${esc(sub)}</small></span></button>`;
      const groups = [
        ['Messages', r.messages.map((m) => item(m.status === 'pending' ? 'approvals' : 'activity', `${m.from}: ${m.text.slice(0, 80)}`, `${(M.channels[m.channel] || { label: m.channel }).label} · ${fmtWhen(m.at)} · ${m.status === 'pending' ? 'waiting for you' : m.status}`, 'chat'))],
        ['Deadlines', r.deadlines.map((d) => item('tasks', d.title, `${KIND_NAME[d.kind] || 'Task'} · ${fmtDay(d.dueDate)}${d.done ? ' · done' : ''}`, DL_ICON[d.kind] || 'clock'))],
        ['Study', r.study.map((s) => item('study', s.name, `Exam ${fmtDay(s.examDate)}`, 'book'))],
        ['People', r.people.map((p) => item('people', p.name, p.notes.slice(0, 80), 'people'))],
        ['Food', r.food.map((f) => item('food', f.request.slice(0, 80), `${f.restaurant || 'Any restaurant'} · ${f.status}`, 'food'))],
      ].filter((g) => g[1].length);
      box.innerHTML = groups.length
        ? groups.map(([label, items]) => `<div class="search-group"><div class="brief-label">${label}</div>${items.join('')}</div>`).join('')
        : `<p class="sheet-sub">Nothing found for "${esc(q)}".</p>`;
    } catch (e) { box.innerHTML = `<p class="sheet-sub">Search failed: ${esc(e.message)}</p>`; }
  }

  // ===== Remind me later ====================================================
  function snoozeOptions() {
    const now = new Date();
    const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
    const [bh, bm] = state.notify.briefTime.split(':').map(Number);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const opts = [['In 1 hour', new Date(now.getTime() + 3600e3)]];
    if (now.getHours() < 18) opts.push(['This evening', at(now, 19)]);
    opts.push(['Tomorrow morning', at(tomorrow, bh, bm)]);
    const exams = (state.deadlines || []).filter((d) => d.kind === 'exam' && !d.done && d.dueDate >= localDate())
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (exams.length) {
      const after = new Date(`${exams[0].dueDate}T00:00`); after.setDate(after.getDate() + 1); after.setHours(bh, bm, 0, 0);
      opts.push([`After your exam (${fmtDay(exams[0].dueDate)})`, after]);
    }
    const later = new Date(); later.setDate(later.getDate() + 3);
    opts.push(['In 3 days', at(later, bh, bm)]);
    return opts;
  }

  function openSnooze(id) {
    const a = state.approvals.find((x) => x.id === String(id));
    if (!a) return;
    openSheet(`
      <h2 class="sheet-title" id="sheet-title">Remind me later</h2>
      <p class="sheet-sub">The reply to ${esc(a.from)} leaves your queue and comes back at the top when it's time.</p>
      <div class="more-grid">
        ${snoozeOptions().map(([label, when]) => `
          <button class="more-tile pressable" data-action="snooze-pick" data-id="${a.id}" data-until="${when.toISOString()}">
            <span class="more-icon">${icon('clock')}</span><span class="more-label">${esc(label)}</span>
            <span class="more-sub">${esc(when.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span>
          </button>`).join('')}
      </div>`);
  }

  async function loadSnoozed() {
    try {
      state.snoozed = (await api('/api/approvals/snoozed')).map(fromServer);
      if (state.view === 'approvals' && !document.activeElement.matches('textarea')) renderView();
    } catch (e) { /* ignore */ }
  }

  function snoozedSection() {
    const list = state.snoozed || [];
    if (!list.length) return '';
    return `
      <details class="snoozed card">
        <summary>${icon('clock')}${list.length} snoozed</summary>
        <div class="list">
          ${list.map((a) => `
            <div class="row">
              <div class="row-main">
                <div class="row-title">${esc(a.from)}: ${esc(a.original.slice(0, 70))}</div>
                <div class="row-sub">Back ${esc(new Date(a.snoozeUntil).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-action="unsnooze" data-id="${a.id}">Bring back</button>
            </div>`).join('')}
        </div>
      </details>`;
  }

  // ===== Settings: voice, auto-send, backup =================================
  function moreSettingsSections() {
    const v = voiceLang();
    const voice = `
      <section class="section" aria-labelledby="s-voice">
        <div class="section-head"><h2 id="s-voice">Voice</h2><p>Tap a ${icon('mic')} mic to speak instead of typing: chat, food orders, search, study topics, deadlines and notes.</p></div>
        <div class="card notif-status">
          ${voiceSupported()
            ? `<label for="voice-lang">Language I speak</label><span class="spacer"></span>
               <select class="select" id="voice-lang">${VOICE_LANGS.map(([code, label]) => `<option value="${code}" ${code === v ? 'selected' : ''}>${label}</option>`).join('')}</select>`
            : `<span>${icon('info')}This browser can't do voice input. Chrome or Edge can.</span>`}
        </div>
        <div class="list">
          <div class="row">
            <div class="row-main"><div class="row-title" id="vs-l">Read answers aloud</div><div class="row-sub">In Talk to ${esc(M.agent.name)} (the ${icon('mic')} button at the top).</div></div>
            <button class="switch" role="switch" aria-checked="${speakOn()}" aria-labelledby="vs-l" data-action="voice-speak-toggle" ${speakSupported() ? '' : 'disabled'}></button>
          </div>
          <div class="row">
            <div class="row-main"><div class="row-title"><label for="voice-rate">Speaking speed</label></div></div>
            <select class="select" id="voice-rate">${[[0.85, 'Slower'], [1, 'Normal'], [1.15, 'Faster'], [1.3, 'Fast']].map(([r, l]) => `<option value="${r}" ${r === speakRate() ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </div>
        </div>
      </section>`;
    if (!state.lan) return voice; // auto-send and backup are only on the computer running Aide
    const a = state.autosend || { enabled: false, dailyCap: 10, sentToday: 0 };
    return `${voice}
      <section class="section" aria-labelledby="s-auto">
        <div class="section-head"><h2 id="s-auto">Auto-send safe replies</h2>
          <p>When on, ${esc(M.agent.name)} sends only the safest replies by itself: "Auto-handle" ones it's highly confident about, to people you've already replied to yourself. Never money, deadlines, emotions, urgent messages or strangers. Each still has a 60-second undo and shows up in Activity.</p></div>
        <div class="list">
          <div class="row">
            <div class="row-main"><div class="row-title" id="as-l">Auto-send</div><div class="row-sub">${a.enabled ? `On · ${a.sentToday} sent today` : 'Off. Everything waits for your OK.'}</div></div>
            <button class="switch" role="switch" aria-checked="${a.enabled}" aria-labelledby="as-l" data-action="autosend-toggle"></button>
          </div>
          <div class="row">
            <div class="row-main"><div class="row-title"><label for="autosend-cap">Daily limit</label></div><div class="row-sub">After this many, the rest wait for you.</div></div>
            <select class="select" id="autosend-cap">${[3, 5, 10, 20].map((n) => `<option value="${n}" ${n === a.dailyCap ? 'selected' : ''}>${n} a day</option>`).join('')}</select>
          </div>
        </div>
      </section>
      <section class="section" aria-labelledby="s-backup">
        <div class="section-head"><h2 id="s-backup">Backup</h2><p>One file with all your messages, replies, deadlines, study plan, notes and settings. Keep it somewhere safe; it's private.</p></div>
        <div class="card notif-status">
          <a class="btn btn-primary btn-sm" href="${API_BASE}/api/backup" download>${icon('download')}Download backup</a>
          <label class="btn btn-ghost btn-sm">${icon('upload')}Restore from a file…<input type="file" id="restore-file" accept=".json,application/json" hidden /></label>
        </div>
      </section>`;
  }

  async function restoreFrom(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { toast("That file isn't an Aide backup"); return; }
    if (!data || data.app !== 'aide') { toast("That file isn't an Aide backup"); return; }
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date';
    const n = (data.tables && data.tables.messages || []).length;
    openSheet(`
      <h2 class="sheet-title" id="sheet-title">Restore this backup?</h2>
      <p class="sheet-sub">From ${esc(when)}, with ${n} message${n === 1 ? '' : 's'}. This <b>replaces all your current data</b> in ${esc(M.agent.name)}. A safety copy of what's there now is saved first (in aide-backend\\backups).</p>
      <div class="capture-actions">
        <button type="button" class="btn btn-ghost" data-action="sheet-close">Cancel</button>
        <button type="button" class="btn btn-danger" data-action="restore-confirm">Yes, replace my data</button>
      </div>`);
    state.pendingRestore = data;
  }

  // ===== Phone pairing, phone access, weekly recap ==========================
  function viewPair() {
    return `
      <div class="page pair-page">
        <div class="card pair-card">
          <div class="done-badge">${icon('sparkle')}</div>
          <h2>Pair this phone with ${esc(M.agent.name)}</h2>
          <p>On your computer, open <b>Settings → Use on your phone</b> and type the 6-digit PIN shown there.</p>
          <form data-form="pair" class="pair-form">
            <input id="pair-pin" class="input pair-pin" inputmode="numeric" maxlength="6" autocomplete="one-time-code"
              placeholder="••••••" aria-label="6-digit PIN" autofocus />
            <button class="btn btn-primary btn-lg btn-block" type="submit">Pair</button>
          </form>
          <p class="muted">Works on your home Wi-Fi. This phone stays paired for 90 days, and you can remove it from your computer anytime.</p>
          ${certHelp('')}
        </div>
      </div>`;
  }

  // How to trust Aide's home certificate on a phone (removes the "not private" warning, enables the mic).
  function certHelp(base, fingerprint) {
    return `
      <details class="cert-help">
        <summary>${icon('info')}Seeing a “not private” warning? Fix it once</summary>
        <ol>
          <li>Download ${esc(M.agent.name)}'s home certificate on the phone: <a href="${base}/aide-home-ca.crt" download>aide-home-ca.crt</a>${base ? ` (<span class="phone-url">${esc(base)}/aide-home-ca.crt</span>)` : ''}.</li>
          <li><b>Android:</b> Settings → search “CA certificate” → Install anyway → pick the file.</li>
          <li><b>iPhone:</b> Settings → Profile Downloaded → Install. Then General → About → Certificate Trust Settings → turn on “Aide home CA”.</li>
          <li>Reopen the link. The warning is gone, and the mic and notifications work.</li>
        </ol>
        <p class="muted">${fingerprint ? `Its fingerprint starts with <b>${esc(fingerprint)}</b>. ` : ''}It only works for addresses on your home network, so it can't be used to fake real websites.</p>
      </details>`;
  }

  function phoneSection() {
    const l = state.lan;
    if (!l) return '';
    let body;
    if (!l.enabled) {
      body = `<div class="card notif-status"><span>${icon('info')}Off. To use ${esc(M.agent.name)} on your phone, start it with <b>start-phone.cmd</b> instead of start.cmd, then come back here.</span></div>`;
    } else if (!l.urls.length) {
      body = `<div class="card notif-status"><span>${icon('alert')}This computer isn't on a network right now. Connect to your home Wi-Fi and reopen Settings.</span></div>`;
    } else {
      const url = l.urls[0];
      body = `
        <div class="card phone-card">
          <img class="phone-qr" src="${API_BASE}/api/lan/qr.svg?url=${encodeURIComponent(url)}" alt="QR code for ${esc(url)}" width="160" height="160" />
          <div class="phone-steps">
            <ol>
              <li>Connect your phone to the <b>same Wi-Fi</b> as this computer.</li>
              <li>Scan the code with your phone's camera, or open <b class="phone-url">${esc(url)}</b>${l.urls.length > 1 ? ` (or ${l.urls.slice(1).map(esc).join(', ')})` : ''}.</li>
              <li>Enter this PIN:</li>
            </ol>
            <div class="phone-pin" aria-label="Pairing PIN">${esc(l.pin.replace(/(\d{3})(\d{3})/, '$1 $2'))}</div>
            <button class="btn btn-ghost btn-sm" data-action="lan-new-pin">${icon('undo')}New PIN</button>
            <p class="muted">The PIN works once. It changes after each phone pairs.</p>
          </div>
        </div>
        <div class="card">${certHelp(url, l.caFingerprint)}</div>
        ${l.devices.length ? `
          <div class="list">
            ${l.devices.map((d) => `
              <div class="row">
                <span class="bi-icon">${icon('chat')}</span>
                <div class="row-main"><div class="row-title">${esc(d.name)}</div><div class="row-sub">Paired ${esc(fmtWhen(d.created))}</div></div>
                <button class="btn btn-ghost btn-sm" data-action="lan-remove" data-id="${esc(d.id)}">Remove</button>
              </div>`).join('')}
          </div>` : ''}`;
    }
    return `
      <section class="section" aria-labelledby="s-phone">
        <div class="section-head"><h2 id="s-phone">Use on your phone</h2>
          <p>Open ${esc(M.agent.name)} on your phone over home Wi-Fi while this computer runs it. The link is secure (https), so voice and notifications work on the phone too. Use trusted Wi-Fi only.</p></div>
        ${body}
      </section>`;
  }

  function weeklyCard() {
    const w = state.weekly;
    if (!state.live || !w) return '';
    const max = Math.max(1, ...w.days.map((d) => d.handled));
    const diff = w.handled - w.previousWeek;
    const wait = w.medianReplyMinutes == null ? '—' : w.medianReplyMinutes < 60 ? `${w.medianReplyMinutes} min` : `${Math.round(w.medianReplyMinutes / 60)} h`;
    const tile = (value, label, sub = '') => `<div class="wk-tile"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    return `
      <section class="card weekly" aria-labelledby="wk-h">
        <div class="chart-head"><h3 id="wk-h">This week</h3><span class="muted">${esc(fmtDay(w.from))} – ${esc(fmtDay(w.to))}</span></div>
        <div class="wk-tiles">
          ${tile(w.handled, 'replies sent', w.previousWeek || w.handled ? `${diff >= 0 ? '+' : ''}${diff} vs last week` : '')}
          ${tile(fmtMins(w.timeSavedMinutes), 'time saved')}
          ${tile(wait, 'typical reply time', 'from draft to sent')}
          ${tile(w.edited, 'edited by you', w.edited ? `${esc(M.agent.name)} learned from these` : '')}
          ${tile(w.skipped, 'skipped')}
          ${tile(w.deadlinesDone, 'deadlines done')}
        </div>
        <div class="bars wk-bars" role="img" aria-label="Replies sent per day: ${w.days.map((d) => d.handled).join(', ')}">
          ${w.days.map((d, i) => `
            <div class="bar-col" title="${d.handled} on ${esc(fmtDay(d.date))}">
              <div class="bar ${i === 6 ? 'is-today' : ''}" style="--h:${(d.handled / max).toFixed(3)};--i:${i}"></div>
              <span class="bar-label ${i === 6 ? 'is-today' : ''}">${i === 6 ? 'Today' : new Date(`${d.date}T00:00`).toLocaleDateString([], { weekday: 'narrow' })}</span>
            </div>`).join('')}
        </div>
        ${w.topPeople.length ? `<p class="wk-people">Most messages from ${w.topPeople.map((p) => `<b>${esc(p.name)}</b> (${p.messages})`).join(', ')}.</p>` : ''}
      </section>`;
  }

  // ===== View: Food =========================================================
  // Plan and check the cart here; Claude places it with the official Swiggy/Zomato connector
  // (they don't allow third-party apps yet), after showing you the real cart and getting your yes.
  const CHECK_ICON = { ok: 'check', info: 'info', warn: 'alert', block: 'ban' };
  const APP_NAME = { swiggy: 'Swiggy', zomato: 'Zomato' };
  const orderById = (id) => (state.food.orders || []).find((o) => String(o.id) === String(id));

  async function loadFood() {
    try {
      const [orders, profile] = await Promise.all([api('/api/food/orders'), api('/api/food/profile')]);
      state.food.orders = orders;
      state.food.profile = profile;
      if (!state.food.app) state.food.app = profile.preferredApp;
      if (state.view === 'food' && !document.activeElement.matches('input, textarea, select')) renderView();
    } catch (e) { /* the view shows the offline state */ }
  }

  function replaceOrder(o) {
    const list = state.food.orders || (state.food.orders = []);
    const i = list.findIndex((x) => x.id === o.id);
    if (i >= 0) list[i] = o; else list.unshift(o);
  }

  // Re-render without losing your place: put focus back on the same cart field.
  function renderFoodKeepingFocus() {
    const a = document.activeElement;
    const key = a && a.dataset && a.dataset.food ? `[data-food="${a.dataset.food}"][data-order="${a.dataset.order}"]${a.dataset.idx ? `[data-idx="${a.dataset.idx}"]` : ''}` : null;
    renderView();
    const el = key && document.querySelector(key);
    if (el) el.focus();
  }

  async function foodCall(path, opts, okMsg) {
    try {
      const o = await api(path, opts);
      replaceOrder(o);
      renderFoodKeepingFocus();
      if (okMsg) toast(okMsg);
      return o;
    } catch (e) {
      toast(`Couldn't update the cart: ${e.message}`);
      loadFood();
      return null;
    }
  }

  const patchOrder = (id, body) => foodCall(`/api/food/orders/${id}`, { method: 'PATCH', body });

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
  }

  function foodItem(o, it, i, edit) {
    const ids = `data-order="${o.id}" data-idx="${i}"`;
    if (!edit) {
      return `<li class="food-item"><span class="qty-fixed">${it.qty}×</span><div class="food-item-main"><div class="food-name-ro">${esc(it.name)}</div>${it.notes ? `<div class="food-note-ro">${esc(it.notes)}</div>` : ''}</div></li>`;
    }
    return `
      <li class="food-item">
        <div class="qty" role="group" aria-label="Quantity of ${esc(it.name)}">
          <button type="button" class="icon-btn sm" data-action="food-qty" ${ids} data-d="-1" aria-label="One less" ${it.qty <= 1 ? 'disabled' : ''}>${icon('minus')}</button>
          <span>${it.qty}</span>
          <button type="button" class="icon-btn sm" data-action="food-qty" ${ids} data-d="1" aria-label="One more">${icon('plus')}</button>
        </div>
        <div class="food-item-main">
          <input class="input food-name" data-food="name" ${ids} value="${esc(it.name)}" maxlength="120" aria-label="Dish" />
          <input class="input food-note" data-food="item-notes" ${ids} value="${esc(it.notes)}" maxlength="200" placeholder="Notes, e.g. less oil" aria-label="Notes for ${esc(it.name)}" />
        </div>
        <button type="button" class="icon-btn sm" data-action="food-remove" ${ids} aria-label="Remove ${esc(it.name)}">${icon('trash')}</button>
      </li>`;
  }

  function foodCard(o) {
    const edit = o.status === 'planned';
    const p = state.food.profile;
    const count = o.items.reduce((n, i) => n + i.qty, 0);
    const blocked = o.checks.some((c) => c.level === 'block');
    const id = `data-order="${o.id}"`;
    const setup = o.app === 'swiggy'
      ? 'add <b>Swiggy</b> with the URL <code>https://mcp.swiggy.com/food</code>'
      : 'add <b>Zomato</b> (request access first on <a href="https://github.com/Zomato/mcp-server-manifest" target="_blank" rel="noopener">Zomato\'s connector page</a>)';
    return `
      <article class="card food-cart is-${o.status}" data-cart="${o.id}" aria-label="${esc(o.appLabel)} cart">
        <header class="food-cart-head">
          <span class="food-app ${o.app}">${esc(o.appLabel)}</span>
          ${edit
            ? `<input class="input food-rest" data-food="restaurant" ${id} value="${esc(o.restaurant)}" maxlength="120" placeholder="Any restaurant (Claude suggests options)" aria-label="Restaurant" />`
            : `<h3 class="food-rest-name">${esc(o.restaurant || 'Claude will suggest restaurants')}</h3>`}
          <span class="pill ${o.status === 'approved' ? 's-sent' : 's-scheduled'}">${o.status === 'approved' ? 'Approved' : 'Planning'}</span>
        </header>
        <p class="food-request">You asked: “${esc(o.request)}”</p>
        <ul class="food-items">${o.items.map((it, i) => foodItem(o, it, i, edit)).join('')}</ul>
        ${edit ? `
          <form class="food-add" data-form="food-add" ${id}>
            <input class="input" name="dish" maxlength="120" placeholder="Add a dish, e.g. 2 butter naan" aria-label="Add a dish" autocomplete="off" />
            <button class="btn btn-ghost btn-sm" type="submit">${icon('plus')}Add</button>
          </form>` : ''}
        <div class="food-meta">
          <label class="food-meta-field"><span class="field-label">Budget (₹)</span>
            ${edit ? `<input class="input" type="number" min="0" max="100000" inputmode="numeric" data-food="budget" ${id} value="${o.budget ?? ''}" placeholder="${p.budgetCap} (your cap)" />` : `<b>₹${o.budget ?? p.budgetCap}</b>`}</label>
          <label class="food-meta-field grow"><span class="field-label">Notes for the order</span>
            ${edit ? `<input class="input" data-food="notes" ${id} value="${esc(o.notes)}" maxlength="300" placeholder="e.g. less spicy, no cutlery" />` : `<b>${esc(o.notes || 'None')}</b>`}</label>
          <span class="food-count">${count} item${count === 1 ? '' : 's'}</span>
        </div>
        <ul class="food-checks" aria-label="Checks">
          ${o.checks.map((c) => `<li class="chk ${c.level}">${icon(CHECK_ICON[c.level])}<span>${esc(c.text)}</span></li>`).join('')}
        </ul>
        <footer class="food-actions">
          ${edit ? `
            <button class="btn btn-ghost" data-action="food-cancel" ${id}>Cancel</button>
            <button class="btn btn-primary" data-action="food-approve" ${id} ${o.canApprove ? '' : 'disabled'} title="${blocked ? 'Fix the red checks first' : ''}">${icon('check')}Approve cart</button>`
          : `
            <div class="food-handoff">
              <p><b>Next: place it in Claude.</b> Claude builds this exact cart with the ${esc(o.appLabel)} connector, shows you the real cart with prices and anything that differs, and only orders after you reply <b>“yes, place it”</b>.</p>
              <div class="actions">
                <button class="btn btn-primary" data-action="food-claude" ${id}>${icon('external')}Copy &amp; open Claude</button>
                <button class="btn btn-secondary" data-action="food-copy" ${id}>${icon('copy')}Copy instructions</button>
                <button class="btn btn-ghost" data-action="food-ordered" ${id}>${icon('check')}Mark as ordered</button>
                <button class="btn btn-ghost" data-action="food-cancel" ${id}>Cancel</button>
              </div>
              <details class="food-prompt"><summary>See exactly what Claude will be told</summary>
                <textarea class="input" readonly rows="12" id="prompt-${o.id}" aria-label="Instructions for Claude">${esc(o.handoffPrompt)}</textarea></details>
              <p class="food-setup">${icon('info')}<span>First time? In Claude, open <b>Settings → Connectors</b> and ${setup}. Sign in with your ${esc(o.appLabel)} account there.</span></p>
            </div>`}
        </footer>
      </article>`;
  }

  function foodPrefs(p) {
    const sel = (name, options, cur, label) => `
      <label class="field"><span class="field-label">${label}</span>
        <select class="select" name="${name}">${options.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    return `
      <details class="card food-prefs" ${p.area ? '' : 'open'}>
        <summary><span>${icon('settings')}Food preferences</span><span class="muted">${esc([p.area || 'Area not set', p.diet !== 'no preference' ? p.diet : '', `cap ₹${p.budgetCap}`].filter(Boolean).join(' · '))}</span></summary>
        <form class="food-prefs-form" data-form="food-prefs">
          <label class="field wide"><span class="field-label">Delivery area (just the locality, never your full address)</span>
            <input class="input" name="area" maxlength="120" value="${esc(p.area)}" placeholder="e.g. Indiranagar, Bengaluru" autocomplete="off" /></label>
          ${sel('diet', [['no preference', 'No preference'], ['vegetarian', 'Vegetarian'], ['eggetarian', 'Eggetarian'], ['vegan', 'Vegan']], p.diet, 'Diet')}
          ${sel('spice', [['mild', 'Mild'], ['medium', 'Medium'], ['spicy', 'Spicy']], p.spice, 'Spice level')}
          <label class="field"><span class="field-label">Budget cap per order (₹)</span>
            <input class="input" name="budgetCap" type="number" min="0" max="100000" inputmode="numeric" value="${p.budgetCap}" /></label>
          ${sel('preferredApp', [['swiggy', 'Swiggy'], ['zomato', 'Zomato']], p.preferredApp, 'Usual app')}
          <label class="field wide"><span class="field-label">Favourite orders (comma-separated, shown as quick picks)</span>
            <input class="input" name="favorites" maxlength="1000" value="${esc(p.favorites.join(', '))}" placeholder="e.g. 1 masala dosa from MTR, 2 veg momos" autocomplete="off" /></label>
          <label class="field wide"><span class="field-label">Never include (allergies or dislikes, comma-separated)</span>
            <input class="input" name="avoid" maxlength="500" value="${esc(p.avoid.join(', '))}" placeholder="e.g. mushroom, peanuts" autocomplete="off" /></label>
          <label class="field wide"><span class="field-label">Anything else Claude should know</span>
            <input class="input" name="notes" maxlength="300" value="${esc(p.notes)}" placeholder="e.g. no cutlery, prefer places rated 4+" autocomplete="off" /></label>
          <div class="about-actions wide"><button class="btn btn-primary btn-sm" type="submit">Save preferences</button></div>
        </form>
      </details>`;
  }

  function viewFood() {
    const f = state.food;
    if (!state.live) {
      return `<div class="page">${emptyState('food', 'Food ordering needs the Aide server', 'Start Aide with start.cmd, then open Food again.')}</div>`;
    }
    if (!f.orders || !f.profile) return `<div class="page"><p class="page-sub">Loading your carts…</p></div>`;
    const open = f.orders.filter((o) => o.status === 'planned' || o.status === 'approved');
    const past = f.orders.filter((o) => o.status === 'ordered' || o.status === 'cancelled').slice(0, 8);
    const app = f.app || f.profile.preferredApp;
    return `
      <div class="page food-page">
        <ol class="food-steps" aria-label="How it works">
          <li><span>1</span><div><b>Plan</b> the cart here</div></li>
          <li><span>2</span><div><b>Check</b> it against your preferences</div></li>
          <li><span>3</span><div><b>Approve</b>, then Claude shows the real ${APP_NAME[app]} cart and orders only after your yes</div></li>
        </ol>

        <form class="card food-plan" data-form="food-plan">
          <label class="field-label" for="food-text">What do you want to eat?</label>
          <div class="with-mic"><textarea id="food-text" class="input food-input" rows="2" maxlength="1000" placeholder="e.g. 2 paneer butter masala and 3 butter naan from Punjabi Rasoi under 600, less spicy"></textarea>${micButton('#food-text', 'Say your order')}</div>
          ${f.profile.favorites.length ? `<div class="chips food-favs" aria-label="Favourites">${f.profile.favorites.map((x) => `<button type="button" class="chip" data-action="food-fav" data-text="${esc(x)}">${icon('plus')}${esc(x)}</button>`).join('')}</div>` : ''}
          <div class="food-plan-row">
            <div class="segmented" role="radiogroup" aria-label="Order from">
              ${['swiggy', 'zomato'].map((a) => `<button type="button" role="radio" aria-checked="${app === a}" data-action="food-app" data-app="${a}"><i class="app-dot ${a}" aria-hidden="true"></i>${APP_NAME[a]}</button>`).join('')}
            </div>
            <button class="btn btn-primary" type="submit" ${f.busy ? 'disabled' : ''}>${icon('food')}${f.busy ? 'Planning…' : 'Plan cart'}</button>
          </div>
        </form>

        <div class="stack" data-stagger>${open.map(foodCard).join('')}</div>

        ${foodPrefs(f.profile)}

        ${past.length ? `
          <section class="section" aria-labelledby="food-recent">
            <div class="section-head"><h2 id="food-recent">Recent</h2></div>
            <div class="list">
              ${past.map((o) => `
                <div class="row">
                  <i class="app-dot ${o.app}" aria-hidden="true"></i>
                  <div class="row-main">
                    <div class="row-title">${esc(o.items.map((i) => `${i.qty}× ${i.name}`).join(', '))}</div>
                    <div class="row-sub">${esc(o.restaurant || 'Any restaurant')} · ${esc(o.appLabel)} · ${esc(fmtWhen(o.updatedAt))}</div>
                  </div>
                  <span class="pill ${o.status === 'ordered' ? 's-sent' : 's-skipped'}">${o.status === 'ordered' ? 'Ordered' : 'Cancelled'}</span>
                </div>`).join('')}
            </div>
          </section>` : ''}
      </div>`;
  }

  // "About you" + "Learned from your edits": live only (they read and write the backend).
  function settingsLiveSections() {
    const p = state.profile;
    if (!p) return '';
    const alerts = (state.brief ? notificationsSection() : '') + moreSettingsSections() + phoneSection();
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
      </section>
      ${alerts}`;
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

        <section class="section" aria-labelledby="s-notif" ${state.brief ? 'hidden' : ''}>
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
  const VIEW_FNS = { home: viewHome, chat: viewChat, apps: viewApps, app: viewApp, approvals: viewApprovals, activity: viewActivity, food: viewFood, study: viewStudy, people: viewPeople, tasks: viewTasks, rules: viewRules, settings: viewSettings };

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
    content.innerHTML = state.needsPair ? viewPair() : VIEW_FNS[state.view]();
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
    if (state.live && view === 'food') loadFood();
    if (state.live && view === 'tasks') loadDeadlines();
    if (state.live && view === 'study') loadStudy();
    if (state.live && view === 'people') loadPeople();
    if (state.live && view === 'approvals') loadSnoozed();
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
    const L = { study: 'Study', people: 'People', food: 'Food', apps: 'Apps', tasks: 'Tasks', rules: 'Rules', settings: 'Settings' };
    const sub = {
      food: (() => { const n = (state.food.orders || []).filter((o) => o.status === 'planned' || o.status === 'approved').length; return n ? `${n} cart${n > 1 ? 's' : ''} open` : 'Plan an order'; })(),
      study: state.study && state.study.today.length ? `${state.study.today.filter((x) => !x.done).length} sessions today` : 'Exam revision plan',
      people: 'Notes for replies',
      apps: `${appList().filter((a) => a.connected).length} connected`,
      tasks: state.deadlines ? `${state.deadlines.filter((d) => !d.done).length} deadlines` : `${state.tasks.filter((t) => t.status !== 'done').length} active`,
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
      <p class="sheet-sub">Type or tap Speak. "Order 2 masala dosa from MTR" plans a food cart, "DBMS exam on 12th at 10 AM" adds a deadline, anything else becomes a note.</p>
      <form class="capture" data-form="capture">
        <label class="sr-only" for="capture-input">Message</label>
        <textarea id="capture-input" class="capture-input" rows="3" placeholder="e.g. Order 2 masala dosa from MTR"></textarea>
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

  // ----- Voice input ---------------------------------------------------------
  // Any text box can have a mic: micButton('#id'). Uses the browser's speech recognition
  // (Chrome / Edge / Safari); the language is set in Settings → Voice.
  const VOICE_LANGS = [['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['te-IN', 'Telugu'], ['ta-IN', 'Tamil'],
    ['kn-IN', 'Kannada'], ['ml-IN', 'Malayalam'], ['mr-IN', 'Marathi'], ['bn-IN', 'Bengali'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)']];
  const voiceSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const voiceLang = () => store.get('voiceLang', (navigator.language || 'en-IN').startsWith('en') ? 'en-IN' : navigator.language);
  const micButton = (target, label = 'Speak instead of typing') => voiceSupported()
    ? `<button type="button" class="mic-inline" data-action="voice" data-target="${target}" aria-pressed="false" aria-label="${esc(label)}" title="${esc(label)}">${icon('mic')}</button>`
    : '';

  function toggleMic(btn, input = $(btn.dataset.target || '#capture-input')) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Voice input isn't supported in this browser. Try Chrome or Edge."); return; }
    if (recognition) { stopMic(); return; }
    if (!input) return;
    const base = input.value ? input.value.trimEnd() + ' ' : '';
    const label = btn.querySelector('.mic-label');
    recognition = new SR();
    recognition.lang = voiceLang();
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      input.value = base + [...e.results].map((r) => r[0].transcript).join('');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone access is blocked. Allow it in your browser\'s site settings.');
      else if (e.error !== 'aborted' && e.error !== 'no-speech') toast("Couldn't hear that. Try again.");
    };
    recognition.onend = () => {
      recognition = null;
      document.querySelectorAll('.listening').forEach((b) => { b.classList.remove('listening'); b.setAttribute('aria-pressed', 'false'); });
      if (label) label.textContent = 'Speak';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
    };
    recognition.start();
    btn.classList.add('listening');
    btn.setAttribute('aria-pressed', 'true');
    if (label) label.textContent = 'Listening…';
  }

  // ===== Talk to Aide: voice in, voice out ==================================
  // Talk mode answers questions from your own data (the server builds every answer).
  // Hands-free mode reads each waiting reply and acts on what you say. Sending always asks
  // "Send this to …?" and waits for a yes. Food is never ordered by voice.
  const talk = { open: false, rec: null, mode: 'talk', queue: [], index: 0, loop: false, busy: false, hinted: false };
  const speakSupported = () => 'speechSynthesis' in window;
  const speakOn = () => store.get('voiceSpeak', true) !== false;
  const speakRate = () => Number(store.get('voiceRate', 1)) || 1;
  const REPLY_HINT = 'Say send, change it, later, next, or stop.';

  function speak(text) {
    return new Promise((resolve) => {
      if (!speakOn() || !speakSupported() || !text || !talk.open) { resolve(); return; }
      const synth = window.speechSynthesis;
      synth.cancel();
      const lang = voiceLang().startsWith('en') ? voiceLang() : 'en-IN'; // answers are in English
      const voices = synth.getVoices();
      const voiceObj = voices.find((x) => x.lang === lang) || voices.find((x) => (x.lang || '').startsWith('en'));
      // Chrome stops long utterances part-way, so speak one sentence at a time.
      const parts = (text.match(/[^.!?]+[.!?]*/g) || [text]).map((s) => s.trim()).filter(Boolean);
      let i = 0;
      const next = () => {
        if (!talk.open || i >= parts.length) { resolve(); return; }
        const part = parts[i++];
        const u = new SpeechSynthesisUtterance(part);
        u.lang = lang; u.rate = speakRate();
        if (voiceObj) u.voice = voiceObj;
        let done = false;
        const finish = () => { if (!done) { done = true; clearTimeout(guard); next(); } };
        // Some browsers never fire "end": move on after a generous guess of the speaking time.
        const guard = setTimeout(finish, 2500 + part.length * 90 / u.rate);
        u.onend = finish;
        u.onerror = finish;
        synth.speak(u);
      };
      next();
    });
  }

  function talkStatus(text) { const el = $('#talk-status'); if (el) el.textContent = text; }

  function talkLog(who, text, extra = '') {
    const log = $('#talk-log');
    if (!log) return;
    log.insertAdjacentHTML('beforeend', `<div class="talk-msg ${who}"><p>${esc(text)}</p>${extra}</div>`);
    log.scrollTop = log.scrollHeight;
  }

  async function say(text, extra = '') {
    talkLog('aide', text, extra);
    talkStatus('Speaking…');
    await speak(text);
  }

  function setOrb(on) {
    const orb = $('#talk-orb');
    if (!orb) return;
    orb.classList.toggle('listening', on);
    orb.setAttribute('aria-pressed', String(on));
  }

  function talkStopListening() {
    if (talk.rec) { talk.rec.onend = null; try { talk.rec.abort(); } catch (e) { /* already stopped */ } talk.rec = null; }
    setOrb(false);
  }

  function idleStatus() {
    if (!voiceSupported()) return 'Type below. (Voice needs Chrome or Edge.)';
    return talk.mode === 'talk' ? 'Tap the mic and ask' : talk.mode === 'confirm' ? 'Tap the mic and say yes or no' : 'Tap the mic to answer';
  }

  function talkListen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !talk.open) return;
    talkStopListening();
    if (speakSupported()) window.speechSynthesis.cancel();
    const rec = new SR();
    rec.lang = voiceLang();
    rec.interimResults = true;
    let heard = '';
    rec.onresult = (e) => {
      heard = [...e.results].map((r) => r[0].transcript).join('');
      talkStatus(`“${heard}”`);
    };
    rec.onerror = (e) => {
      talk.loop = false;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        talkStatus(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname)
          ? "The microphone is blocked. Allow it in your browser's site settings."
          : 'The microphone needs the secure (https) link. See Settings → Use on your phone.');
      } else if (e.error === 'no-speech') talkStatus("I didn't hear anything. Tap the mic to try again.");
      else if (e.error !== 'aborted') talkStatus("Couldn't hear that. Tap the mic to try again.");
    };
    rec.onend = () => {
      talk.rec = null;
      setOrb(false);
      if (heard.trim()) talkHandle(heard.trim());
      else if (!talk.busy && $('#talk-status') && $('#talk-status').textContent === 'Listening…') talkStatus(idleStatus());
    };
    talk.rec = rec;
    try { rec.start(); } catch (e) { talk.rec = null; return; }
    setOrb(true);
    talkStatus('Listening…');
  }

  async function talkHandle(text) {
    if (talk.busy || !talk.open) return;
    talk.busy = true;
    talkStopListening();
    talkLog('you', text);
    talkStatus('Thinking…');
    try {
      if (talk.mode === 'talk') await talkAsk(text);
      else await replyHandle(text);
    } catch (e) {
      await say(e.status ? "Sorry, that didn't work. Try again." : "I can't reach the Aide server right now.");
    }
    talk.busy = false;
    renderTalkCard();
    // In hands-free reply mode, listen again after every answer; in talk mode, only if you started with the mic.
    if (talk.open && voiceSupported() && (talk.mode !== 'talk' || talk.loop)) talkListen();
    else talkStatus(idleStatus());
  }

  const VIEW_NAMES = { food: 'Food', tasks: 'Tasks', study: 'Study' };

  async function talkAsk(text) {
    const r = await api('/api/voice/talk', { method: 'POST', body: { text }, timeout: 20000 });
    const extra = r.view && VIEW_NAMES[r.view]
      ? `<button class="btn btn-ghost btn-sm" data-action="talk-view" data-view="${r.view}">Open ${VIEW_NAMES[r.view]}</button>` : '';
    if (r.intent === 'add') loadDeadlines();
    if (r.intent === 'food') loadFood();
    await say(r.say, extra);
    if (r.end) talk.loop = false;
    if (r.action === 'replies') await startReplies();
  }

  // ----- hands-free replies ---------------------------------------------------
  async function startReplies() {
    if (!state.live) { try { await loadLive({ render: false }); } catch (e) { /* offline */ } }
    talk.queue = state.approvals.filter((a) => !state.sending[a.id]).map((a) => a.id);
    talk.index = 0;
    talk.hinted = false;
    if (!talk.queue.length) { talk.mode = 'talk'; await say('No replies are waiting. You\'re all caught up.'); return; }
    talk.mode = 'reply';
    await readCurrent();
  }

  const currentReply = () => state.approvals.find((a) => a.id === talk.queue[talk.index]);

  function shortText(t, n = 450) {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? `${s.slice(0, n)}… The rest is on screen.` : s;
  }
  // As one spoken sentence: "…tonight" -> "…tonight." but never "…tonight.."
  const sentence = (t) => { const s = shortText(t); return /[.!?…]$/.test(s) ? s : `${s}.`; };

  async function readCurrent() {
    const a = currentReply();
    renderTalkCard();
    if (!a) {
      talk.mode = 'talk';
      talk.loop = false;
      const left = state.approvals.filter((x) => !state.sending[x.id]).length;
      await say(left ? `That's all for now. ${left} ${left === 1 ? 'reply is' : 'replies are'} still waiting.` : "That's all your replies. You're caught up!");
      return;
    }
    const n = talk.queue.length;
    const head = n > 1 ? `Message ${talk.index + 1} of ${n}. ` : '';
    const channel = (M.channels[a.channel] && M.channels[a.channel].label) || a.channel;
    talkLog('aide', `${head}${a.from} on ${channel}`);
    talkStatus('Reading…');
    await speak(`${head}${a.from}, on ${channel}: ${sentence(a.original)} My draft: ${sentence(a.draft)} ${talk.hinted ? 'Send, change, later, or next?' : REPLY_HINT}`);
    talk.hinted = true;
  }

  function nextInQueue({ removed = false } = {}) {
    if (removed) talk.queue.splice(talk.index, 1); else talk.index += 1;
  }

  async function replyHandle(text) {
    const a = currentReply();
    if (!a) { talk.mode = 'talk'; await talkAsk(text); return; }
    const r = await api('/api/voice/command', { method: 'POST', body: { text } });
    if (talk.mode === 'confirm') {
      if (r.confirm === 'yes') { await voiceSend(a); return; }
      if (r.confirm === 'no') { talk.mode = 'reply'; await say('Okay, not sent. Send, change, later, or next?'); return; }
      await say(`Please say yes to send it to ${a.from}, or no.`);
      return;
    }
    if (talk.mode === 'instruct') { talk.mode = 'reply'; await voiceRevise(a, text); return; }
    switch (r.cmd) {
      case 'send': talk.mode = 'confirm'; renderTalkCard(); await say(`Send this to ${a.from}?`); break;
      case 'edit':
        if (!r.instruction) { talk.mode = 'instruct'; await say('What should I change? For example: make it shorter, or say I\'ll send it tonight.'); }
        else await voiceRevise(a, r.instruction);
        break;
      case 'later': await voiceLater(a, r.when); break;
      case 'next': nextInQueue(); await readCurrent(); break;
      case 'reject':
        await rejectLive(a.id);
        nextInQueue({ removed: true });
        await say(`Dismissed. No reply to ${a.from}.`);
        await readCurrent();
        break;
      case 'repeat': await readCurrent(); break;
      case 'stop': {
        talk.mode = 'talk';
        talk.loop = false;
        const left = state.approvals.filter((x) => !state.sending[x.id]).length;
        await say(left ? `Okay, stopping. ${left} ${left === 1 ? 'reply is' : 'replies are'} still waiting.` : 'Okay, stopping.');
        break;
      }
      default: await say(`Sorry, I didn't catch that. ${REPLY_HINT}`);
    }
  }

  async function voiceSend(a) {
    talk.mode = 'reply';
    await approveLive(a.id); // same path as the Approve button: undo window, toast with Undo
    if (!state.sending[a.id]) { await say("Couldn't send it. Check the screen and try again."); return; }
    nextInQueue({ removed: true });
    await say(`Sending to ${a.from}. You can undo it on screen for a few seconds.`);
    await readCurrent();
  }

  async function voiceRevise(a, instruction) {
    talkStatus('Rewriting…');
    const before = a.draft;
    try {
      const res = await api(`/api/approvals/${a.id}/revise`, { method: 'POST', body: { instruction }, timeout: 60000 });
      Object.assign(a, fromServer(res));
    } catch (e) {
      if (e.status === 409) { nextInQueue({ removed: true }); await say('That reply was already handled.'); await readCurrent(); return; }
      throw e;
    }
    if (state.view === 'approvals') refreshCard(a.id);
    renderTalkCard();
    if (a.draft === before) {
      await say('I couldn\'t make that change. Try: make it shorter, more formal, or say, followed by what to add.');
      return;
    }
    await say(`New draft: ${sentence(a.draft)} Send it, change it again, or next?`);
  }

  function snoozePick(when) {
    const opts = snoozeOptions();
    const find = (prefix) => opts.find(([label]) => label.startsWith(prefix));
    const pick = (when === 'exam' && find('After your exam')) || (when === 'hour' && find('In 1 hour'))
      || (when === 'evening' && find('This evening')) || (when === 'days' && find('In 3 days')) || find('Tomorrow morning');
    return pick;
  }

  async function voiceLater(a, when) {
    const [label, until] = snoozePick(when);
    await api(`/api/approvals/${a.id}/snooze`, { method: 'POST', body: { until: until.toISOString() } });
    removeApproval(a.id);
    loadSnoozed();
    nextInQueue({ removed: true });
    const spoken = label.startsWith('After your exam') ? 'after your exam' : label.toLowerCase();
    await say(`Okay, I'll bring it back ${spoken}.`);
    await readCurrent();
  }

  function renderTalkCard() {
    const box = $('#talk-card');
    if (!box) return;
    const a = talk.mode === 'talk' ? null : currentReply();
    box.hidden = !a;
    const chips = $('#talk-chips');
    if (chips) chips.hidden = !!a;
    if (!a) { box.innerHTML = ''; return; }
    const btn = (text, label, cls = 'btn-ghost') => `<button type="button" class="btn ${cls} btn-sm" data-action="talk-say" data-text="${esc(text)}">${label}</button>`;
    const actions = talk.mode === 'confirm'
      ? `${btn('no', 'No')}${btn('yes', `${icon('send')}Yes, send`, 'btn-primary')}`
      : `${btn('stop', 'Stop')}${btn('next', 'Next')}${btn('later', `${icon('clock')}Later`)}${btn('change it', `${icon('edit')}Change`)}${btn('send', `${icon('send')}Send`, 'btn-primary')}`;
    box.innerHTML = `
      <div class="who-meta">${channelBadge(a.channel)}<span aria-hidden="true">·</span><b>${esc(a.from)}</b>
        <span class="muted">${talk.queue.length > 1 ? `${talk.index + 1} of ${talk.queue.length}` : ''}</span></div>
      <div class="original">${esc(a.original)}</div>
      <div class="field-label">Draft reply</div>
      <div class="talk-draft">${esc(a.draft)}</div>
      <div class="talk-actions">${actions}</div>`;
  }

  function openTalk({ replies = false } = {}) {
    talk.open = true;
    talk.mode = 'talk';
    talk.loop = false;
    talk.busy = false;
    const v = voiceSupported();
    const suggestions = ["What's on today?", 'What should I study?', "When's my next exam?", 'Go through my replies'];
    openSheet(`
      <h2 class="sheet-title" id="sheet-title">Talk to ${esc(M.agent.name)}</h2>
      <div class="talk">
        <div class="talk-card card" id="talk-card" hidden></div>
        <div class="talk-log" id="talk-log" aria-live="polite"></div>
        ${v ? `<div class="talk-controls">
          <button type="button" class="talk-orb" id="talk-orb" data-action="talk-mic" aria-pressed="false" aria-label="Talk">${icon('mic')}</button>
        </div>` : ''}
        <p class="talk-status" id="talk-status" role="status">${v ? 'Tap the mic and ask' : 'Type below. (Voice needs Chrome or Edge.)'}</p>
        <div class="chip-row talk-chips" id="talk-chips">
          ${suggestions.map((s) => `<button type="button" class="chip chip-sm pressable" data-action="talk-say" data-text="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
        <form class="talk-form" data-form="talk">
          <label class="sr-only" for="talk-input">Ask ${esc(M.agent.name)}</label>
          <input id="talk-input" class="input" autocomplete="off" placeholder="Or type: remind me to submit the lab record Friday" />
          <button class="btn btn-primary btn-sm" type="submit">Ask</button>
        </form>
        <p class="muted talk-note">${icon('info')}Sending always needs your yes. Food is planned, never ordered, by voice.</p>
      </div>`, { focus: v ? '#talk-orb' : '#talk-input', onClose: closeTalk });
    if (replies) {
      talk.busy = true;
      startReplies().catch(() => say("I can't reach the Aide server right now.")).finally(() => {
        talk.busy = false;
        renderTalkCard();
        if (talk.open && voiceSupported() && talk.mode !== 'talk') talkListen(); else talkStatus(idleStatus());
      });
    }
  }

  function closeTalk() {
    talk.open = false;
    talk.loop = false;
    talkStopListening();
    if (speakSupported()) window.speechSynthesis.cancel();
  }

  // ----- change a draft by voice (the mic chip on each approval card) ---------
  function voiceEditDraft(btn, id) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Voice input isn't supported in this browser. Try Chrome or Edge."); return; }
    if (recognition) { stopMic(); return; }
    let heard = '';
    recognition = new SR();
    recognition.lang = voiceLang();
    recognition.onresult = (e) => { heard = [...e.results].map((r) => r[0].transcript).join(''); };
    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone access is blocked. Allow it in your browser\'s site settings.');
    };
    recognition.onend = () => {
      recognition = null;
      btn.classList.remove('listening');
      btn.setAttribute('aria-pressed', 'false');
      if (heard.trim()) reviseLive(id, heard.trim());
    };
    recognition.start();
    btn.classList.add('listening');
    btn.setAttribute('aria-pressed', 'true');
    toast('Say the change: "make it shorter", "say I\'ll send it tonight"…');
  }

  async function reviseLive(id, instruction) {
    const item = state.approvals.find((a) => a.id === id);
    if (!item || state.regenerating[id] || state.sending[id]) return;
    if (!state.live) { toast('Changing drafts needs the Aide server'); return; }
    const before = item.draft;
    state.regenerating[id] = 'voice';
    refreshCard(id);
    try {
      const a = await api(`/api/approvals/${id}/revise`, { method: 'POST', body: { instruction }, timeout: 60000 });
      Object.assign(item, fromServer(a));
      toast(item.draft === before ? `Couldn't do “${instruction}”. Try shorter, more formal, or “say …”.` : `Changed: “${instruction}”`);
    } catch (e) {
      toast(e.status === 409 ? 'That reply was already handled' : "Couldn't change the draft. Try again.");
    }
    delete state.regenerating[id];
    refreshCard(id);
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
      { label: 'Search', icon: 'search', run: openSearch },
      { label: `Talk to ${M.agent.name}`, icon: 'mic', run: () => openTalk() },
      { label: 'Go through replies by voice', icon: 'mic', run: () => openTalk({ replies: true }) },
      { label: 'Study plan', icon: 'book', run: () => go('study') },
      { label: 'Order food', icon: 'food', run: () => { go('food'); const f = $('#food-text'); if (f) f.focus(); } },
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
    voice: (el) => toggleMic(el),
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

    // ----- study, people, search, snooze, auto-send, backup ------------------------
    'study-done': (el) => {
      const sess = state.study && state.study.sessions.concat(state.study.today).find((x) => String(x.id) === el.dataset.id);
      studyCall(`/api/study/sessions/${el.dataset.id}`, { method: 'PATCH', body: { done: !(sess && sess.done) } },
        sess && !sess.done ? `Done: ${sess.subject}, ${sess.topic}. Nice!` : null);
    },
    'study-delete': (el) => studyCall(`/api/study/subjects/${el.dataset.id}`, { method: 'DELETE' }, 'Removed from the plan'),
    'study-replan': () => studyCall('/api/study/replan', { method: 'POST' }, 'Plan rebuilt. Missed sessions moved forward.'),
    'study-suggest': (el) => {
      const det = $('.st-add');
      if (det) det.open = true;
      const f = $('[data-form="study-subject"]');
      f.elements.name.value = el.dataset.title.replace(/^(reminder:\s*)/i, '').split(/\s+(exam|viva|test|quiz|mid-?sem|end-?sem)\b/i)[0].slice(0, 80) || el.dataset.title.slice(0, 80);
      f.elements.examDate.value = el.dataset.date;
      $('#st-topics').focus();
      toast('Add the topics (or leave them empty), then tap "Add to plan"');
    },
    'search-open': () => openSearch(),
    'talk-open': () => openTalk(),
    'talk-replies': () => openTalk({ replies: true }),
    'talk-mic': () => {
      if (talk.rec) { talk.loop = false; talkStopListening(); talkStatus(idleStatus()); return; }
      if (talk.busy) return;
      talk.loop = true;
      talkListen();
    },
    'talk-say': (el) => { talk.loop = false; talkHandle(el.dataset.text); },
    'talk-view': (el) => { closeSheet(); go(el.dataset.view); },
    'voice-edit': (el) => voiceEditDraft(el, el.dataset.id),
    'voice-speak-toggle': (el) => {
      const on = !speakOn();
      store.set('voiceSpeak', on);
      el.setAttribute('aria-checked', String(on));
      toast(on ? 'Aide will read answers aloud' : 'Answers will be shown, not spoken');
    },
    'search-go': (el) => { closeSheet(); go(el.dataset.view); },
    'snooze-open': (el) => openSnooze(el.dataset.id),
    'snooze-pick': async (el) => {
      closeSheet();
      try {
        const a = await api(`/api/approvals/${el.dataset.id}/snooze`, { method: 'POST', body: { until: el.dataset.until } });
        state.approvals = state.approvals.filter((x) => x.id !== String(a.id));
        state.snoozed = [...(state.snoozed || []), fromServer(a)];
        renderAll();
        toast(`Got it. ${a.from} will be back ${new Date(a.snoozeUntil).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`,
          { action: 'Undo', onAction: () => ACTIONS.unsnooze({ dataset: { id: String(a.id) } }) });
        loadLive();
      } catch (e) { toast(`Couldn't snooze it: ${e.message}`); }
    },
    unsnooze: async (el) => {
      try {
        await api(`/api/approvals/${el.dataset.id}/unsnooze`, { method: 'POST' });
        state.snoozed = (state.snoozed || []).filter((x) => x.id !== String(el.dataset.id));
        await loadLive();
        renderAll();
      } catch (e) { toast(`Couldn't bring it back: ${e.message}`); }
    },
    'autosend-toggle': async () => {
      try {
        state.autosend = await api('/api/autosend', { method: 'PUT', body: { enabled: !(state.autosend && state.autosend.enabled) } });
        renderView();
        toast(state.autosend.enabled ? 'Auto-send on for the safest replies. Everything else still waits for you.' : 'Auto-send off. Everything waits for your OK.');
      } catch (e) { toast(`Couldn't change it: ${e.message}`); }
    },
    'restore-confirm': async () => {
      const data = state.pendingRestore;
      closeSheet();
      if (!data) return;
      try {
        const r = await api('/api/backup/restore', { method: 'POST', body: data, timeout: 60000 });
        toast(`Restored. Safety copy saved as ${r.safetyCopy}. Reloading…`);
        setTimeout(() => location.reload(), 1500);
      } catch (e) { toast(e.message); }
      state.pendingRestore = null;
    },

    // ----- phone access ----------------------------------------------------------
    'lan-new-pin': async () => {
      try { const r = await api('/api/lan/pin', { method: 'POST' }); state.lan.pin = r.pin; renderView(); toast('New PIN ready'); }
      catch (e) { toast(`Couldn't make a new PIN: ${e.message}`); }
    },
    'lan-remove': async (el) => {
      try {
        await api(`/api/lan/devices/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' });
        state.lan.devices = state.lan.devices.filter((d) => d.id !== el.dataset.id);
        renderView();
        toast('Removed. That phone can no longer open Aide.');
      } catch (e) { toast(`Couldn't remove it: ${e.message}`); }
    },

    // ----- quiet mode, notifications, deadlines ----------------------------------
    'quiet-open': () => openQuiet(),
    'quiet-start': (el) => {
      const allow = $('#quiet-allow');
      const body = { until: quietEnd(el.dataset.until).toISOString() };
      if (allow) body.allow = allow.value.split(',').map((x) => x.trim()).filter(Boolean);
      closeSheet();
      setQuiet(body, (q) => `Quiet mode on until ${fmtClock(q.until)}. Only urgent messages${q.allow.length ? ` and ${q.allow.join(', ')}` : ''} will alert you.`);
    },
    'quiet-off': () => {
      const held = quiet().held; // read before it resets
      setQuiet({ until: null }, held
        ? `Quiet mode off. ${held} ${held === 1 ? 'reply is' : 'replies are'} waiting for you.`
        : 'Quiet mode off. Nothing new while you were away.');
    },
    'notif-enable': async () => {
      if (!('Notification' in window)) return;
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      state.notify.on = perm === 'granted';
      saveNotify();
      renderView();
      toast(state.notify.on ? 'Notifications on' : "Notifications weren't allowed");
    },
    'notif-off': () => { state.notify.on = false; saveNotify(); renderView(); toast('Notifications off'); },
    'notif-test': () => notify('Aide test', 'Notifications are working.', { tag: 'test', important: true, force: true }),
    'notif-pref': (el) => {
      if (!state.notify.on) return;
      state.notify[el.dataset.key] = !state.notify[el.dataset.key];
      saveNotify();
      el.setAttribute('aria-checked', state.notify[el.dataset.key]);
    },
    'dl-done': async (el) => {
      const d = (state.deadlines || []).find((x) => String(x.id) === el.dataset.id);
      if (!d) return;
      try {
        const saved = await api(`/api/deadlines/${d.id}`, { method: 'PATCH', body: { done: !d.done } });
        Object.assign(d, saved);
        renderView();
        if (saved.done) toast(`Done: ${saved.title}`, { action: 'Undo', onAction: () => ACTIONS['dl-done']({ dataset: { id: String(d.id) } }) });
        loadLive();
      } catch (e) { toast(`Couldn't update it: ${e.message}`); }
    },
    'dl-delete': async (el) => {
      try {
        await api(`/api/deadlines/${el.dataset.id}`, { method: 'DELETE' });
        state.deadlines = state.deadlines.filter((x) => String(x.id) !== el.dataset.id);
        renderView();
        toast('Removed');
        loadLive();
      } catch (e) { toast(`Couldn't remove it: ${e.message}`); }
    },

    // ----- food ---------------------------------------------------------------
    'food-app': (el) => {
      state.food.app = el.dataset.app;
      document.querySelectorAll('[data-action="food-app"]').forEach((b) => b.setAttribute('aria-checked', b === el));
    },
    'food-fav': (el) => {
      const t = $('#food-text');
      t.value = t.value.trim() ? `${t.value.trim()}, ${el.dataset.text}` : el.dataset.text;
      t.focus();
    },
    'food-qty': (el) => {
      const o = orderById(el.dataset.order);
      const items = o.items.map((it, i) => (i === +el.dataset.idx ? { ...it, qty: Math.max(1, Math.min(50, it.qty + +el.dataset.d)) } : it));
      patchOrder(o.id, { items });
    },
    'food-remove': (el) => {
      const o = orderById(el.dataset.order);
      const removed = o.items[+el.dataset.idx];
      patchOrder(o.id, { items: o.items.filter((_, i) => i !== +el.dataset.idx) }).then((saved) => {
        if (saved) toast(`Removed ${removed.name}`, { action: 'Undo', onAction: () => { const cur = orderById(o.id); const items = [...cur.items]; items.splice(+el.dataset.idx, 0, removed); patchOrder(o.id, { items }); } });
      });
    },
    // Step 1 of 2: you approve the cart here (Claude then needs your "yes, place it" before ordering).
    'food-approve': (el) => {
      const o = orderById(el.dataset.order);
      if (!o || !o.canApprove) return;
      const p = state.food.profile;
      const cautions = o.checks.filter((c) => c.level === 'warn' || (c.level === 'info' && /cancel|QR/.test(c.text)));
      openSheet(`
        <h2 class="sheet-title" id="sheet-title">Approve this cart?</h2>
        <p class="sheet-sub">${esc(o.appLabel)} · ${esc(o.restaurant || 'restaurant to pick in Claude')} · budget ₹${o.budget ?? p.budgetCap}</p>
        <ul class="confirm-items">${o.items.map((it) => `<li><b>${it.qty}×</b> ${esc(it.name)}${it.notes ? ` <span class="muted">(${esc(it.notes)})</span>` : ''}</li>`).join('')}</ul>
        ${o.notes ? `<p class="sheet-sub">Notes: ${esc(o.notes)}</p>` : ''}
        ${cautions.length ? `<ul class="food-checks">${cautions.map((c) => `<li class="chk ${c.level}">${icon(CHECK_ICON[c.level])}<span>${esc(c.text)}</span></li>`).join('')}</ul>` : ''}
        <p class="confirm-note">${icon('info')}<span>Nothing is ordered yet. Next, Claude shows you the real ${esc(o.appLabel)} cart with prices and only places it after you reply “yes, place it”.</span></p>
        <div class="capture-actions">
          <button type="button" class="btn btn-ghost" data-action="sheet-close">Keep editing</button>
          <button type="button" class="btn btn-primary" data-action="food-approve-confirm" data-order="${o.id}">${icon('check')}Yes, approve this cart</button>
        </div>`);
    },
    'food-approve-confirm': (el) => {
      closeSheet();
      foodCall(`/api/food/orders/${el.dataset.order}/approve`, { method: 'POST' }, 'Cart approved. Now place it in Claude.');
    },
    'sheet-close': () => closeSheet(),
    'food-cancel': (el) => foodCall(`/api/food/orders/${el.dataset.order}/cancel`, { method: 'POST' }, 'Cart cancelled'),
    'food-ordered': (el) => foodCall(`/api/food/orders/${el.dataset.order}/ordered`, { method: 'POST' }, 'Marked as ordered. Enjoy your meal!'),
    'food-copy': async (el) => {
      const o = orderById(el.dataset.order);
      if (await copyText(o.handoffPrompt)) toast('Instructions copied. Paste them into Claude.');
      else { const d = el.closest('.food-handoff').querySelector('details'); d.open = true; const t = $(`#prompt-${o.id}`); t.focus(); t.select(); toast('Copy blocked by the browser: press Ctrl+C to copy the selected text.'); }
    },
    'food-claude': async (el) => {
      const o = orderById(el.dataset.order);
      // Open first (inside the click, so it isn't blocked), then copy. The ?q= prefill is
      // undocumented, so the clipboard is the reliable path.
      window.open(`https://claude.ai/new?q=${encodeURIComponent(o.handoffPrompt)}`, '_blank', 'noopener');
      const ok = await copyText(o.handoffPrompt);
      toast(ok ? 'Claude opened and instructions copied. If the box is empty, paste with Ctrl+V.' : 'Claude opened. Use "Copy instructions" and paste them there.');
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
      const asNote = () => {
        state.messages.push({ id: uid(), role: 'user', day: 'Today', text, time: nowTime() });
        state.messages.push({ id: uid(), role: 'agent', day: 'Today', text: "Got it. I'll take care of that and let you know if I need anything.", time: nowTime() });
        if (state.view === 'chat') refreshChatLog();
        toast(`Sent to ${M.agent.name}`, { action: 'View', onAction: () => go('chat') });
      };
      closeSheet();
      if (!state.live) { asNote(); return; }
      // The server decides: food order, deadline, or a plain note.
      api('/api/capture', { method: 'POST', body: { text } }).then((r) => {
        if (r.kind === 'food') {
          replaceOrder(r.order);
          toast(`Planned a ${r.order.appLabel} cart: ${r.order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}`, { action: 'Review', onAction: () => go('food') });
        } else if (r.kind === 'deadline') {
          if (state.deadlines) state.deadlines.push(r.deadline);
          toast(`Added: ${r.deadline.title} (${dlWhen(r.deadline)})`, { action: 'View', onAction: () => go('tasks') });
          loadLive();
        } else asNote();
      }).catch(asNote);
    }

    if (kind === 'talk') {
      const input = $('#talk-input');
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      input.value = '';
      talk.loop = false;
      talkHandle(text);
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

    if (kind === 'study-subject') {
      const el = form.elements;
      const topics = el.topics.value.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
      studyCall('/api/study/subjects', { method: 'POST', body: {
        name: el.name.value.trim(), examDate: el.examDate.value, topics, minutesPerTopic: Number(el.minutesPerTopic.value),
      } }, `Added ${el.name.value.trim()} to your plan`);
    }

    if (kind === 'person') {
      const el = form.elements;
      const name = el.name.value.trim();
      api(`/api/people/${encodeURIComponent(name)}`, { method: 'PUT', body: { notes: el.notes.value.trim() } })
        .then(() => { toast(`Saved notes for ${name}`); loadPeople(); })
        .catch((err) => toast(`Couldn't save: ${err.message}`));
    }

    if (kind === 'pair') {
      const pin = $('#pair-pin').value.replace(/\D/g, '');
      if (pin.length !== 6) { toast('Enter the 6-digit PIN from your computer'); return; }
      api('/api/pair', { method: 'POST', body: { pin } })
        .then(() => { state.needsPair = false; state.live = false; toast('Paired. Welcome to Aide on your phone!'); renderAll(); loadLive(); })
        .catch((err) => { toast(err.message); const i = $('#pair-pin'); i.value = ''; i.focus(); });
    }

    if (kind === 'deadline') {
      const el = form.elements;
      const body = { title: el.title.value.trim(), kind: el.kind.value, dueDate: el.dueDate.value, dueTime: el.dueTime.value || null };
      if (!body.title || !body.dueDate) return;
      api('/api/deadlines', { method: 'POST', body })
        .then((d) => { state.deadlines = [...(state.deadlines || []), d]; renderView(); toast(`Added: ${d.title} (${dlWhen(d)})`); loadLive(); const t = $('#dl-title'); if (t) t.focus(); })
        .catch((err) => toast(`Couldn't add it: ${err.message}`));
    }

    if (kind === 'quiet-allow') {
      const allow = $('#quiet-allow').value.split(',').map((x) => x.trim()).filter(Boolean);
      setQuiet({ allow }, (q) => (q.allow.length ? `Always allowed: ${q.allow.join(', ')}` : 'Allow list cleared'));
    }

    if (kind === 'food-plan') {
      const input = $('#food-text');
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      state.food.busy = true;
      renderView();
      api('/api/food/orders', { method: 'POST', body: { text, app: state.food.app || state.food.profile.preferredApp } })
        .then((o) => {
          replaceOrder(o);
          toast(o.canApprove ? 'Cart planned. Check it, then approve.' : 'Cart planned, but something needs fixing (see the red check).');
        })
        .catch((err) => toast(`Couldn't plan that: ${err.message}`))
        .finally(() => { state.food.busy = false; renderView(); });
    }

    if (kind === 'food-add') {
      const o = orderById(form.dataset.order);
      const raw = form.elements.dish.value.trim();
      if (!o || !raw) return;
      const m = raw.match(/^(\d{1,2})\s*(?:x|×)?\s+(.+)$/i);
      const item = m ? { name: m[2], qty: Math.min(50, +m[1] || 1), notes: '' } : { name: raw, qty: 1, notes: '' };
      patchOrder(o.id, { items: [...o.items, item] });
    }

    if (kind === 'food-prefs') {
      const el = form.elements;
      const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
      const body = {
        area: el.area.value.trim(), diet: el.diet.value, spice: el.spice.value,
        budgetCap: Math.max(0, parseInt(el.budgetCap.value, 10) || 0), preferredApp: el.preferredApp.value,
        favorites: list(el.favorites.value), avoid: list(el.avoid.value), notes: el.notes.value.trim(),
      };
      api('/api/food/profile', { method: 'PATCH', body })
        .then((p) => { state.food.profile = p; state.food.app = p.preferredApp; toast('Food preferences saved'); loadFood(); })
        .catch((err) => toast(`Couldn't save: ${err.message}`));
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
    if (t.id === 'search-input') { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(t.value), 250); }
    if (t.id === 'people-filter') {
      state.peopleFilter = t.value;
      const pos = t.selectionStart;
      renderView();
      const f = $('#people-filter');
      if (f) { f.focus(); f.setSelectionRange(pos, pos); }
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.filter) { state.activityFilter[t.dataset.filter] = t.value; renderView(); $('#' + t.id).focus(); }
    if (t.dataset.input === 'draft') saveDraft(t.dataset.id); // fires on blur after an edit
    if (t.dataset.input === 'limit') { /* TODO(api): PATCH /api/settings { dailyLimit } */ toast(`Daily limit set to ${t.value}`); }
  });

  // Food cart fields save when you leave them (change fires on blur / Enter).
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'study-daily') {
      studyCall('/api/study/settings', { method: 'PUT', body: { dailyMinutes: Number(t.value) } }, `Plan rebuilt for ${fmtMinsLong(Number(t.value))} a day`);
      return;
    }
    if (t.id === 'voice-lang') { store.set('voiceLang', t.value); toast(`Voice language: ${t.selectedOptions[0].textContent}`); return; }
    if (t.id === 'voice-rate') { store.set('voiceRate', Number(t.value)); toast(`Speaking speed: ${t.selectedOptions[0].textContent}`); return; }
    if (t.id === 'autosend-cap') {
      api('/api/autosend', { method: 'PUT', body: { dailyCap: Number(t.value) } })
        .then((a) => { state.autosend = a; toast(`Auto-send limit: ${a.dailyCap} a day`); })
        .catch((err) => toast(`Couldn't change it: ${err.message}`));
      return;
    }
    if (t.id === 'restore-file' && t.files && t.files[0]) { restoreFrom(t.files[0]); t.value = ''; return; }
    if (t.dataset && t.dataset.person !== undefined) {
      const name = t.dataset.person;
      api(`/api/people/${encodeURIComponent(name)}`, { method: 'PUT', body: { notes: t.value.trim() } })
        .then(() => { const p = (state.people || []).find((x) => x.name === name); if (p) p.notes = t.value.trim(); toast(`Saved notes for ${name}`); })
        .catch((err) => toast(`Couldn't save: ${err.message}`));
      return;
    }
    if (t.id === 'brief-time' && /^\d{2}:\d{2}$/.test(t.value)) {
      state.notify.briefTime = t.value;
      saveNotify();
      toast(`Morning brief at ${fmt12(t.value)}`);
      return;
    }
    if (!t.dataset || !t.dataset.food) return;
    const o = orderById(t.dataset.order);
    if (!o || o.status !== 'planned') return;
    const v = t.value.trim();
    const kind = t.dataset.food;
    if (kind === 'name' || kind === 'item-notes') {
      if (kind === 'name' && !v) { t.value = o.items[+t.dataset.idx].name; return; }
      const key = kind === 'name' ? 'name' : 'notes';
      patchOrder(o.id, { items: o.items.map((it, i) => (i === +t.dataset.idx ? { ...it, [key]: v } : it)) });
    } else if (kind === 'budget') {
      patchOrder(o.id, { budget: v === '' ? null : Math.max(0, parseInt(v, 10) || 0) });
    } else {
      patchOrder(o.id, { [kind]: v });
    }
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
      const [pending, stats, brief] = await Promise.all([
        api('/api/approvals?status=pending', { timeout: 4000 }), api('/api/stats', { timeout: 4000 }), api('/api/brief', { timeout: 4000 }),
      ]);
      const wasLive = state.live;
      const briefChanged = JSON.stringify(brief) !== JSON.stringify(state.brief);
      if (!state.brief) state.wasQuiet = brief.quiet.active;
      state.brief = brief;
      notifyNewDrafts(pending);
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
      if (!wasLive) { loadExtras(); loadFood(); loadDeadlines(); loadStudy(); loadSnoozed(); }
      const wasOffline = state.offline;
      state.offline = false;
      if (render && (changed || statsChanged || wasOffline || (briefChanged && ['home', 'settings'].includes(state.view))) && !focused && !sheet.open) renderAll();
      scheduleTick();
    } catch (e) {
      if (e.status === 401) return; // waiting for this phone to be paired
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
        auto: a.auto,
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
      // These two are optional: /api/lan answers only on the computer running Aide.
      state.weekly = await api('/api/weekly').catch(() => null);
      state.lan = await api('/api/lan').catch(() => null);
      state.autosend = state.lan ? await api('/api/autosend').catch(() => null) : null;
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
    // Clicking a notification focuses Aide and opens the right screen.
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'go' && VIEW_FNS[e.data.view]) go(e.data.view); });
  }
})();
