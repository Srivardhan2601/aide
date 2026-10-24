// ---------------------------------------------------------------------------
// Aide: mock data
// Every placeholder value the UI shows lives in this file. Each block notes the
// endpoint it will eventually come from, so you can swap it out piece by piece.
// ---------------------------------------------------------------------------

window.MOCK = {
  agent: { name: 'Aide' },
  // TODO(api): GET /api/me
  user: { name: 'Sri Vardhan' },

  // One entry per app. Order here is the order in the sidebar and Apps page.
  channels: {
    gmail:     { label: 'Gmail',     color: '#ea4335' },
    outlook:   { label: 'Outlook',   color: '#0078d4' },
    whatsapp:  { label: 'WhatsApp',  color: '#25d366' },
    instagram: { label: 'Instagram', color: '#e1306c' },
    x:         { label: 'X',         color: '#27272a', edge: '#a1a1aa' }, // edge: lighter accent where the brand color would vanish on dark backgrounds
    telegram:  { label: 'Telegram',  color: '#229ed9' },
    slack:     { label: 'Slack',     color: '#8b5cf6' },
    linkedin:  { label: 'LinkedIn',  color: '#0a66c2' },
    calendar:  { label: 'Calendar',  color: '#6366f1' },
  },

  // Per-app inbox: conversations (or events, for Calendar).
  // status: new | awaiting (draft ready) | handled | flagged
  // TODO(api): GET /api/apps/:id/inbox
  inbox: [
    { id: 'i1',  channel: 'gmail',     from: 'Priya Nair',        preview: "Could we push Thursday's design review to Friday?", time: '9:14 AM',  unread: true,  status: 'awaiting' },
    { id: 'i2',  channel: 'gmail',     from: 'Northwind Billing', preview: 'Invoice #4821 for $1,240.00 is due on October 15',   time: '10:02 AM', unread: true,  status: 'flagged' },
    { id: 'i3',  channel: 'gmail',     from: 'Jordan Lee',        preview: 'Q4 roadmap draft is ready for comments',             time: '8:55 AM',  unread: true,  status: 'new' },
    { id: 'i4',  channel: 'gmail',     from: 'Lena Fischer',      preview: 'Does Tuesday at 3 still work for the call?',         time: '8:40 AM',  unread: false, status: 'handled' },
    { id: 'i19', channel: 'outlook',   from: 'HR Team',           preview: 'Reminder: submit your timesheet by Friday',          time: '9:20 AM',  unread: true,  status: 'new' },
    { id: 'i20', channel: 'outlook',   from: 'Daniel Brooks',     preview: 'Can you send the client deck before the 2 PM call?', time: '8:58 AM',  unread: true,  status: 'new' },
    { id: 'i21', channel: 'outlook',   from: 'IT Support',        preview: 'Your laptop upgrade is scheduled for Monday',        time: 'Yesterday', unread: false, status: 'handled' },
    { id: 'i22', channel: 'x',         from: '@techwithtara',     preview: 'Mentioned you: "Great thread on design systems by…"', time: '10:12 AM', unread: true,  status: 'new' },
    { id: 'i23', channel: 'x',         from: '@devon_builds',     preview: 'DM: Would you be up for a podcast episode?',         time: '9:01 AM',  unread: true,  status: 'new' },
    { id: 'i24', channel: 'x',         from: '@crypto_gains_99',  preview: 'DM: Send 0.1 ETH and get 1 ETH back today',          time: 'Yesterday', unread: false, status: 'flagged' },
    { id: 'i5',  channel: 'whatsapp',  from: 'Sam Okafor',        preview: 'Are we still on for lunch today?',                   time: '9:40 AM',  unread: true,  status: 'awaiting' },
    { id: 'i6',  channel: 'whatsapp',  from: 'Mom',               preview: 'Call me when you are free tonight',                  time: '9:05 AM',  unread: true,  status: 'new' },
    { id: 'i7',  channel: 'whatsapp',  from: 'Unknown number',    preview: 'Please share your bank details to claim the prize', time: 'Yesterday', unread: false, status: 'flagged' },
    { id: 'i8',  channel: 'instagram', from: '@maya.designs',     preview: 'Loved your latest post! Open to a collab?',          time: '10:30 AM', unread: true,  status: 'awaiting' },
    { id: 'i9',  channel: 'instagram', from: '@jess.k',           preview: 'Thanks for the shoutout!',                           time: '9:50 AM',  unread: false, status: 'handled' },
    { id: 'i10', channel: 'instagram', from: '@brandco',          preview: 'Paid partnership inquiry for November',              time: '8:20 AM',  unread: true,  status: 'new' },
    { id: 'i11', channel: 'telegram',  from: 'Maya',              preview: 'Sent you the photos from Saturday',                  time: '8:10 AM',  unread: false, status: 'handled' },
    { id: 'i12', channel: 'telegram',  from: 'Dev Chat',          preview: '14 new messages',                                    time: '7:45 AM',  unread: true,  status: 'new' },
    { id: 'i13', channel: 'slack',     from: '#design-team',      preview: "Jordan: can someone confirm they're joining the 4:30 crit?", time: '10:21 AM', unread: true, status: 'awaiting' },
    { id: 'i14', channel: 'slack',     from: 'Jordan Lee',        preview: 'Got a minute to look at the onboarding flow?',      time: '9:30 AM',  unread: true,  status: 'new' },
    { id: 'i15', channel: 'slack',     from: '#eng-releases',     preview: 'v2.4 deployed to production',                        time: 'Yesterday', unread: false, status: 'handled' },
    { id: 'i16', channel: 'calendar',  from: 'Design sync',       preview: 'Today, 10:00 – 10:30 · 4 guests',                    time: 'Today',    unread: false, status: 'handled' },
    { id: 'i17', channel: 'calendar',  from: 'Lunch with Sam',    preview: 'Today, 13:00 · Ramen place on 5th',                  time: 'Today',    unread: false, status: 'handled' },
    { id: 'i18', channel: 'calendar',  from: 'Vendor demo',       preview: 'Invite from Acme Sales · Fri 11:00 · needs a response', time: 'Fri',   unread: true,  status: 'new' },
  ],

  // Live: GET /api/stats (wired in app.js loadLive). Used only as offline sample data.
  // timeSavedWeek: minutes saved on each of the last 7 days, oldest first, today last.
  stats: { handledToday: 42, timeSavedMinutes: 84, streakDays: 12, timeSavedWeek: [52, 61, 47, 73, 66, 38, 84] },

  quickActions: ['Summarize my inbox', 'Draft a reply', "What's on my calendar today?"],

  // Suggestion chips on Home and in Chat, picked by time of day.
  suggestions: {
    morning:   ["Today's plan", 'Summarize my inbox', "What's on my calendar today?"],
    afternoon: ["What's left today?", 'Summarize my inbox', 'Draft a reply'],
    evening:   ['Wrap up my day', 'Plan tomorrow', 'Summarize my inbox'],
  },

  // Feed messages.
  // apps:       which app(s) it's about. One app shows "via <App>"; several show a row of tags.
  // day:        groups the feed under "Yesterday" / "Today" separators.
  // approvalId: shows that draft inline with Approve / Edit / Skip.
  // readOnly:   the app is read only, so show "Reply manually" (manualUrl) instead of actions.
  // TODO(api): GET /api/chat/history
  messages: [
    {
      id: 'y1', role: 'agent', day: 'Yesterday', time: '6:40 PM', apps: [{ id: 'whatsapp' }],
      text: 'I flagged a WhatsApp message asking for your bank details as likely spam. Nothing was sent.',
    },
    { id: 'y2', role: 'user', day: 'Yesterday', time: '9:12 PM', text: 'Remind me to send the client deck tomorrow morning' },
    { id: 'y3', role: 'agent', day: 'Yesterday', time: '9:12 PM', text: "Done. I'll nudge you at 9:00 AM." },
    {
      id: 'm1', role: 'agent', day: 'Today', time: '8:02 AM',
      text: 'Good morning. I handled 12 messages overnight and have 5 drafts waiting for your approval. Want a quick summary?',
      apps: [
        { id: 'gmail', note: '2 drafts' },
        { id: 'whatsapp', note: '1' },
        { id: 'instagram', note: '1' },
        { id: 'slack', note: '1' },
      ],
    },
    {
      id: 'm5', role: 'agent', day: 'Today', time: '9:14 AM', apps: [{ id: 'gmail' }], approvalId: 'a1',
      text: "Priya wants to move Thursday's design review to Friday. I drafted a reply:",
    },
    {
      id: 'm2', role: 'agent', day: 'Today', time: '9:20 AM', apps: [{ id: 'outlook' }],
      text: 'HR reminded you to submit your timesheet by Friday. Want me to add a reminder for Thursday afternoon?',
    },
    {
      id: 'm6', role: 'agent', day: 'Today', time: '9:40 AM', apps: [{ id: 'whatsapp' }], approvalId: 'a2',
      text: "Sam is checking you're still on for lunch. Here's a reply:",
    },
    {
      id: 'm3', role: 'agent', day: 'Today', time: '10:12 AM', apps: [{ id: 'x' }], readOnly: true,
      manualUrl: 'https://x.com/notifications',
      text: "@techwithtara mentioned you in a thread about design systems. X is set to read only, so I haven't replied.",
    },
    {
      id: 'm4', role: 'agent', day: 'Today', time: '10:30 AM', apps: [{ id: 'instagram' }], approvalId: 'a5',
      text: '@maya.designs asked about a collab next month. I drafted a reply:',
    },
  ],

  // Canned replies used by the fake chat. Matched by keyword (lowercase).
  // TODO(api): remove once /api/chat returns real responses.
  cannedReplies: [
    {
      match: 'tomorrow',
      apps: [{ id: 'calendar' }],
      text: "Tomorrow looks light:\n• 9:30 – Standup\n• 14:00 – Client review with Daniel\nI'll send the client deck reminder at 9:00 and hold 10:00–12:00 as focus time unless you say otherwise.",
    },
    {
      match: 'plan',
      apps: [{ id: 'calendar' }, { id: 'gmail' }],
      text: "Here's your day:\n• 10:00 – Design sync\n• 13:00 – Lunch with Sam\n• 16:30 – 1:1 with Jordan\nTo do: reply to Priya, send Daniel the client deck, and submit your timesheet by Friday.",
    },
    {
      match: 'wrap',
      apps: [{ id: 'gmail' }, { id: 'slack' }, { id: 'instagram' }],
      text: "Today I handled 42 things and saved you about 1h 24m.\nStill open:\n• 5 drafts waiting for your OK\n• Daniel's client deck\nWant me to carry these over to tomorrow morning?",
    },
    {
      match: 'left today',
      text: "Still open today:\n• 5 drafts waiting for your OK\n• 1:1 with Jordan at 16:30\n• Send Daniel the client deck before 14:00",
    },
    {
      match: 'inbox',
      apps: [{ id: 'gmail', note: '3 need attention' }, { id: 'outlook', note: '2 unread' }],
      text: "You have 25 unread emails. 5 need attention:\n• Gmail: Priya asked to move Thursday's review to Friday.\n• Gmail: Your Northwind invoice is due on Oct 15.\n• Gmail: Jordan shared the Q4 roadmap draft.\n• Outlook: Daniel needs the client deck before the 2 PM call.\n• Outlook: HR timesheet is due Friday.\nThe rest are newsletters and notifications. I archived 14 of them.",
    },
    {
      match: 'calendar',
      apps: [{ id: 'calendar' }],
      text: "You have 3 events today:\n• 10:00 – Design sync (30 min)\n• 13:00 – Lunch with Sam\n• 16:30 – 1:1 with Jordan\nYou're free between 11:00 and 12:30 if you want focus time.",
    },
    {
      match: 'conversation',
      text: "Here's the short version: they wrote recently and are waiting on a reply from you. I can draft one in your usual tone. It will go to Approvals before anything is sent.",
    },
    {
      match: 'draft',
      text: "Sure. Who is it for? Paste the message or name the thread and I'll draft a reply in your usual tone. It will land in Approvals before anything is sent.",
    },
  ],
  defaultReply: "Got it. I'll look into that and report back here. Nothing gets sent without your OK unless it matches an Auto-handle rule.",

  // Live: GET /api/approvals?status=pending (wired in app.js loadLive). Used only as offline sample data.
  approvals: [
    {
      id: 'a1', from: 'Priya Nair', channel: 'gmail', time: '9:14 AM', confidence: 'high', autoSend: false,
      original: "Hi! Could we push Thursday's design review to Friday at the same time? Something came up on our side.",
      draft: "Hi Priya, no problem at all. Friday at 2:00 PM works for me and I've moved the invite. See you then!",
    },
    {
      id: 'a2', from: 'Sam Okafor', channel: 'whatsapp', time: '9:40 AM', confidence: 'medium', autoSend: false,
      original: 'Are we still on for lunch today? Thinking that new ramen place on 5th.',
      draft: 'Yes, still on! Ramen sounds great. Meet there at 1?',
    },
    {
      id: 'a3', from: 'Northwind Billing', channel: 'gmail', time: '10:02 AM', confidence: 'low', autoSend: false,
      original: 'Your invoice #4821 for $1,240.00 is due on October 15. Reply to confirm the payment method on file.',
      draft: "Thanks for the reminder. I'll review the invoice and confirm the payment method shortly.",
    },
    {
      id: 'a5', from: '@maya.designs', channel: 'instagram', time: '10:30 AM', confidence: 'medium', autoSend: false,
      original: 'Loved your latest post! Would you be open to a collab sometime next month?',
      draft: "Thank you, that means a lot! I'd love to hear more. What did you have in mind?",
    },
    {
      id: 'a4', from: '#design-team', channel: 'slack', time: '10:21 AM', confidence: 'high', autoSend: false,
      original: "Jordan: can someone confirm they're joining the 4:30 crit?",
      draft: "Confirmed, I'll be there at 4:30.",
    },
  ],

  // TODO(api): GET /api/activity?channel=&status=
  activity: [
    { id: 'e1', type: 'reply',   channel: 'gmail',    status: 'sent',      time: '9:02 AM',   undoable: true,  text: "Replied to Lena Fischer confirming Tuesday's call" },
    { id: 'e2', type: 'meeting', channel: 'calendar', status: 'scheduled', time: '8:47 AM',   undoable: true,  text: 'Scheduled "Q4 planning" with Jordan for Wed 11:00' },
    { id: 'e3', type: 'flag',    channel: 'gmail',    status: 'flagged',   time: '8:30 AM',   undoable: false, text: 'Flagged the Northwind invoice for your review' },
    { id: 'e11', type: 'reply',  channel: 'outlook',  status: 'sent',      time: '9:25 AM',   undoable: true,  text: 'Confirmed the Monday laptop upgrade slot with IT Support' },
    { id: 'e12', type: 'flag',   channel: 'x',        status: 'flagged',   time: 'Yesterday', undoable: false, text: 'Flagged a crypto giveaway DM on X as a scam' },
    { id: 'e9', type: 'reply',   channel: 'instagram', status: 'sent',     time: '9:52 AM',   undoable: true,  text: 'Replied to @jess.k thanking her for the shoutout' },
    { id: 'e10', type: 'reply',  channel: 'whatsapp', status: 'sent',      time: '8:35 AM',   undoable: false, text: 'Told the family group you will join on Sunday' },
    { id: 'e4', type: 'reply',   channel: 'telegram', status: 'sent',      time: '8:12 AM',   undoable: false, text: 'Thanked Maya for sending the photos' },
    { id: 'e5', type: 'summary', channel: 'gmail',    status: 'sent',      time: '8:00 AM',   undoable: false, text: 'Delivered your daily summary (23 emails, 3 need attention)' },
    { id: 'e6', type: 'reply',   channel: 'slack',    status: 'sent',      time: 'Yesterday', undoable: false, text: 'Acknowledged the deploy notice in #eng-releases' },
    { id: 'e7', type: 'flag',    channel: 'whatsapp', status: 'flagged',   time: 'Yesterday', undoable: false, text: 'Flagged a message asking for your bank details as likely spam' },
    { id: 'e8', type: 'meeting', channel: 'calendar', status: 'undone',    time: 'Yesterday', undoable: false, text: 'Declined "Vendor demo" (you undid this)' },
  ],

  // TODO(api): GET /api/tasks
  tasks: [
    { id: 't1', title: 'Send daily inbox summary',                       when: 'Every day at 8:00 AM', status: 'scheduled' },
    { id: 't2', title: 'Follow up with Priya if no reply on the contract', when: 'Fri, Oct 16',        status: 'scheduled' },
    { id: 't3', title: 'Triage unread Slack mentions',                    when: 'Running now',         status: 'running' },
    { id: 't4', title: 'Weekly digest of newsletters',                    when: 'Mondays at 9:00 AM',  status: 'paused' },
    { id: 't5', title: 'Confirm dentist appointment',                     when: 'Today, 7:45 AM',      status: 'done' },
  ],

  // TODO(api): GET /api/rules
  rules: {
    auto: [
      { id: 'r1', text: 'Meeting confirmations' },
      { id: 'r2', text: 'Archive newsletters' },
      { id: 'r3', text: 'Short thank-you replies' },
    ],
    ask: [
      { id: 'r4', text: 'Anything involving money' },
      { id: 'r5', text: "New contacts I haven't replied to before" },
      { id: 'r6', text: 'Declining invitations' },
    ],
    never: [
      { id: 'r7', text: 'Share personal info' },
      { id: 'r8', text: 'Make payments or purchases' },
      { id: 'r9', text: 'Delete emails permanently' },
    ],
  },

  // TODO(api): GET /api/accounts
  // autonomy per app: auto (reply on its own) | ask (draft, then ask me) | off (read only)
  accounts: [
    { id: 'gmail',     name: 'Gmail',           detail: 'alex@example.com', connected: true,  autonomy: 'ask',  handledToday: 14 },
    { id: 'outlook',   name: 'Outlook',         detail: 'alex@acme.com',    connected: true,  autonomy: 'ask',  handledToday: 3 },
    { id: 'x',         name: 'X',               detail: '@alexcreates',     connected: true,  autonomy: 'off',  handledToday: 2 },
    { id: 'whatsapp',  name: 'WhatsApp',        detail: '+1 555 0142',      connected: true,  autonomy: 'ask',  handledToday: 6 },
    { id: 'instagram', name: 'Instagram',       detail: '@alex.creates',    connected: true,  autonomy: 'ask',  handledToday: 4 },
    { id: 'telegram',  name: 'Telegram',        detail: '@alex',            connected: true,  autonomy: 'auto', handledToday: 5 },
    { id: 'slack',     name: 'Slack',           detail: 'Acme workspace',   connected: true,  autonomy: 'auto', handledToday: 6 },
    { id: 'linkedin',  name: 'LinkedIn',        detail: '',                 connected: false, autonomy: 'off',  handledToday: 0 },
    { id: 'calendar',  name: 'Google Calendar', detail: 'Primary calendar', connected: true,  autonomy: 'ask',  handledToday: 2 },
  ],

  tones: {
    friendly:     { label: 'Friendly',     preview: "Hey Priya! Friday works great for me, I've already moved the invite. See you then!" },
    professional: { label: 'Professional', preview: 'Hi Priya, thank you for letting me know. Friday at 2:00 PM works well; I have updated the calendar invitation accordingly.' },
    concise:      { label: 'Concise',      preview: 'Friday 2 PM works. Invite updated.' },
  },

  // TODO(api): GET /api/settings
  settings: {
    tone: 'friendly',
    dailyLimit: 50,
    notifications: [
      { id: 'n1', label: 'New drafts need approval', desc: 'Notify me as soon as a reply is waiting', on: true },
      { id: 'n2', label: 'Daily summary',            desc: 'A digest of everything handled, at 8:00 AM', on: true },
      { id: 'n3', label: 'Flagged messages',         desc: 'Anything Aide thinks looks risky or urgent', on: true },
      { id: 'n4', label: 'Every auto-sent message',  desc: 'Can get noisy on busy days', on: false },
    ],
  },
};
