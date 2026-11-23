/* ==============================================================================
   Kitchenware Rentals Ltd — ERP & Order Management System
   MODULE: ALERTS — return-due reminders and automatic late-return charges

   WHAT THIS DOES
   --------------
   Watches every open rental (CONFIRMED / OUT_ON_HIRE) against its hire END
   DATE and produces three things:

     1. An in-app alert queue: what is due soon, due today, and overdue.
     2. Interval reminders on a configurable schedule (-3, -1, 0, +1, +3, +7
        days from the due date) sent over WhatsApp, SMS or email.
     3. An automatic late-return charge — flat naira per day, after a grace
        period, optionally capped — which pre-fills the existing return audit
        so a Super Admin only has to confirm or override it.

   DELIVERY MODEL
   --------------
   This build sends through deep links (wa.me / sms: / mailto:). That means no
   API keys, no server and no per-message cost, but a staff member must click
   "send". Every click is written to reminder_log so the history is real. The
   send functions are deliberately isolated behind sendReminder() so a paid
   provider (Termii/Twilio/Resend) can be dropped in later without touching
   the queue, the schedule or the fee maths.

   DEPENDS ON: MASTER_INVOICES + currentRole (state.js), db (db.js),
               escapeHtml/showToast/fmt (utils.js), migration 04.
   ============================================================================== */

/* ── CONSTANTS ─────────────────────────────────────────────────────────── */

const ALERT_SETTINGS_CACHE_KEY = 'kwr_alert_settings';
const ALERT_POLICY_KEY = 'late_fee_policy';
const ALERT_SCHEDULE_KEY = 'reminder_schedule';

const DEFAULT_LATE_FEE_POLICY = { perDayRate: 5000, graceDays: 1, cap: 0 };
const DEFAULT_REMINDER_SCHEDULE = { offsets: [-3, -1, 0, 1, 3, 7], channels: ['whatsapp', 'sms', 'email'] };

/* Statuses that mean "the goods are still out with the customer". PENDING is a
   draft, RETURNED is closed, CANCELLED never left the building. */
const OPEN_RENTAL_STATUSES = ['CONFIRMED', 'OUT_ON_HIRE'];

const ALERT_KIND_META = {
  OVERDUE: { label: 'Overdue', tone: 'danger', rank: 0 },
  DUE_TODAY: { label: 'Due today', tone: 'warning', rank: 1 },
  DUE_SOON: { label: 'Upcoming', tone: 'info', rank: 2 },
  SCHEDULED: { label: 'Scheduled', tone: 'muted', rank: 3 },
  UNKNOWN: { label: 'No due date', tone: 'muted', rank: 4 }
};

const ALERT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ── MODULE STATE ──────────────────────────────────────────────────────── */

let alertPolicy = { ...DEFAULT_LATE_FEE_POLICY };
let alertSchedule = { ...DEFAULT_REMINDER_SCHEDULE };

/** order_no → most recent reminder_log row, for the "Last reminder" column. */
const ALERT_LAST_REMINDER = new Map();

let alertTickerId = null;

/* ── DATE HELPERS (date-only, local time, no timezone drift) ───────────── */

/** Today as YYYY-MM-DD in the operator's local timezone. */
function alertTodayISO() {
  return alertToISO(new Date());
}

function alertToISO(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses YYYY-MM-DD (or a full timestamp) into a local midnight Date. */
function alertParseDate(value) {
  if (!value) return null;
  const head = String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** Whole days from aISO → bISO. Positive when b is later. */
function alertDaysBetween(aISO, bISO) {
  const a = alertParseDate(aISO);
  const b = alertParseDate(bISO);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

function alertAddDays(isoDate, days) {
  const d = alertParseDate(isoDate);
  if (!d) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return alertToISO(d);
}

/** 24 Nov 2026 — written out rather than locale-formatted, matching print.js. */
function alertFormatDate(value) {
  const d = alertParseDate(value);
  if (!d) return '—';
  return `${d.getDate()} ${ALERT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "3 days" / "1 day" / "today" */
function alertDayWord(n) {
  const abs = Math.abs(Number(n) || 0);
  if (abs === 0) return 'today';
  return `${abs} ${abs === 1 ? 'day' : 'days'}`;
}

/* ── INVOICE → DUE DATE ────────────────────────────────────────────────── */

function alertIsOpenRental(inv) {
  return Boolean(inv) && OPEN_RENTAL_STATUSES.includes(inv.status);
}

/** The hire end date, normalised to YYYY-MM-DD, or '' when never recorded. */
function alertDueDate(inv) {
  if (!inv) return '';
  const raw = inv.endDate || inv.end_date;
  const parsed = alertParseDate(raw);
  return parsed ? alertToISO(parsed) : '';
}

/**
 * Full due-state for one invoice.
 * @returns {{recorded:boolean,dueDate:string,daysUntil:number|null,daysLate:number,kind:string,isOpen:boolean}}
 */
function alertDueState(inv) {
  const isOpen = alertIsOpenRental(inv);
  const due = alertDueDate(inv);

  if (!due) {
    return { recorded: false, dueDate: '', daysUntil: null, daysLate: 0, kind: 'UNKNOWN', isOpen };
  }

  const daysUntil = alertDaysBetween(alertTodayISO(), due) ?? 0;
  const daysLate = daysUntil < 0 ? -daysUntil : 0;

  let kind = 'SCHEDULED';
  if (daysUntil < 0) kind = 'OVERDUE';
  else if (daysUntil === 0) kind = 'DUE_TODAY';
  else if (daysUntil <= 7) kind = 'DUE_SOON';

  return { recorded: true, dueDate: due, daysUntil, daysLate, kind, isOpen };
}

/* ── LATE FEE MATHS ────────────────────────────────────────────────────── */

/**
 * Flat per-day charge, applied only after the grace period, optionally capped.
 * Pure function so the return audit and the alerts panel can never disagree.
 *
 * @param {number} daysLate     Calendar days past the due date.
 * @param {object} [policy]
 * @returns {{daysLate:number,graceDays:number,chargeableDays:number,rate:number,cap:number,amount:number,capped:boolean}}
 */
function computeLateFee(daysLate, policy = alertPolicy) {
  const rate = Math.max(0, Number(policy?.perDayRate) || 0);
  const graceDays = Math.max(0, Math.floor(Number(policy?.graceDays) || 0));
  const cap = Math.max(0, Number(policy?.cap) || 0);

  const late = Math.max(0, Math.floor(Number(daysLate) || 0));
  const chargeableDays = Math.max(0, late - graceDays);

  let amount = chargeableDays * rate;
  let capped = false;
  if (cap > 0 && amount > cap) {
    amount = cap;
    capped = true;
  }

  return {
    daysLate: late,
    graceDays,
    chargeableDays,
    rate,
    cap,
    amount: Math.round(amount * 100) / 100,
    capped
  };
}

/**
 * Late fee for one invoice, relative to today (or an explicit inspection date).
 * Used by the alerts queue and by the return audit auto-fill.
 */
function computeLateFeeForInvoice(inv, asOfISO = alertTodayISO(), policy = alertPolicy) {
  const due = alertDueDate(inv);
  if (!due) return { ...computeLateFee(0, policy), dueDate: '', applicable: false };
  const daysLate = Math.max(0, -(alertDaysBetween(asOfISO, due) ?? 0));
  const fee = computeLateFee(daysLate, policy);
  return { ...fee, dueDate: due, applicable: daysLate > 0 };
}

/* ── REMINDER SCHEDULE ─────────────────────────────────────────────────── */

function alertNormaliseOffsets(offsets) {
  const list = Array.isArray(offsets)
    ? offsets
    : String(offsets || '').split(',');
  const clean = list
    .map(v => Number(String(v).trim()))
    .filter(v => Number.isFinite(v) && Math.abs(v) <= 365)
    .map(v => Math.trunc(v));
  const unique = [...new Set(clean)].sort((a, b) => a - b);
  return unique.length ? unique : [...DEFAULT_REMINDER_SCHEDULE.offsets];
}

/** Human summary of the cadence, e.g. "−3d, −1d, due date, +1d, +3d, +7d". */
function alertScheduleSummary(offsets = alertSchedule.offsets) {
  return alertNormaliseOffsets(offsets).map(o => {
    if (o === 0) return 'due date';
    return o < 0 ? `−${Math.abs(o)}d` : `+${o}d`;
  }).join(', ');
}

/**
 * Which schedule slots fall due TODAY for this invoice. Drives the "reminder
 * due now" badge so staff can work down a list instead of guessing.
 */
function alertRemindersDueToday(inv, today = alertTodayISO()) {
  const due = alertDueDate(inv);
  if (!due || !alertIsOpenRental(inv)) return [];
  return alertNormaliseOffsets(alertSchedule.offsets)
    .filter(offset => alertAddDays(due, offset) === today);
}

/* ── MESSAGE TEMPLATES ─────────────────────────────────────────────────── */

function alertCompanyName() {
  return 'Kitchenware Rentals Ltd';
}

/** Item count for the reminder body — "5 items" reads better than a list. */
function alertItemCount(inv) {
  const items = Array.isArray(inv?.items) ? inv.items : [];
  return items.length;
}

/**
 * Builds the reminder body for an invoice and channel.
 * Kept plain-text: WhatsApp, SMS and mailto all render plain text, and a
 * preview of exactly what the customer sees is shown before sending.
 */
function buildReminderMessage(inv, channel = 'whatsapp') {
  const state = alertDueState(inv);
  const fee = computeLateFeeForInvoice(inv);
  const dueLabel = alertFormatDate(state.dueDate);
  const name = String(inv?.customerName || 'Customer').trim();
  const ref = inv?.invoiceNo || 'invoice';
  const count = alertItemCount(inv);
  const itemBit = count ? ` (${count} ${count === 1 ? 'item' : 'items'})` : '';

  const lines = [];
  const sms = channel === 'sms';

  if (sms) {
    // SMS: no greeting line, no signature block, front-load the ask.
    if (state.kind === 'OVERDUE') {
      lines.push(`KWR: ${ref}${itemBit} was due ${dueLabel} and is ${alertDayWord(state.daysLate)} overdue.`);
      if (fee.amount > 0) lines.push(`Late charge so far: N${fmt(fee.amount)}.`);
      lines.push('Please return the items to stop further charges.');
    } else if (state.kind === 'DUE_TODAY') {
      lines.push(`KWR: ${ref}${itemBit} is due back TODAY (${dueLabel}).`);
      lines.push('Please have the items ready for inspection.');
    } else {
      lines.push(`KWR: a reminder that ${ref}${itemBit} is due back on ${dueLabel} (in ${alertDayWord(state.daysUntil)}).`);
    }
    return lines.join(' ');
  }

  lines.push(`Dear ${name},`);
  lines.push('');

  if (state.kind === 'OVERDUE') {
    lines.push(`Invoice ${ref}${itemBit} was due for return on ${dueLabel} and is now ${alertDayWord(state.daysLate)} overdue.`);
    lines.push('');
    if (fee.amount > 0) {
      lines.push(`A late-return charge of \u20a6${fmt(fee.amount)} has accrued so far ` +
        `(\u20a6${fmt(fee.rate)} per day after a ${fee.graceDays}-day grace period).`);
      if (fee.capped) lines.push('This charge has reached its maximum cap.');
      lines.push('The charge continues to accrue daily until the items are returned.');
    } else if (fee.chargeableDays === 0 && fee.graceDays > 0) {
      lines.push(`Charges begin after a ${fee.graceDays}-day grace period, so please return the items to avoid them.`);
    }
    lines.push('');
    lines.push('Please return the items as soon as possible.');
  } else if (state.kind === 'DUE_TODAY') {
    lines.push(`Invoice ${ref}${itemBit} is due back today, ${dueLabel}.`);
    lines.push('');
    lines.push('Please have the items cleaned and ready for collection and inspection.');
    if (Number(fee.rate) > 0) {
      lines.push(`Late returns attract \u20a6${fmt(fee.rate)} per day after a ${fee.graceDays}-day grace period.`);
    }
  } else {
    lines.push(`This is a reminder that invoice ${ref}${itemBit} is due back on ${dueLabel} — in ${alertDayWord(state.daysUntil)}.`);
    lines.push('');
    lines.push('Please have the items cleaned and ready for collection and inspection.');
    if (Number(fee.rate) > 0) {
      lines.push(`Late returns attract \u20a6${fmt(fee.rate)} per day after a ${fee.graceDays}-day grace period.`);
    }
  }

  lines.push('');
  lines.push(`Ref: ${ref}`);
  lines.push(alertCompanyName());
  return lines.join('\n');
}

/* ── PHONE / CHANNEL PLUMBING ──────────────────────────────────────────── */

function alertDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/** 0803… → 234803… (Nigerian format used by wa.me). */
function alertWhatsAppPhone(phone) {
  if (typeof phoneForWhatsApp === 'function') return phoneForWhatsApp(phone);
  const digits = alertDigits(phone);
  if (!digits) return '';
  if (digits.startsWith('0')) return `234${digits.slice(1)}`;
  return digits;
}

/** 0803… → +234803… (used by the sms: scheme). */
function alertSmsPhone(phone) {
  const digits = alertDigits(phone);
  if (!digits) return '';
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  if (digits.startsWith('234')) return `+${digits}`;
  return `+${digits}`;
}

function alertHasPhone(inv) {
  const digits = alertDigits(inv?.phone);
  return digits.length >= 10 && inv?.phone !== 'N/A';
}

function alertHasEmail(inv) {
  const email = String(inv?.email || '').trim();
  return email && email !== 'N/A' && /.+@.+\..+/.test(email);
}

/* ── SENDING (deep links today, provider API later) ────────────────────── */

/**
 * Launches the chosen channel for one invoice and records the attempt.
 * Swap the three launchXxx bodies for provider calls when going automated;
 * everything above this line stays identical.
 */
async function sendReminder(invoiceNo, channel) {
  const inv = typeof getInvoiceByNumber === 'function'
    ? getInvoiceByNumber(invoiceNo)
    : (MASTER_INVOICES || []).find(i => i.invoiceNo === invoiceNo);

  if (!inv) {
    showToast('That invoice is no longer in the list — refresh and try again', 'error');
    return;
  }
  if (!alertIsOpenRental(inv)) {
    showToast(`${inv.invoiceNo} is ${String(inv.status || '').toLowerCase()} — no reminder needed`, 'error');
    return;
  }

  const state = alertDueState(inv);
  const message = buildReminderMessage(inv, channel);

  let launched = false;

  if (channel === 'whatsapp') {
    if (!alertHasPhone(inv)) {
      showToast(`No usable phone number for ${inv.customerName || inv.invoiceNo}`, 'error');
      return;
    }
    const phone = alertWhatsAppPhone(inv.phone);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    launched = true;
  } else if (channel === 'sms') {
    if (!alertHasPhone(inv)) {
      showToast(`No usable phone number for ${inv.customerName || inv.invoiceNo}`, 'error');
      return;
    }
    const phone = alertSmsPhone(inv.phone);
    // ?&body= is the form iOS and Android both accept.
    window.location.href = `sms:${phone}?&body=${encodeURIComponent(message)}`;
    launched = true;
  } else if (channel === 'email') {
    if (!alertHasEmail(inv)) {
      showToast(`No usable email address for ${inv.customerName || inv.invoiceNo}`, 'error');
      return;
    }
    const subject = state.kind === 'OVERDUE'
      ? `Overdue return — ${inv.invoiceNo}`
      : state.kind === 'DUE_TODAY'
        ? `Return due today — ${inv.invoiceNo}`
        : `Return reminder — ${inv.invoiceNo} due ${alertFormatDate(state.dueDate)}`;
    window.location.href = `mailto:${encodeURIComponent(inv.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
    launched = true;
  } else if (channel === 'copy') {
    try {
      await navigator.clipboard.writeText(message);
      showToast('Reminder message copied — paste it into any channel', 'success');
    } catch (err) {
      showToast('Could not copy — your browser blocked clipboard access', 'error');
      return;
    }
    launched = true;
  } else {
    return;
  }

  if (!launched) return;

  if (channel !== 'copy') {
    showToast(`Opening ${channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'email'} for ${inv.customerName || inv.invoiceNo}…`, 'success');
  }

  await logReminder(inv, state, channel, message);
}

/**
 * Writes the reminder to reminder_log. Best effort: if the table is missing
 * (migration 04 not run yet) the UI must still work, so failures are reported
 * in the console but never block the send.
 */
async function logReminder(inv, state, channel, message) {
  const orderNo = String(inv.invoiceNo || '').replace(/^#/, '');
  const actor = (typeof currentUser !== 'undefined' && currentUser?.email) || 'unknown';

  const row = {
    order_id: inv.dbId || null,
    order_no: orderNo || null,
    channel,
    kind: state.kind === 'UNKNOWN' ? 'DUE_SOON' : state.kind,
    due_date: state.dueDate || null,
    days_offset: state.daysUntil === null ? null : state.daysUntil,
    message,
    status: 'OPENED',
    sent_by: actor
  };

  ALERT_LAST_REMINDER.set(orderNo, { ...row, sent_at: new Date().toISOString() });
  renderReturnAlerts();

  try {
    const { error } = await db.from('reminder_log').insert(row);
    if (error) throw error;
  } catch (err) {
    console.warn('Reminder was sent but not logged (run migration 04):', err?.message || err);
  }
}

/* ── SETTINGS PERSISTENCE ──────────────────────────────────────────────── */

function alertSanitisePolicy(raw) {
  return {
    perDayRate: Math.max(0, Number(raw?.perDayRate) || 0),
    graceDays: Math.max(0, Math.floor(Number(raw?.graceDays) || 0)),
    cap: Math.max(0, Number(raw?.cap) || 0)
  };
}

function alertSanitiseSchedule(raw) {
  return {
    offsets: alertNormaliseOffsets(raw?.offsets),
    channels: Array.isArray(raw?.channels) && raw.channels.length
      ? raw.channels.filter(c => ['whatsapp', 'sms', 'email'].includes(c))
      : [...DEFAULT_REMINDER_SCHEDULE.channels]
  };
}

function cacheAlertSettings() {
  try {
    localStorage.setItem(ALERT_SETTINGS_CACHE_KEY, JSON.stringify({
      policy: alertPolicy,
      schedule: alertSchedule
    }));
  } catch (err) {
    /* private mode — the DB copy is authoritative anyway */
  }
}

function readCachedAlertSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(ALERT_SETTINGS_CACHE_KEY) || 'null');
    if (!raw) return false;
    alertPolicy = alertSanitisePolicy(raw.policy);
    alertSchedule = alertSanitiseSchedule(raw.schedule);
    return true;
  } catch (err) {
    return false;
  }
}

async function loadAlertSettings() {
  // Paint from cache first so the panel is never blank on a slow connection.
  readCachedAlertSettings();

  try {
    const { data, error } = await db
      .from('app_settings')
      .select('key, value')
      .in('key', [ALERT_POLICY_KEY, ALERT_SCHEDULE_KEY]);
    if (error) throw error;

    (data || []).forEach(row => {
      if (row.key === ALERT_POLICY_KEY) alertPolicy = alertSanitisePolicy(row.value);
      if (row.key === ALERT_SCHEDULE_KEY) alertSchedule = alertSanitiseSchedule(row.value);
    });
    cacheAlertSettings();
  } catch (err) {
    console.warn('Late-fee settings not loaded from Supabase (using cache/defaults):', err?.message || err);
  }

}

async function saveAlertSettings(policy, schedule) {
  const cleanPolicy = alertSanitisePolicy(policy);
  const cleanSchedule = alertSanitiseSchedule(schedule);
  const actor = (typeof currentUser !== 'undefined' && currentUser?.email) || 'unknown';
  const stamp = new Date().toISOString();

  alertPolicy = cleanPolicy;
  alertSchedule = cleanSchedule;
  cacheAlertSettings();

  try {
    const { error } = await db.from('app_settings').upsert([
      { key: ALERT_POLICY_KEY, value: cleanPolicy, updated_at: stamp, updated_by: actor },
      { key: ALERT_SCHEDULE_KEY, value: cleanSchedule, updated_at: stamp, updated_by: actor }
    ], { onConflict: 'key' });
    if (error) throw error;
    showToast('Late-fee policy saved', 'success');
  } catch (err) {
    console.error('Saving late-fee policy failed:', err);
    showToast('Saved on this device only — the server copy did not update (run migration 04)', 'error');
  }

  if (typeof logAuditAction === 'function') {
    logAuditAction('SYSTEM', 'LATE_FEE_POLICY_UPDATED', { policy: cleanPolicy, schedule: cleanSchedule });
  }

  renderAlertSettingsForm();
  renderReturnAlerts();
}

/* ── QUEUE BUILDING ────────────────────────────────────────────────────── */

/**
 * Every invoice the alert engine cares about, annotated and sorted by urgency.
 * Overdue (most days first) → due today → due soon (nearest first) →
 * scheduled → missing due date.
 */
function buildAlertQueue() {
  const list = Array.isArray(MASTER_INVOICES) ? MASTER_INVOICES : [];

  const rows = list
    .filter(inv => alertIsOpenRental(inv))
    .map(inv => {
      const state = alertDueState(inv);
      const fee = computeLateFeeForInvoice(inv);
      const orderKey = String(inv.invoiceNo || '').replace(/^#/, '');
      return {
        inv,
        state,
        fee,
        orderKey,
        lastReminder: ALERT_LAST_REMINDER.get(orderKey) || null,
        remindersToday: alertRemindersDueToday(inv)
      };
    });

  rows.sort((a, b) => {
    const rankDiff = ALERT_KIND_META[a.state.kind].rank - ALERT_KIND_META[b.state.kind].rank;
    if (rankDiff !== 0) return rankDiff;

    if (a.state.kind === 'OVERDUE') return b.state.daysLate - a.state.daysLate;
    if (a.state.kind === 'DUE_SOON' || a.state.kind === 'SCHEDULED') {
      return (a.state.daysUntil ?? 0) - (b.state.daysUntil ?? 0);
    }
    return String(a.inv.invoiceNo || '').localeCompare(String(b.inv.invoiceNo || ''));
  });

  return rows;
}

/* ── RENDERING: KPIs ───────────────────────────────────────────────────── */

function renderAlertKpis(queue) {
  const overdue = queue.filter(r => r.state.kind === 'OVERDUE');
  const dueToday = queue.filter(r => r.state.kind === 'DUE_TODAY');
  const dueSoon = queue.filter(r => r.state.kind === 'DUE_SOON');
  const accruing = queue.reduce((sum, r) => sum + (r.fee.applicable ? r.fee.amount : 0), 0);
  const unrecorded = queue.filter(r => !r.state.recorded);

  const set = (id, value, sub) => {
    const valEl = document.getElementById(id);
    if (valEl) valEl.textContent = value;
    if (sub !== undefined) {
      const subEl = document.getElementById(`${id}Sub`);
      if (subEl) subEl.textContent = sub;
    }
  };

  set('alertKpiOverdue', `${overdue.length}`, overdue.length
    ? `Oldest ${alertDayWord(Math.max(...overdue.map(r => r.state.daysLate)))} late`
    : 'Nothing overdue');
  set('alertKpiDueToday', `${dueToday.length}`, dueToday.length ? 'Return expected today' : 'Nothing due today');
  set('alertKpiDueSoon', `${dueSoon.length}`, dueSoon.length ? 'Due in the next 7 days' : 'Nothing due this week');
  set('alertKpiAccruing', `\u20a6 ${fmt(accruing)}`, alertPolicy.perDayRate > 0
    ? `\u20a6${fmt(alertPolicy.perDayRate)}/day after ${alertPolicy.graceDays}d grace`
    : 'No automatic charge configured');

  const unrecordedEl = document.getElementById('alertUnrecordedNote');
  if (unrecordedEl) {
    unrecordedEl.hidden = unrecorded.length === 0;
    if (unrecorded.length) {
      unrecordedEl.textContent = `${unrecorded.length} open ${unrecorded.length === 1 ? 'rental has' : 'rentals have'} no recorded hire end date, so they cannot be reminded. Open each invoice once and save it to capture the period.`;
    }
  }
}

/* ── RENDERING: TABLE ──────────────────────────────────────────────────── */

function alertStatusPill(state) {
  const meta = ALERT_KIND_META[state.kind] || ALERT_KIND_META.UNKNOWN;
  return `<span class="alert-pill alert-pill-${meta.tone}">${escapeHtml(meta.label)}</span>`;
}

function alertDaysCell(state) {
  if (!state.recorded) return '<span class="alert-muted">—</span>';
  if (state.kind === 'OVERDUE') {
    return `<strong class="alert-danger-text">${alertDayWord(state.daysLate)} late</strong>`;
  }
  if (state.kind === 'DUE_TODAY') return '<strong class="alert-warning-text">Today</strong>';
  return `<span class="alert-muted">in ${alertDayWord(state.daysUntil)}</span>`;
}

function alertFeeCell(row) {
  if (!row.fee.applicable || row.fee.amount <= 0) {
    if (row.state.recorded && row.state.daysLate > 0 && row.fee.chargeableDays === 0) {
      return '<span class="alert-muted">In grace period</span>';
    }
    return '<span class="alert-muted">—</span>';
  }
  const capNote = row.fee.capped ? ' <span class="alert-cap">capped</span>' : '';
  return `<strong>\u20a6 ${fmt(row.fee.amount)}</strong>${capNote}` +
    `<div class="alert-sub">${row.fee.chargeableDays} × \u20a6${fmt(row.fee.rate)}</div>`;
}

function alertLastReminderCell(row) {
  if (row.lastReminder) {
    const when = alertFormatDate(row.lastReminder.sent_at);
    const channel = String(row.lastReminder.channel || '').toUpperCase();
    return `<span class="alert-sub">${escapeHtml(channel)} · ${escapeHtml(when)}</span>`;
  }
  if (row.remindersToday.length) {
    return '<span class="alert-due-badge">Reminder due now</span>';
  }
  return '<span class="alert-muted">Not yet reminded</span>';
}

function alertActionsCell(row) {
  const inv = row.inv;
  const phoneOk = alertHasPhone(inv);
  const emailOk = alertHasEmail(inv);
  const closed = !alertIsOpenRental(inv);
  const dis = (ok) => (ok && !closed ? '' : ' disabled aria-disabled="true"');
  const no = escapeHtml(inv.invoiceNo || '');

  return `
    <div class="alert-actions">
      <button type="button" class="alert-icon-btn" title="Send on WhatsApp"
        data-alert-send="whatsapp" data-alert-inv="${no}"${dis(phoneOk)}>💬</button>
      <button type="button" class="alert-icon-btn" title="Send by SMS"
        data-alert-send="sms" data-alert-inv="${no}"${dis(phoneOk)}>✉️</button>
      <button type="button" class="alert-icon-btn" title="Send by email"
        data-alert-send="email" data-alert-inv="${no}"${dis(emailOk)}>📧</button>
      <button type="button" class="alert-icon-btn" title="Preview / copy message"
        data-alert-send="copy" data-alert-inv="${no}">📋</button>
      <button type="button" class="alert-icon-btn" title="Open invoice"
        data-alert-open="${no}">↗️</button>
    </div>`;
}

function renderAlertTable(queue) {
  const tbody = document.getElementById('alertsListBody');
  if (!tbody) return;

  const search = (document.getElementById('alertsSearchInput')?.value || '').trim().toLowerCase();
  const filter = document.getElementById('alertsFilterSelect')?.value || 'all';

  let rows = queue;
  if (filter !== 'all') {
    rows = rows.filter(r => {
      if (filter === 'unrecorded') return !r.state.recorded;
      if (filter === 'overdue') return r.state.kind === 'OVERDUE';
      if (filter === 'today') return r.state.kind === 'DUE_TODAY';
      if (filter === 'week') return r.state.kind === 'DUE_SOON' || r.state.kind === 'DUE_TODAY';
      return true;
    });
  }
  if (search) {
    rows = rows.filter(r =>
      String(r.inv.invoiceNo || '').toLowerCase().includes(search) ||
      String(r.inv.customerName || '').toLowerCase().includes(search) ||
      String(r.inv.phone || '').toLowerCase().includes(search)
    );
  }

  const emptyEl = document.getElementById('alertsEmpty');
  const wrap = tbody.closest('.table-scroll');

  if (!rows.length) {
    tbody.innerHTML = '';
    if (wrap) wrap.hidden = true;
    if (emptyEl) {
      emptyEl.hidden = false;
      const filtering = Boolean(search) || filter !== 'all';
      document.getElementById('alertsEmptyTitle').textContent = filtering
        ? 'No rentals match this view'
        : 'Every rental is squared away';
      document.getElementById('alertsEmptyText').textContent = filtering
        ? 'Try a different filter, or clear the search box.'
        : 'Nothing is due for return and nothing is overdue. New alerts appear here as hire end dates approach.';
    }
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (wrap) wrap.hidden = false;

  tbody.innerHTML = rows.map(row => {
    const inv = row.inv;
    const dueLabel = row.state.recorded ? alertFormatDate(row.state.dueDate) : '<span class="alert-muted">Not recorded</span>';
    const contact = inv.phone && inv.phone !== 'N/A'
      ? escapeHtml(inv.phone)
      : '<span class="alert-muted">No phone</span>';

    return `
      <tr class="alert-row alert-row-${ALERT_KIND_META[row.state.kind].tone}">
        <td><strong>${escapeHtml(inv.invoiceNo || '—')}</strong>
          <div class="alert-sub">${escapeHtml(String(inv.status || '').replace(/_/g, ' '))}</div>
        </td>
        <td>${escapeHtml(inv.customerName || 'Customer')}
          <div class="alert-sub">${contact}</div>
        </td>
        <td>${dueLabel}</td>
        <td>${alertStatusPill(row.state)}</td>
        <td>${alertDaysCell(row.state)}</td>
        <td class="alert-num">${alertFeeCell(row)}</td>
        <td>${alertLastReminderCell(row)}</td>
        <td>${alertActionsCell(row)}</td>
      </tr>`;
  }).join('');
}

/* ── RENDERING: SETTINGS FORM ──────────────────────────────────────────── */

function renderAlertSettingsForm() {
  const rateEl = document.getElementById('alertPerDayRate');
  const graceEl = document.getElementById('alertGraceDays');
  const capEl = document.getElementById('alertCap');
  const offsetsEl = document.getElementById('alertOffsets');
  const previewEl = document.getElementById('alertSettingsPreview');
  const gateEl = document.getElementById('alertSettingsGate');
  const formEl = document.getElementById('alertSettingsForm');

  const isSuper = currentRole === 'super_admin' || currentRole === 'admin';
  if (gateEl) gateEl.hidden = isSuper;
  if (formEl) formEl.hidden = !isSuper;

  if (rateEl) rateEl.value = alertPolicy.perDayRate || 0;
  if (graceEl) graceEl.value = alertPolicy.graceDays || 0;
  if (capEl) capEl.value = alertPolicy.cap || 0;
  if (offsetsEl) offsetsEl.value = alertNormaliseOffsets(alertSchedule.offsets).join(', ');

  if (previewEl) {
    const sample = computeLateFee(5, alertPolicy);
    previewEl.textContent = sample.amount > 0
      ? `Example: an invoice 5 days late is charged for ${sample.chargeableDays} day(s) = \u20a6${fmt(sample.amount)}. Reminders go out at ${alertScheduleSummary()}.`
      : `With these settings a 5-day-late invoice pays nothing (grace period covers it). Reminders go out at ${alertScheduleSummary()}.`;
  }
}

/* ── MAIN RENDER ───────────────────────────────────────────────────────── */

function renderReturnAlerts() {
  const panel = document.getElementById('tab-return-alerts');
  if (!panel) return;

  const queue = buildAlertQueue();
  renderAlertKpis(queue);
  renderAlertTable(queue);
  renderAlertSettingsForm();

  const countEl = document.getElementById('alertTabCount');
  if (countEl) {
    const actionable = queue.filter(r =>
      r.state.kind === 'OVERDUE' || r.state.kind === 'DUE_TODAY' ||
      (r.state.kind === 'DUE_SOON' && r.remindersToday.length)
    ).length;
    countEl.textContent = actionable ? String(actionable) : '';
    countEl.hidden = actionable === 0;
  }
}

/* ── EVENT WIRING ──────────────────────────────────────────────────────── */

function bindReturnAlertEvents() {
  const panel = document.getElementById('tab-return-alerts');
  if (!panel || panel.dataset.alertsBound === '1') return;
  panel.dataset.alertsBound = '1';

  panel.addEventListener('click', (event) => {
    const sendBtn = event.target.closest('[data-alert-send]');
    if (sendBtn) {
      sendReminder(sendBtn.dataset.alertInv, sendBtn.dataset.alertSend);
      return;
    }

    const openBtn = event.target.closest('[data-alert-open]');
    if (openBtn) {
      if (typeof openInvoiceDetailModal === 'function') openInvoiceDetailModal(openBtn.dataset.alertOpen);
      return;
    }

    const actionBtn = event.target.closest('[data-alert-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.alertAction;

      if (action === 'rescan') {
        renderReturnAlerts();
        showToast('Alert queue refreshed', 'success');
        return;
      }

      if (action === 'toggle-settings') {
        const body = document.getElementById('alertSettingsBody');
        if (body) {
          body.hidden = !body.hidden;
          actionBtn.setAttribute('aria-expanded', String(!body.hidden));
        }
        return;
      }

      if (action === 'save-settings') {
        const policy = {
          perDayRate: Number(document.getElementById('alertPerDayRate')?.value) || 0,
          graceDays: Number(document.getElementById('alertGraceDays')?.value) || 0,
          cap: Number(document.getElementById('alertCap')?.value) || 0
        };
        const schedule = {
          offsets: alertNormaliseOffsets(document.getElementById('alertOffsets')?.value),
          channels: alertSchedule.channels
        };
        saveAlertSettings(policy, schedule);
        return;
      }

      if (action === 'reset-settings') {
        saveAlertSettings({ ...DEFAULT_LATE_FEE_POLICY }, { ...DEFAULT_REMINDER_SCHEDULE });
        return;
      }
    }
  });

  const search = document.getElementById('alertsSearchInput');
  search?.addEventListener('input', debounce(() => renderReturnAlerts(), 200));

  const filter = document.getElementById('alertsFilterSelect');
  filter?.addEventListener('change', () => renderReturnAlerts());
}

/* ── REMINDER LOG LOAD ─────────────────────────────────────────────────── */

async function loadReminderLog() {
  try {
    const { data, error } = await db
      .from('reminder_log')
      .select('order_no, channel, kind, due_date, sent_at, status')
      .order('sent_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    ALERT_LAST_REMINDER.clear();
    (data || []).forEach(row => {
      const key = String(row.order_no || '');
      if (!key) return;
      if (!ALERT_LAST_REMINDER.has(key)) ALERT_LAST_REMINDER.set(key, row);
    });
  } catch (err) {
    // Table missing (migration 04 not run) or offline — the queue still renders.
    console.warn('Reminder history unavailable:', err?.message || err);
  }
}

/* ── PUBLIC API FOR THE RETURN AUDIT ───────────────────────────────────── */

/**
 * The single source of truth report.js uses to pre-fill the late fee field.
 * Returns the auto amount, the explanation string, and whether it applies.
 */
function lateFeeSuggestion(inv) {
  const fee = computeLateFeeForInvoice(inv);
  if (!fee.applicable) {
    return { amount: 0, applies: false, note: '', detail: fee };
  }
  let note = `Auto-calculated: ${fee.daysLate} day(s) late`;
  if (fee.graceDays > 0) note += `, ${fee.graceDays} grace day(s) excluded → ${fee.chargeableDays} chargeable`;
  note += ` × \u20a6${fmt(fee.rate)} = \u20a6${fmt(fee.amount)}`;
  if (fee.capped) note += ' (capped)';
  return { amount: fee.amount, applies: fee.amount > 0, note, detail: fee };
}

/* ── INIT ──────────────────────────────────────────────────────────────── */

async function initReturnAlerts() {
  bindReturnAlertEvents();
  renderAlertSettingsForm();   // instant paint from defaults/cache
  await loadAlertSettings();
  await loadReminderLog();
  renderReturnAlerts();

  // A rental becomes overdue at midnight and reminders become "due now" without
  // any user action, so refresh the queue periodically rather than only on click.
  if (alertTickerId) clearInterval(alertTickerId);
  alertTickerId = setInterval(() => {
    if (document.visibilityState === 'visible') renderReturnAlerts();
  }, 5 * 60 * 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderReturnAlerts();
  });
}

/* ── WINDOW EXPORTS ────────────────────────────────────────────────────── */

window.initReturnAlerts = initReturnAlerts;
window.renderReturnAlerts = renderReturnAlerts;
window.buildAlertQueue = buildAlertQueue;
window.alertDueState = alertDueState;
window.computeLateFee = computeLateFee;
window.computeLateFeeForInvoice = computeLateFeeForInvoice;
window.lateFeeSuggestion = lateFeeSuggestion;
window.buildReminderMessage = buildReminderMessage;
window.sendReminder = sendReminder;
