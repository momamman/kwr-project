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

async function insertOrderWithFallback(orderPayload) {
  try {
    const res = await db.from('orders').insert(orderPayload);
    if (!res.error) return res;

    // Fallback if column is_legacy is not yet present in Supabase
    if (res.error && res.error.message && res.error.message.includes('does not exist')) {
      console.warn('Orders column fallback:', res.error.message);
      const fallbackPayload = { ...orderPayload };
      delete fallbackPayload.is_legacy;
      delete fallbackPayload.order_type;
      if (orderPayload.is_legacy) {
        fallbackPayload.notes = (fallbackPayload.notes ? fallbackPayload.notes + ' ' : '') + '[LEGACY_INGESTION]';
      }
      return await db.from('orders').insert(fallbackPayload);
    }
    return res;
  } catch (err) {
    console.error('Insert order error:', err);
    return { error: err };
  }
}

async function fetchInvoicesFromSupabase() {
  try {
    const { data, error } = await db.from('orders').select('*');
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

        const exists = MASTER_INVOICES.find(i => i.invoiceNo === invNo);
        if (!exists) {
          MASTER_INVOICES.unshift({
            invoiceNo: invNo,
            date: order.order_date || (order.created_at ? order.created_at.split('T')[0] : '2026-09-26'),
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
            items: Array.isArray(order.items) ? order.items : []
          });
        }
      });
      persistMasterInvoices();
      renderAllInvoicesTable(MASTER_INVOICES);
      renderDepositsTable();
      renderLegacyLogsTable();
      updateDashboardMetrics();
    }
  } catch (e) {
    console.log('Supabase sync note:', e);
  }
}
