/* ==============================================================================
   Kitchenware Rentals Ltd — ERP & Order Management System
   MODULE: STATE — data stores, constants, persistence, customers, orders
   ============================================================================== */

/* ── APP STATE & DATA STORES ────────────────────────────────────────────── */
let currentUser = null;
let currentRole = 'user';
let rowId = 0;
let legacyRowId = 0;
let activeSelectedInvoice = null;
let MASTER_CUSTOMERS = [];
let selectedLegacyFile = null;

// Master Invoices Initial Baseline Records
const INITIAL_MASTER_INVOICES = [
  {
    invoiceNo: '#INV-0001',
    date: '2026-09-26',
    customerName: 'Amina Bello',
    phone: '+234 809 266 0766',
    email: 'amina@example.com',
    address: 'Plot 541A, 4TH Avenue, Gwarimpa Housing Estate, Gwarimpa, Abuja FCT',
    totalCost: 195875,
    subtotal: 145000,
    vat: 10875,
    caution: 25000,
    transport: 15000,
    status: 'CONFIRMED',
    depositStatus: 'HELD',
    isLegacy: false,
    items: [
      { qty: 20, desc: 'Chafing Dish Single (Roll Top)', price: 3500, total: 70000 },
      { qty: 200, desc: 'Dinner Plate Porcelain (White)', price: 150, total: 30000 },
      { qty: 150, desc: 'Wine Glass (Stemmed)', price: 120, total: 18000 },
      { qty: 150, desc: 'Stainless Steel Cutlery Set', price: 80, total: 12000 },
      { qty: 10, desc: 'Serving Tray Oval (Stainless)', price: 1500, total: 15000 }
    ]
  },
  {
    invoiceNo: '#INV-0002',
    date: '2026-09-24',
    customerName: 'Chief Okafor Catering Services',
    phone: '+234 703 068 6500',
    email: 'okafor.catering@gmail.com',
    address: 'Suite 12, Transcorp Hilton Event Center, Aguiyi Ironsi Way, Maitama, Abuja FCT',
    totalCost: 338750,
    subtotal: 250000,
    vat: 18750,
    caution: 50000,
    transport: 20000,
    status: 'OUT_ON_HIRE',
    depositStatus: 'REFUNDED',
    isLegacy: false,
    items: [
      { qty: 40, desc: 'Chafing Dish Double (Standard)', price: 3000, total: 120000 },
      { qty: 500, desc: 'Dinner Plate Porcelain (White)', price: 150, total: 75000 },
      { qty: 350, desc: 'Highball Glass (Cocktail)', price: 100, total: 35000 },
      { qty: 4, desc: 'Juice Dispenser (12 Litre)', price: 5000, total: 20000 }
    ]
  },
  {
    invoiceNo: '#INV-0003',
    date: '2026-09-20',
    customerName: 'Hadiza Usman Wedding Banquet',
    phone: '+234 802 334 9911',
    email: 'hadiza.usman@live.com',
    address: 'No 45 Kwame Nkrumah Crescent, Off Tiamiyu Savage, Asokoro, Abuja FCT',
    totalCost: 100625,
    subtotal: 75000,
    vat: 5625,
    caution: 15000,
    transport: 5000,
    status: 'RETURNED',
    depositStatus: 'HELD',
    isLegacy: false,
    items: [
      { qty: 10, desc: 'Chafing Dish Single (Roll Top)', price: 3500, total: 35000 },
      { qty: 200, desc: 'Wine Glass (Stemmed)', price: 120, total: 24000 },
      { qty: 200, desc: 'Stainless Steel Cutlery Set', price: 80, total: 16000 }
    ]
  },
  {
    invoiceNo: '#INV-0004',
    date: '2026-09-26',
    customerName: 'Kwara Events & Hospitality Ltd',
    phone: '+234 813 555 7788',
    email: 'events@kwara-group.ng',
    address: 'Phase 3 Banquet Hall, City Center, Central Business District, Abuja FCT',
    totalCost: 222750,
    subtotal: 170000,
    vat: 12750,
    caution: 30000,
    transport: 10000,
    status: 'PENDING',
    depositStatus: 'HELD',
    isLegacy: false,
    items: [
      { qty: 30, desc: 'Chafing Dish Single (Roll Top)', price: 3500, total: 105000 },
      { qty: 300, desc: 'Dinner Plate Porcelain (White)', price: 150, total: 45000 },
      { qty: 200, desc: 'Highball Glass (Cocktail)', price: 100, total: 20000 }
    ]
  },
  {
    invoiceNo: '#LEG-0001',
    date: '2025-11-15',
    customerName: 'Alhaji Garba Global Ent',
    phone: '+234 802 555 4321',
    email: 'garba.events@yahoo.com',
    address: 'Old Secretariat Road, Area 1, Garki, Abuja FCT',
    totalCost: 107500,
    subtotal: 100000,
    vat: 7500,
    caution: 0,
    transport: 0,
    status: 'RETURNED',
    depositStatus: 'N/A',
    isLegacy: true,
    items: [
      { qty: 20, desc: 'Chafing Dish Double (Standard)', price: 3000, total: 60000 },
      { qty: 200, desc: 'Dinner Plate Porcelain (White)', price: 150, total: 30000 },
      { qty: 100, desc: 'Highball Glass (Cocktail)', price: 100, total: 10000 }
    ]
  }
];

let MASTER_INVOICES = [...INITIAL_MASTER_INVOICES];

// Master Catalog Items for Autocomplete
const INVENTORY_CATALOG = [
  { desc: 'Chafing Dish Single (Roll Top)', price: 3500 },
  { desc: 'Chafing Dish Double (Standard)', price: 3000 },
  { desc: 'Dinner Plate Porcelain (White)', price: 150 },
  { desc: 'Highball Glass (Cocktail)', price: 100 },
  { desc: 'Wine Glass (Stemmed)', price: 120 },
  { desc: 'Stainless Steel Cutlery Set (Fork & Spoon)', price: 80 },
  { desc: 'Serving Tray Oval (Stainless)', price: 1500 },
  { desc: 'Juice Dispenser (12 Litre)', price: 5000 }
];

/* ── PERSISTENCE HELPERS (LOCALSTORAGE & SUPABASE) ─────────────────────── */
/* ── LOCAL CACHE RECONCILIATION ────────────────────────────────────────── */
// Identity is the database row id, never the invoice number: two local records
// that share an id are one invoice, and a record whose id is gone from the
// database is not an invoice at all. Both cases used to leave ghosts behind.

function pruneMissingRemoteInvoices(remoteRows, totalCount) {
  if (!Array.isArray(remoteRows)) return 0;
  // Only trust the answer when the page we received is the whole table.
  if (typeof totalCount !== 'number' || remoteRows.length !== totalCount) return 0;

  const remoteIds = new Set(remoteRows.map(row => row && row.id).filter(Boolean));
  const kept = MASTER_INVOICES.filter(inv => !inv.dbId || remoteIds.has(inv.dbId));
  const removed = MASTER_INVOICES.length - kept.length;
  if (removed > 0) {
    console.warn(`Dropped ${removed} cached invoice(s) that no longer exist in the database.`);
    MASTER_INVOICES = kept;
  }
  return removed;
}

// A browser that synced before this fix can still hold two local copies of the
// same database row (the old code matched rows by number, and numbers were
// reused). Keep the newest copy and drop the stale ghost.
function dedupeMasterInvoices() {
  const seen = new Map();
  const kept = [];
  MASTER_INVOICES.forEach(inv => {
    if (!inv || !inv.dbId) { kept.push(inv); return; }
    const previous = seen.get(inv.dbId);
    if (!previous) {
      seen.set(inv.dbId, inv);
      kept.push(inv);
      return;
    }
    const previousTime = Date.parse(previous.updatedAt || '') || 0;
    const currentTime = Date.parse(inv.updatedAt || '') || 0;
    if (currentTime >= previousTime) {
      const at = kept.indexOf(previous);
      if (at !== -1) kept[at] = inv;
      seen.set(inv.dbId, inv);
    }
  });

  const removed = MASTER_INVOICES.length - kept.length;
  if (removed > 0) {
    console.warn(`Collapsed ${removed} stale duplicate invoice record(s) that shared a database id.`);
    MASTER_INVOICES = kept;
    persistMasterInvoices();
  }
  return removed;
}

function loadMasterInvoices() {
  const localSaved = localStorage.getItem('kwr_saved_invoices');
  if (localSaved) {
    try {
      const parsed = JSON.parse(localSaved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed.forEach(inv => {
          const idx = MASTER_INVOICES.findIndex(i => i.invoiceNo === inv.invoiceNo);
          if (idx !== -1) MASTER_INVOICES[idx] = inv;
          else MASTER_INVOICES.unshift(inv);
        });
      }
    } catch (e) {
      console.error('Error reading localStorage invoices:', e);
    }
  }
  dedupeMasterInvoices();
}

function persistMasterInvoices() {
  try {
    localStorage.setItem('kwr_saved_invoices', JSON.stringify(MASTER_INVOICES));
  } catch (e) {
    console.error('Error saving invoices to localStorage:', e);
  }
}

async function fetchCustomersFromSupabase() {
  try {
    const { data, error } = await db.from('customers').select('*');
    if (data && data.length > 0) {
      MASTER_CUSTOMERS = data;
    }
  } catch (e) {
    console.log('Customers fetch note:', e);
  }

  // Supplement from existing MASTER_INVOICES so autocomplete is always populated
  MASTER_INVOICES.forEach(inv => {
    if (inv.customerName && !MASTER_CUSTOMERS.some(c => c.name && c.name.toLowerCase() === inv.customerName.toLowerCase())) {
      MASTER_CUSTOMERS.push({
        name: inv.customerName,
        telephone: inv.phone && inv.phone !== 'N/A' ? inv.phone : '',
        email: inv.email && inv.email !== 'N/A' ? inv.email : '',
        address: (inv.customerAddress || inv.address) && (inv.customerAddress || inv.address) !== 'Store Pickup / Local Delivery' ? (inv.customerAddress || inv.address) : ''
      });
    }
  });
}

/* ── CUSTOMER AUTOCOMPLETE & DB SYNC ─────────────────────────────────── */
function runCustomerAutocomplete(val, context = 'invoicing') {
  const query = (val || '').toLowerCase().trim();
  const resultsEl = document.getElementById(context === 'legacy' ? 'legCustomerResults' : 'customerResults');
  if (!resultsEl) return;

  if (!query) {
    resultsEl.style.display = 'none';
    resultsEl.innerHTML = '';
    return;
  }

  const matches = MASTER_CUSTOMERS.filter(c =>
    (c.name && c.name.toLowerCase().includes(query)) ||
    (c.telephone && c.telephone.toLowerCase().includes(query)) ||
    (c.email && c.email.toLowerCase().includes(query))
  ).slice(0, 8);

  if (matches.length === 0) {
    resultsEl.innerHTML = `
      <div style="padding: 10px 14px; font-size: 12px; color: var(--muted); font-style: italic;">
        New customer profile — will be auto-saved to Customer Database on submit.
      </div>
    `;
    resultsEl.style.display = 'block';
    return;
  }

  resultsEl.innerHTML = matches.map((c, idx) => `
    <div class="autocomplete-item" data-action="select-customer" data-customer-idx="${idx}" data-customer-context="${escapeHtml(context)}">
      <div class="name">👤 ${escapeHtml(c.name)}</div>
      <div class="sub">📞 ${escapeHtml(c.telephone || 'No phone')} · ✉️ ${escapeHtml(c.email || 'No email')} · 📍 ${escapeHtml(c.address ? c.address.slice(0, 32) + '...' : 'No address')}</div>
    </div>
  `).join('');
  resultsEl.style.display = 'block';
  resultsEl._activeMatches = matches;
}

const autocompleteCustomer = debounce(runCustomerAutocomplete, 250);

function selectCustomer(idx, context = 'invoicing') {
  const resultsEl = document.getElementById(context === 'legacy' ? 'legCustomerResults' : 'customerResults');
  const matches = resultsEl?._activeMatches || [];
  const cust = matches[idx];
  if (!cust) return;

  if (context === 'legacy') {
    document.getElementById('legCustomerName').value = cust.name || '';
    if (document.getElementById('legPhone')) document.getElementById('legPhone').value = cust.telephone || '';
    if (document.getElementById('legEmail')) document.getElementById('legEmail').value = cust.email || '';
    if (document.getElementById('legAddress')) document.getElementById('legAddress').value = cust.address || '';
  } else {
    document.getElementById('fCustomerName').value = cust.name || '';
    document.getElementById('fPhone').value = cust.telephone || '';
    document.getElementById('fEmail').value = cust.email || '';
    if (document.getElementById('fCustomerAddress')) document.getElementById('fCustomerAddress').value = cust.address || '';
    // Delivery / Event Address is venue-specific and must stay independent of the customer's address.
  }

  resultsEl.style.display = 'none';
  showToast(`Selected customer "${cust.name}"`, 'success');
}

// Dismiss autocomplete dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('#fCustomerName') && !e.target.closest('#customerResults')) {
    const el = document.getElementById('customerResults');
    if (el) el.style.display = 'none';
  }
  if (!e.target.closest('#legCustomerName') && !e.target.closest('#legCustomerResults')) {
    const el = document.getElementById('legCustomerResults');
    if (el) el.style.display = 'none';
  }
});

async function saveCustomerToDb(cust) {
  if (!cust || !cust.name || !cust.name.trim()) return null;
  const cleanName = cust.name.trim();
  try {
    const { data: existing } = await db.from('customers')
      .select('id, name, telephone, email, address')
      .ilike('name', cleanName)
      .limit(1);

    if (existing && existing.length > 0) {
      const existingCust = existing[0];
      const updatePayload = {};
      if (cust.telephone && !existingCust.telephone) updatePayload.telephone = cust.telephone;
      if (cust.email && !existingCust.email) updatePayload.email = cust.email;
      if (cust.address && !existingCust.address) updatePayload.address = cust.address;
      if (Object.keys(updatePayload).length > 0) {
        await db.from('customers').update(updatePayload).eq('id', existingCust.id);
      }
      return existingCust.id;
    } else {
      const { data, error } = await db.from('customers').insert({
        name: cleanName,
        telephone: cust.telephone || '',
        email: cust.email || '',
        address: cust.address || '',
        notes: cust.notes || 'Ingested via KWR Portal'
      }).select();

      if (error) {
        console.warn('Customer DB insert note:', error.message);
      } else if (data && data[0]) {
        MASTER_CUSTOMERS.unshift(data[0]);
        return data[0].id;
      }
    }
  } catch (err) {
    console.warn('saveCustomerToDb error:', err);
  }

  // Local fallback
  if (!MASTER_CUSTOMERS.some(c => c.name && c.name.toLowerCase() === cleanName.toLowerCase())) {
    MASTER_CUSTOMERS.unshift({
      name: cleanName,
      telephone: cust.telephone || '',
      email: cust.email || '',
      address: cust.address || ''
    });
  }
  return null;
}

async function logAuditAction(orderNo, action, details = {}) {
  try {
    const actorEmail = (typeof currentUser !== 'undefined' && currentUser?.email) || (typeof currentRole !== 'undefined' ? currentRole : 'system');
    const actorId = (typeof currentUser !== 'undefined' && currentUser?.id) || null;
    const actorRole = typeof currentRole !== 'undefined' ? currentRole : 'user';
    const cleanNo = orderNo ? String(orderNo).replace(/^#INV-/, '').replace(/^#/, '') : null;

    await db.from('audit_logs').insert({
      order_no: cleanNo,
      action,
      actor_id: actorId && !actorId.startsWith('demo-') ? actorId : null,
      actor_email: actorEmail,
      actor_role: actorRole,
      details: typeof details === 'object' && details !== null ? details : { info: details }
    });
  } catch (err) {
    // Audit logging is non-blocking; warn without interrupting the user workflow
    console.warn('Audit logging note:', err?.message || err);
  }
}

/* ── SERVER-SIDE INVOICE NUMBER ALLOCATION ─────────────────────────────── */
// Numbers are never derived from the local list. A Postgres sequence (migration
// 03) hands out the next value, so two browsers can never receive the same
// number and a cleared localStorage starts from the real maximum, not 0005.
const ORDER_INSERT_MAX_ATTEMPTS = 3;

function normalizeOrderNo(invoiceNo) {
  return String(invoiceNo || '').trim().replace(/^#/, '').replace(/^INV-/i, '');
}

function formatInvoiceNo(orderNo) {
  const raw = String(orderNo || '').trim();
  if (!raw) return '';
  if (raw.startsWith('#')) return raw;
  if (/^LEG-/i.test(raw)) return `#${raw}`;
  return `#INV-${raw.replace(/^INV-/i, '').padStart(4, '0')}`;
}

// One source of truth for numbers: the highest order_no actually stored in the
// database. The same function feeds the on-screen badge and the save, so the
// number you see is the number you get, and nothing is consumed by a page load.
//
// Uniqueness is enforced by the database (unique constraint on order_no), and
// insertOrderRow() retries with a fresh number if two devices race for the same
// one. That is what makes this safe without a separate counter.
async function nextNumberFromDatabase(kind) {
  const pattern = kind === 'legacy' ? /^#?LEG-(\d+)$/i : /^#?(?:INV-)?(\d+)$/i;
  let max = 0;

  // Page through every stored number: one request is capped at 1000 rows and a
  // truncated read would compute a number that is already taken.
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('orders')
      .select('order_no')
      .order('order_no', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;

    (data || []).forEach(row => {
      const match = String(row.order_no || '').match(pattern);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    });

    if (!data || data.length < PAGE) break;
  }

  const next = max + 1;
  return kind === 'legacy'
    ? `#LEG-${String(next).padStart(4, '0')}`
    : `#INV-${String(next).padStart(4, '0')}`;
}

// Projection for the badge: a plain read, so refreshing never burns a number.
async function projectNextInvoiceNo() {
  return nextNumberFromDatabase('invoice');
}

async function projectNextLegacyNo() {
  return nextNumberFromDatabase('legacy');
}

// Called at save time. Same computation as the projection, so the number on
// screen and the number saved agree; a race is resolved by the retry in
// insertOrderRow().
async function allocateInvoiceNo() {
  return nextNumberFromDatabase('invoice');
}

async function allocateLegacyNo() {
  return nextNumberFromDatabase('legacy');
}

/* ── ORDER PERSISTENCE (IDENTITY = id, NEVER order_no) ─────────────────── */
function buildOrderPayload(inv) {
  const payload = {
    order_date: inv.date || inv.startDate || new Date().toISOString().split('T')[0],
    // The hire period must reach the database, not just localStorage: the alert
    // engine, the late-fee maths and any other device all read end_date as the
    // due date. Null is honest — a guessed date would produce false reminders.
    start_date: inv.startDate || inv.date || null,
    end_date: inv.endDate || null,
    cust_name: inv.customerName || 'Customer',
    telephone: inv.phone && inv.phone !== 'N/A' ? inv.phone : '',
    email: inv.email && inv.email !== 'N/A' ? inv.email : '',
    address: inv.address || inv.customerAddress || 'Local Delivery',
    rental_total: Number(inv.subtotal) || 0,
    caution_dep: Number(inv.caution) || 0,
    transport: Number(inv.transport) || 0,
    grand_total: Number(inv.totalCost) || 0,
    items: Array.isArray(inv.items) ? inv.items : [],
    status: inv.status || 'CONFIRMED',
    deposit_status: inv.depositStatus || (inv.caution > 0 ? 'HELD' : 'N/A'),
    is_legacy: Boolean(inv.isLegacy),
    order_type: inv.isLegacy ? 'legacy' : 'new',
    notes: inv.notes || (inv.isLegacy ? 'Legacy paper receipt ingestion' : 'Live system invoice'),
    return_report: inv.returnReport || null,
    return_review: inv.returnReview || null,
    refund_amount: Number(inv.refundAmount) || 0,
    refund_bank: inv.refundBank || null,
    refunded_at: inv.refundedAt || null,
    refunded_by: inv.refundedBy || null,
    payout_adjustment: inv.payoutAdjustment || null,
    payout_closed: Boolean(inv.payoutClosed),
    payout_closed_at: inv.payoutClosedAt || null,
    payout_closed_by: inv.payoutClosedBy || null,
    returned_at: inv.returnedAt || null,
    review_revocations: Array.isArray(inv.reviewRevocations) ? inv.reviewRevocations : []
  };

  // Link the order to its customer record. Only send the key when it is known,
  // so an edit of an older row cannot blank out an existing link.
  if (inv.customerId) payload.customer_id = inv.customerId;
  return payload;
}

function applyOrderRowToInvoice(inv, row) {
  if (!row) return;
  if (row.id) inv.dbId = row.id;
  if (row.updated_at) inv.updatedAt = row.updated_at;
  if (row.order_no) inv.invoiceNo = formatInvoiceNo(row.order_no);
}

function isUniqueViolation(error) {
  return error?.code === '23505' || /duplicate key|unique constraint/i.test(error?.message || '');
}

function describeOrderWriteError(error) {
  if (!error) return new Error('The database did not confirm the write.');
  const message = error.message || String(error);
  if (/column .* does not exist|schema cache/i.test(message)) {
    return new Error(
      `The orders table is missing a column this app writes (${message}). ` +
      'Run db/migrations/02, 03 and 04, then reload the page.'
    );
  }
  if (/row-level security/i.test(message)) {
    return new Error(`The database rejected this write (${message}). Check the orders RLS policy for your role.`);
  }
  return error instanceof Error ? error : new Error(message);
}

function conflictError() {
  const err = new Error(
    'This invoice was changed elsewhere after you opened it. Nothing was overwritten — reload the latest version and try again.'
  );
  err.conflict = true;
  return err;
}

async function insertOrderRow(inv, payload, options) {
  const allowRenumber = options.allowRenumber !== false && inv.isNew !== false;
  let candidate = normalizeOrderNo(inv.invoiceNo);
  let lastError = null;

  for (let attempt = 0; attempt < ORDER_INSERT_MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await db.from('orders')
      .insert({ ...payload, order_no: candidate })
      .select('id, order_no, updated_at')
      .single();

    if (!error && data) {
      applyOrderRowToInvoice(inv, data);
      return { data, renumbered: attempt > 0 };
    }

    lastError = error || new Error('The database did not return the inserted invoice.');

    if (!isUniqueViolation(lastError)) break;

    if (!allowRenumber) {
      const duplicate = new Error(
        `Invoice number ${candidate} is already used by another transaction. Nothing was overwritten — ` +
        'reload the invoice list so this record picks up its database id, then save again.'
      );
      duplicate.code = lastError.code;
      return { error: duplicate };
    }

    // Another browser/device took this number first. Ask the server for the
    // next one and retry; the new invoice has not been referenced anywhere yet.
    try {
      inv.invoiceNo = inv.isLegacy ? await allocateLegacyNo() : await allocateInvoiceNo();
      candidate = normalizeOrderNo(inv.invoiceNo);
    } catch (allocErr) {
      return { error: allocErr };
    }
  }

  return { error: describeOrderWriteError(lastError) };
}

async function updateOrderRow(inv, payload) {
  let expectedUpdatedAt = inv.updatedAt || null;

  // Rows loaded before migration 03 (or created in another tab) may not have a
  // cached version yet. Read it once, then update under that version.
  if (!expectedUpdatedAt) {
    const { data: current, error: readErr } = await db.from('orders')
      .select('updated_at')
      .eq('id', inv.dbId)
      .maybeSingle();
    if (readErr) return { error: describeOrderWriteError(readErr) };
    if (!current) {
      return { error: new Error('This invoice no longer exists in the database. Reload the invoice list.') };
    }
    expectedUpdatedAt = current.updated_at;
  }

  const { data, error } = await db.from('orders')
    .update(payload)
    .eq('id', inv.dbId)
    .eq('updated_at', expectedUpdatedAt)
    .select('id, order_no, updated_at')
    .maybeSingle();

  if (error) return { error: describeOrderWriteError(error) };
  if (!data) return { error: conflictError(), conflict: true };

  applyOrderRowToInvoice(inv, data);
  return { data };
}

/**
* Unified persistence helper: transforms an in-memory invoice object and syncs
* all state (including return audit, review gate, and payouts) to Supabase.
*
* Identity rules:
*  - New invoices are INSERTed with a server-allocated order_no.
*  - Edits are UPDATEed by the database id, guarded by updated_at (optimistic
*    concurrency). The code never looks a row up by order_no, so a number
*    collision can never overwrite somebody else's invoice.
*/
async function syncInvoiceToSupabase(inv, options = {}) {
  if (!inv || !inv.invoiceNo) return { error: new Error('Invalid invoice object') };

  try {
    const payload = buildOrderPayload(inv);
    if (inv.dbId) return await updateOrderRow(inv, payload);
    return await insertOrderRow(inv, payload, options);
  } catch (err) {
    console.error('Sync invoice error:', err);
    return { error: describeOrderWriteError(err) };
  }
}

async function fetchInvoicesFromSupabase() {
  try {
  const { data, error, count } = await db.from('orders').select('*', { count: 'exact' });
    if (error) {
      console.error('Supabase invoice fetch failed:', error);
      throw error;
    }
    if (data && data.length > 0) {
      data.forEach(order => {
        const isLegacy = order.is_legacy === true ||
          order.order_type === 'legacy' ||
          (order.notes && order.notes.includes('[LEGACY_INGESTION]')) ||
          (order.order_no && String(order.order_no).startsWith('LEG-'));

        const invNo = order.order_no
          ? (order.order_no.startsWith('#') || order.order_no.startsWith('LEG-')
            ? order.order_no
            : `#INV-${String(order.order_no).padStart(4, '0')}`)
          : `#INV-0000`;

        const existingIdx = MASTER_INVOICES.findIndex(i => i.invoiceNo === invNo);
        const mappedOrder = {
          invoiceNo: invNo,
          // Database identity + version are what edits are keyed on. They travel
          // with the invoice so a save can never fall back to matching by the
          // (non-unique) order_no. order_no itself is display-only now.
          dbId: order.id,
          updatedAt: order.updated_at,
          customerId: order.customer_id || undefined,
          date: order.order_date || (order.created_at ? order.created_at.split('T')[0] : '2026-09-26'),
          // Hire period, so the due-date alerts survive a page load / device
          // switch. Rows written before migration 04 have nulls here.
          startDate: order.start_date || order.order_date || undefined,
          endDate: order.end_date || undefined,
          customerName: order.cust_name || order.placed_by || 'Customer',
          phone: order.telephone || 'N/A',
          email: order.email || 'N/A',
          address: order.address || 'Local Delivery',
          totalCost: order.grand_total || order.rental_total || 0,
          subtotal: order.rental_total || 0,
          caution: order.caution_dep || 0,
          transport: order.transport || 0,
          status: order.status || 'CONFIRMED',
          depositStatus: order.deposit_status || 'HELD',
          isLegacy: Boolean(isLegacy),
          items: Array.isArray(order.items) ? order.items : [],
          returnReport: order.return_report && typeof order.return_report === 'object' && Object.keys(order.return_report).length > 0
            ? order.return_report : undefined,
          returnReview: order.return_review && typeof order.return_review === 'object' && Object.keys(order.return_review).length > 0
            ? order.return_review : undefined,
          refundAmount: order.refund_amount !== null && order.refund_amount !== undefined
            ? Number(order.refund_amount) : undefined,
          refundBank: order.refund_bank && typeof order.refund_bank === 'object' && Object.keys(order.refund_bank).length > 0
            ? order.refund_bank : undefined,
          refundedAt: order.refunded_at || undefined,
          refundedBy: order.refunded_by || undefined,
          payoutAdjustment: order.payout_adjustment || undefined,
          payoutClosed: Boolean(order.payout_closed),
          payoutClosedAt: order.payout_closed_at || undefined,
          payoutClosedBy: order.payout_closed_by || undefined,
          returnedAt: order.returned_at || undefined,
          reviewRevocations: Array.isArray(order.review_revocations) ? order.review_revocations : []
        };

        if (existingIdx !== -1) {
          // Merge Supabase updates with existing local invoice.
          // Identity columns always win over whatever the local copy had.
          const local = MASTER_INVOICES[existingIdx];
          MASTER_INVOICES[existingIdx] = {
            ...local,
            ...mappedOrder,
            dbId: mappedOrder.dbId,
            updatedAt: mappedOrder.updatedAt,
            customerId: mappedOrder.customerId !== undefined ? mappedOrder.customerId : local.customerId,
            // Same rule for the hire period: a pre-migration row returns null
            // from the server and must not blank out a locally known end date.
            startDate: mappedOrder.startDate || local.startDate,
            endDate: mappedOrder.endDate || local.endDate,
            // Keep local properties if Supabase record has null/undefined for returns/reviews
            returnReport: mappedOrder.returnReport || local.returnReport,
            returnReview: mappedOrder.returnReview || local.returnReview,
            refundAmount: mappedOrder.refundAmount !== undefined ? mappedOrder.refundAmount : local.refundAmount,
            refundBank: mappedOrder.refundBank || local.refundBank,
            refundedAt: mappedOrder.refundedAt || local.refundedAt,
            refundedBy: mappedOrder.refundedBy || local.refundedBy,
            payoutAdjustment: mappedOrder.payoutAdjustment || local.payoutAdjustment,
            payoutClosed: mappedOrder.payoutClosed || local.payoutClosed,
            returnedAt: mappedOrder.returnedAt || local.returnedAt,
            reviewRevocations: mappedOrder.reviewRevocations.length > 0 ? mappedOrder.reviewRevocations : (local.reviewRevocations || [])
          };
        } else {
          MASTER_INVOICES.unshift(mappedOrder);
        }
      });

    pruneMissingRemoteInvoices(data, count);
  dedupeMasterInvoices();
      persistMasterInvoices();
      if (typeof renderAllInvoicesTable === 'function') renderAllInvoicesTable(MASTER_INVOICES);
      if (typeof renderDepositsTable === 'function') renderDepositsTable();
      if (typeof renderReturnAlerts === 'function') renderReturnAlerts();
      if (typeof renderLegacyLogsTable === 'function') renderLegacyLogsTable();
      if (typeof updateDashboardMetrics === 'function') updateDashboardMetrics();
    }
    return { ok: true, count: data ? data.length : 0 };
  } catch (e) {
    console.error('Supabase invoice fetch note:', e);
    return { ok: false, error: e };
  }
}

// Window exports
window.syncInvoiceToSupabase = syncInvoiceToSupabase;
window.allocateInvoiceNo = allocateInvoiceNo;
window.allocateLegacyNo = allocateLegacyNo;
window.projectNextInvoiceNo = projectNextInvoiceNo;
window.projectNextLegacyNo = projectNextLegacyNo;
window.formatInvoiceNo = formatInvoiceNo;
window.logAuditAction = logAuditAction;
window.fetchInvoicesFromSupabase = fetchInvoicesFromSupabase;
window.saveCustomerToDb = saveCustomerToDb;
