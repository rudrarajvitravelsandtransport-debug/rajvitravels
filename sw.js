// ============================================================================
// Rajvi Portal — Service Worker
// Purpose: show native OS-level notifications for awaiting bills that have
// crossed the 15-day follow-up mark, even when the portal tab isn't focused
// (as long as the browser itself is running in the background).
//
// No push server / Firebase Cloud Messaging is used here — this relies on
// the page sending it fresh bill data periodically via postMessage, plus
// a self-contained periodic check using setInterval inside the worker.
// ============================================================================

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
const RING_REPEAT_MS = 90 * 1000; // don't spam — same cadence as in-page alarm

let latestBills = [];   // [{id, company, amount, awaitingTimestamp}]
let latestMutes = {};   // {billId: epochMs}
let lastNotifiedAt = {}; // {billId: epochMs of last notification fired}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// The page sends bill + mute data here periodically (see index.html changes).
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SYNC_BILLS') {
    latestBills = Array.isArray(data.bills) ? data.bills : [];
    latestMutes = data.mutes || {};
    checkAndNotify();
  }
});

function getNextAlarmMs(bill) {
  const start = bill.awaitingTimestamp || Date.now();
  const lastMute = latestMutes[bill.id];
  const base = lastMute && lastMute > start ? lastMute : start;
  return base + FIFTEEN_DAYS_MS;
}

function checkAndNotify() {
  const now = Date.now();
  latestBills.forEach((bill) => {
    const dueAt = getNextAlarmMs(bill);
    if (now < dueAt) return;

    const lastFired = lastNotifiedAt[bill.id] || 0;
    if (now - lastFired < RING_REPEAT_MS) return; // avoid spamming

    lastNotifiedAt[bill.id] = now;

    const daysOverdue = Math.max(0, Math.floor((now - dueAt) / (24 * 60 * 60 * 1000)));
    const overdueLabel = daysOverdue === 0 ? 'due today' : `${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`;

    self.registration.showNotification('🔔 Payment follow-up due', {
      body: `${bill.company || 'A vendor'} — ₹${formatCurrency(bill.amount)} (${overdueLabel})`,
      tag: 'bill-alarm-' + bill.id, // replaces previous notification for same bill
      renotify: true,
      icon: undefined,
      data: { billId: bill.id }
    });
  });
}

function formatCurrency(n) {
  n = Number(n) || 0;
  return n.toLocaleString('en-IN');
}

// Re-check every 60s in case the worker stays alive in the background.
// (Service workers can be terminated by the browser at any time when idle —
// this is a best-effort timer, not a guarantee. The page also re-syncs data
// and re-triggers a check periodically while it's open, which is the more
// reliable path.)
setInterval(checkAndNotify, 60 * 1000);

// Clicking the notification focuses/opens the portal tab.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
