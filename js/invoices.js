/* ==============================================================================
   Kitchenware Rentals Ltd — ERP & Order Management System
   MODULE: INVOICES — transactions, tabs, deposits, modals, rental billing
   ============================================================================== */
/* ── INVOICE NUMBER: PROJECTED ON SCREEN, ALLOCATED ON SAVE ─────────────── */
// The number in the form header is only a projection of the highest saved number.
// It is a plain read, so loading or refreshing the page never consumes a number
// and can never leave gaps. The real, collision-proof number is allocated by the
// server inside saveInvoice(), so a number only exists once an invoice exists.
let invoiceNumberRequest = Promise.resolve(null);
let invoiceNumberIsReady = false;
// The database row this form is editing. Identity is the id, never the number:
// a number alone must never be enough to select a row to overwrite.
let editingInvoiceDbId = null;

function setInvoiceNumberDisplay(invoiceNo) {
  const badge = document.getElementById('badgeNo');
  const hidden = document.getElementById('fOrderNo');
  if (badge) badge.textContent = invoiceNo;
  if (hidden) hidden.value = invoiceNo;
}

function setInvoiceFormMode(mode) {
  // mode: 'editing' | 'new' | 'unassigned'
  const form = document.getElementById('tab-invoicing');
  if (form) form.dataset.invoiceMode = mode;
  document.body.dataset.invoiceMode = mode;
  updateInvoiceSaveAvailability();
}

function updateInvoiceSaveAvailability() {
  const mode = document.body.dataset.invoiceMode || 'unassigned';
  const editable = mode === 'editing';
  // A new invoice is always saveable: its number is allocated during the save,
  // so the number on screen is a hint rather than a prerequisite.
  const ready = editable || mode === 'new' || mode === 'unassigned' || !mode;

  const displayNo = document.getElementById('fOrderNo')?.value || '';
  [document.getElementById('btnSaveInvoice'), document.getElementById('btnStickySave')].forEach(btn => {
    if (!btn) return;
    btn.disabled = !ready;
    btn.setAttribute('aria-busy', ready ? 'false' : 'true');
    btn.title = !ready
      ? 'Waiting for the form to load…'
      : (editable
        ? `Save changes to ${displayNo || 'this invoice'}`
        : 'Save this invoice — its number is allocated when it is saved')
  });
}

function refreshInvoiceNumber(showToastMessage) {
  // Cheap and side-effect free: reads the highest saved number, consumes nothing.
  const request = (async () => {
    invoiceNumberIsReady = false;
    setInvoiceFormMode('new');
    const badge = document.getElementById('badgeNo');
    if (badge) badge.textContent = '…';
    try {
      const no = await projectNextInvoiceNo();
      // A newer refresh superseded this one. Stop here without touching the
      // badge: the newer request already shows '…' and will fill in the number
      // itself. Writing here would strand the header on '…' until the next save.
      if (request !== invoiceNumberRequest) return null;
      setInvoiceNumberDisplay(no);
      invoiceNumberIsReady = true;
      updateInvoiceSaveAvailability();
      if (showToastMessage) showToast(`New transaction ready (next number ${no})`, 'success');
      return no;
    } catch (err) {
      // The projection is cosmetic. Saving still works, because the number is
      // allocated at save time. Only the newest request may report it, though.
      if (request !== invoiceNumberRequest) return null;
      setInvoiceNumberDisplay('');
      invoiceNumberIsReady = true;
      updateInvoiceSaveAvailability();
      if (badge) badge.textContent = 'Assigned on save';
      console.warn('Invoice number projection unavailable:', err);
      return null;
    }
  })();
  invoiceNumberRequest = request;
  return request;
}

function createNewTransaction() {
  clearInvoiceForm();
  if (typeof clearInvoiceErrors === 'function') clearInvoiceErrors();
  return invoiceNumberRequest;
}

function handleClearInvoicing() {
  clearInvoiceForm();
  if (typeof clearInvoiceErrors === 'function') clearInvoiceErrors();
  showToast('All invoicing fields cleared — the next number is assigned when you save', 'success');
  return invoiceNumberRequest;
}

function clearInvoiceForm() {
  editingInvoiceDbId = null;
  if (document.getElementById('fCustomerName')) document.getElementById('fCustomerName').value = '';
  if (document.getElementById('fPhone')) document.getElementById('fPhone').value = '';
  if (document.getElementById('fEmail')) document.getElementById('fEmail').value = '';
  if (document.getElementById('fCustomerAddress')) document.getElementById('fCustomerAddress').value = '';
  if (document.getElementById('fAddress')) document.getElementById('fAddress').value = '';
  if (document.getElementById('fCaution')) document.getElementById('fCaution').value = '';
  if (document.getElementById('fTransport')) document.getElementById('fTransport').value = '';

  const custRes = document.getElementById('customerResults');
  if (custRes) {
    custRes.innerHTML = '';
    custRes.style.display = 'none';
  }

  const today = new Date().toISOString().split('T')[0];
  if (document.getElementById('fStartDate')) document.getElementById('fStartDate').value = today;
  if (document.getElementById('fEndDate')) document.getElementById('fEndDate').value = today;

  const tbody = document.getElementById('itemsBody');
  if (tbody) {
    tbody.innerHTML = '';
    rowId = 0;
    addRow(); addRow(); addRow();
  }
  recalc();
  if (typeof setFormReadOnly === 'function') setFormReadOnly(false);
  // A cleared form is a brand-new transaction, so it needs a fresh server number.
  refreshInvoiceNumber(false);
}

/* ── ROLE-BASED TAB SWITCHING ──────────────────────────────────────────── */
function setupTabPermissions() {
  const tabs = ['invoicing', 'all-invoices', 'data-entry', 'analysis', 'deposits', 'return-alerts'];
  tabs.forEach(tab => {
    const btn = document.getElementById(`btn-tab-${tab}`);
    if (!btn) return;
    const canAccess = auth.canAccessTab(currentRole, tab.replace('-', '_'));
    if (!canAccess && currentRole !== 'super_admin' && currentRole !== 'admin') {
      btn.classList.add('disabled');
      btn.setAttribute('aria-disabled', 'true');
      btn.title = 'Your role does not have access to this section';
      if (!btn.querySelector('.tab-lock-icon')) {
        btn.innerHTML += `<span class="tab-lock-icon" aria-hidden="true">🔒</span>`;
      }
    }
  });

  // Screen-reader wiring for the tab set
  const list = document.querySelector('.app-nav-links');
  if (list) list.setAttribute('role', 'tablist');
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `tab-${btn.dataset.tab}`);
    btn.setAttribute('aria-selected', String(btn.classList.contains('active')));
  });

  if (auth.canAccessTab(currentRole, 'invoicing')) switchTab('invoicing');
  else if (auth.canAccessTab(currentRole, 'data_entry')) switchTab('data-entry');
  else if (auth.canAccessTab(currentRole, 'analysis')) switchTab('analysis');
}

function switchTab(tabName) {
  const rolePermissionName = tabName.replace('-', '_');
  if (!auth.canAccessTab(currentRole, rolePermissionName) && currentRole !== 'super_admin' && currentRole !== 'admin') {
    showToast('Unauthorized tab access for your profile role', 'error');
    return;
  }

  const activeBtn = document.getElementById(`btn-tab-${tabName}`);
  const activeTab = document.getElementById(`tab-${tabName}`);
  if (!activeTab) return;

  document.querySelectorAll('.tab-btn').forEach(b => {
    const isActive = b === activeBtn;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    const isActive = c === activeTab;
    c.classList.toggle('active', isActive);
    c.setAttribute('role', 'tabpanel');
    c.setAttribute('aria-labelledby', `btn-tab-${c.id.replace('tab-', '')}`);
  });

  if (tabName === 'analysis') {
    updateDashboardMetrics();
  }

  // The alert queue is date-driven, so recompute it every time the panel opens
  // rather than trusting whatever was rendered at page load.
  if (tabName === 'return-alerts' && typeof renderReturnAlerts === 'function') {
    renderReturnAlerts();
  }

  if (typeof updateStickyTotalVisibility === 'function') updateStickyTotalVisibility();

  // Bring the newly selected panel into view (the sidebar sits above it)
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ── ALL INVOICES TAB LIST RENDERING & CLICK INTERACTION ───────────────── */
function renderAllInvoicesTable(invoices) {
  const tbody = document.getElementById('allInvoicesListBody');
  if (!tbody) return;

  const empty = document.getElementById('allInvoicesEmpty');
  const wrap = tbody.closest('.table-scroll');

  if (!invoices || invoices.length === 0) {
    tbody.innerHTML = '';
    if (empty) {
      const noneAtAll = !Array.isArray(MASTER_INVOICES) || MASTER_INVOICES.length === 0;
      document.getElementById('allInvoicesEmptyTitle').textContent = noneAtAll ? 'No invoices yet' : 'No matching invoices';
      document.getElementById('allInvoicesEmptyText').textContent = noneAtAll
        ? 'Create your first rental invoice and it will appear here.'
        : 'Try a different search term, or clear the status filter.';
      const action = document.getElementById('allInvoicesEmptyAction');
      if (action) action.hidden = !noneAtAll;
      empty.hidden = false;
    }
    if (wrap) wrap.hidden = true;
    return;
  }

  if (empty) empty.hidden = true;
  if (wrap) wrap.hidden = false;

  const isSuperAdmin = (currentRole === 'super_admin' || currentRole === 'admin');

    tbody.innerHTML = invoices.map((inv) => {
      let statusClass = 'pending';
      let statusLabel = 'Pending';
      if (inv.status === 'CONFIRMED') { statusClass = 'confirmed'; statusLabel = 'Confirmed (not gone out)'; }
      else if (inv.status === 'OUT_ON_HIRE') { statusClass = 'on_hire'; statusLabel = 'Out on hire'; }
      else if (inv.status === 'RETURNED') { statusClass = 'returned'; statusLabel = 'Returned'; }

      // Hide Edit button for returned/paid deposits
      const canEditInvoice = isSuperAdmin &&
        !(inv.status === 'RETURNED' && inv.depositStatus === 'REFUNDED');

      const typeBadge = inv.isLegacy
        ? `<span class="badge-legacy">📜 LEGACY</span>`
        : `<span class="badge-new">⚡ NEW</span>`;

      const editBtn = canEditInvoice
        ? `<button class="btn btn-red btn-red-sm" data-action="edit-invoice" data-invoice-no="${escapeHtml(inv.invoiceNo)}">✏️ Edit</button>`
        : '';

    const safeNo = escapeHtml(inv.invoiceNo);
    const safeDate = escapeHtml(inv.date || '');
    const safeCust = escapeHtml(inv.customerName || 'Customer');
    const safeAddress = escapeHtml(inv.customerAddress || inv.address || 'Local Delivery');
    const safeTotal = Number(inv.totalCost || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    const balanceDue = inv.status === 'RETURNED' && typeof returnBalanceDue === 'function'
      ? returnBalanceDue(inv)
      : 0;
    const balanceFlag = balanceDue > 0
      ? `<div class="balance-due-flag" title="Return charges exceed the caution deposit; this balance is still owed">⚠ ₦ ${balanceDue.toLocaleString('en-NG', { minimumFractionDigits: 2 })} due</div>`
      : '';
    const reportBtn = inv.status === 'RETURNED'
      ? `<button class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;" data-action="view-return-report" data-invoice-no="${safeNo}" title="View the service and returned-items report">📋 Report</button>`
      : '';

    return `
      <tr class="clickable-row" data-action="view-invoice" data-invoice-no="${safeNo}">
        <td>
          <div class="row row-gap-6">
            <strong style="color: var(--red); font-family: 'Outfit', sans-serif; font-size: 14px;">${safeNo}</strong>
            ${typeBadge}
          </div>
        </td>
        <td>${safeDate}</td>
        <td><strong>${safeCust}</strong></td>
        <td class="td-address">${safeAddress}</td>
        <td class="td-total"><strong style="color: var(--text);">₦ ${safeTotal}</strong>${balanceFlag}</td>
        <td><span class="status-badge ${statusClass}">${escapeHtml(statusLabel)}</span></td>
        <td style="text-align: center; white-space: nowrap;">
          ${reportBtn}
          ${editBtn}
          <button class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;">View ➔</button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterAllInvoicesTable(query) {
  const q = (query || '').toLowerCase().trim();
  const status = document.getElementById('invoiceStatusFilter')?.value || 'ALL';
  let filtered = MASTER_INVOICES;

  if (status === 'LEGACY') {
    filtered = filtered.filter(i => i.isLegacy);
  } else if (status === 'NEW') {
    filtered = filtered.filter(i => !i.isLegacy);
  } else if (status !== 'ALL') {
    filtered = filtered.filter(i => i.status === status);
  }

  if (q) {
    filtered = filtered.filter(i =>
      (i.invoiceNo && i.invoiceNo.toLowerCase().includes(q)) ||
      (i.customerName && i.customerName.toLowerCase().includes(q)) ||
      (i.customerAddress && i.customerAddress.toLowerCase().includes(q)) ||
      (i.address && i.address.toLowerCase().includes(q)) ||
      (i.totalCost && i.totalCost.toString().includes(q))
    );
  }

  renderAllInvoicesTable(filtered);
}

function filterInvoiceByStatus() {
  const q = document.getElementById('allInvoicesSearchInput')?.value || '';
  filterAllInvoicesTable(q);
}

/* ── REFUNDABLE DEPOSITS TAB RENDERING & CONDITIONAL PAYOUT BUTTON ─────── */
function invoiceRefundAmount(inv) {
  const raw = inv ? inv.refundAmount : undefined;
  const hasRaw = raw !== undefined && raw !== null && raw !== '' &&
    Number.isFinite(Number(raw)) && Number(raw) >= 0;

  // A recorded payout is the source of truth for money already sent.
  if (inv && inv.depositStatus === 'REFUNDED') {
    return hasRaw ? Number(raw) : Number(inv.caution) || 0;
  }

  // Once a return is approved, the refund figure starts from the review and
  // can be adjusted on the record before the payout is executed.
  if (inv && typeof returnReviewState === 'function') {
    const review = returnReviewState(inv);
    if (review.status === 'APPROVED') {
      return hasRaw ? Number(raw) : review.refundDue;
    }
  }

  if (hasRaw) return Number(raw);
  return Number(inv && inv.caution) || 0;
}

function renderDepositsTable() {
  const tbody = document.getElementById('depositsListBody');
  if (!tbody) return;

  const q = (document.getElementById('depositsSearchInput')?.value || '').toLowerCase().trim();
  // Closed payouts are cleared from this working list, but stay in All Invoices.
  const allDeposits = MASTER_INVOICES.filter(i => (i.caution && i.caution > 0));
  let depositInvoices = allDeposits.filter(i => !i.payoutClosed);

  if (q) {
    depositInvoices = depositInvoices.filter(i =>
      (i.invoiceNo && i.invoiceNo.toLowerCase().includes(q)) ||
      (i.customerName && i.customerName.toLowerCase().includes(q))
    );
  }

  // KPI strip stays cumulative: closing a payout does not erase what was refunded.
  let totalHeld = 0;
  let totalRefunded = 0;
  let eligibleCount = 0;
  let lockedCount = 0;
  allDeposits.forEach(inv => {
    const isReturned = (inv.status === 'RETURNED');
    const isRefunded = (inv.depositStatus === 'REFUNDED');
    if (isRefunded) {
      totalRefunded += invoiceRefundAmount(inv);
    } else {
      totalHeld += Number(inv.caution) || 0;
      const review = typeof returnReviewState === 'function'
        ? returnReviewState(inv)
        : { status: 'PENDING' };
      if (isReturned && review.status === 'APPROVED') eligibleCount++;
      else lockedCount++;
    }
  });
  const paintDepositKpis = () => {
    if (!document.getElementById('kpiHeldDeposits')) return;
    document.getElementById('kpiHeldDeposits').textContent = '₦ ' + totalHeld.toLocaleString('en-NG');
    document.getElementById('kpiRefundedDeposits').textContent = '₦ ' + totalRefunded.toLocaleString('en-NG');
    document.getElementById('kpiEligiblePayouts').textContent = `${eligibleCount} Eligible`;
    document.getElementById('kpiLockedRentals').textContent = `${lockedCount} Transactions`;
  };

  if (depositInvoices.length === 0) {
    tbody.innerHTML = '';
    const empty = document.getElementById('depositsEmpty');
    const wrap = tbody.closest('.table-scroll');
    const allClosed = allDeposits.length > 0 && allDeposits.every(i => i.payoutClosed);
    if (empty) {
      const filtered = Boolean(q);
      document.getElementById('depositsEmptyTitle').textContent = filtered
        ? 'No matching deposits'
        : allClosed ? 'All payouts are closed' : 'No refundable deposits';
      document.getElementById('depositsEmptyText').textContent = filtered
        ? 'Try a different invoice number or customer name.'
        : allClosed
          ? 'Closed payouts are cleared from this list. The invoices remain in All Invoices.'
          : 'Deposits appear here once an invoice includes a caution deposit.';
      empty.hidden = false;
    }
    if (wrap) wrap.hidden = true;
    paintDepositKpis();
    return;
  }

  const depositsEmpty = document.getElementById('depositsEmpty');
  if (depositsEmpty) depositsEmpty.hidden = true;
  const depositsWrap = tbody.closest('.table-scroll');
  if (depositsWrap) depositsWrap.hidden = false;

  tbody.innerHTML = depositInvoices.map(inv => {
    const isReturned = (inv.status === 'RETURNED');
    const isRefunded = (inv.depositStatus === 'REFUNDED');
    const refundAmount = invoiceRefundAmount(inv);
    const review = typeof returnReviewState === 'function'
      ? returnReviewState(inv)
      : { status: 'PENDING', refundDue: refundAmount };
    const reviewApproved = review.status === 'APPROVED';
    const balanceDue = typeof returnBalanceDue === 'function' ? returnBalanceDue(inv) : 0;
    const savedBank = inv.refundBank && (inv.refundBank.bankName || inv.refundBank.accountNumber)
      ? [inv.refundBank.bankName, inv.refundBank.accountNumber].filter(Boolean).join(' · ')
      : '';

    let statusClass = 'pending';
    let statusLabel = 'Pending';
    if (inv.status === 'CONFIRMED') { statusClass = 'confirmed'; statusLabel = 'Confirmed (not gone out)'; }
    else if (inv.status === 'OUT_ON_HIRE') { statusClass = 'on_hire'; statusLabel = 'Out on hire'; }
    else if (inv.status === 'RETURNED') { statusClass = 'returned'; statusLabel = 'Returned'; }

    const depositBadge = isRefunded
      ? `<span style="background: #d1fae5; color: #047857; padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 11px;">REFUNDED</span>`
      : `<span style="background: #fef3c7; color: #b45309; padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 11px;">HELD</span>`;

    let payoutButton = '';
    const safeCust = escapeHtml(inv.customerName || 'Customer');
    const safeNo = escapeHtml(inv.invoiceNo);
    const canEditRefund = !isRefunded;
    const editButton = canEditRefund
      ? `<button class="btn btn-ghost btn-icon payout-edit" data-action="edit-refund-details"
        data-invoice-no="${safeNo}" data-customer-name="${safeCust}" title="Edit refund amount and bank details"
        aria-label="Edit refund amount and bank details for ${safeNo}">✏️</button>`
      : '';

    if (isRefunded) {
      payoutButton = `<div class="payout-actions">
        <span class="payout-paid">✅ Paid Out</span>
        ${editButton}
        <button class="btn btn-ghost payout-close" data-action="close-payout" data-invoice-no="${safeNo}"
          title="Close this transaction and clear it from the payout list">Close</button>
      </div>`;
    } else if (isReturned && reviewApproved) {
      const initiateLabel = refundAmount > 0 ? '💳 Initiate Payout' : '✅ Record nil refund';
      payoutButton = `<div class="payout-actions">
        <button class="btn btn-success payout-initiate" data-action="open-refund-modal" data-invoice-no="${safeNo}"
          data-customer-name="${safeCust}" data-refund-amount="${refundAmount}">${initiateLabel}</button>
        ${editButton}
      </div>`;
    } else if (isReturned) {
      payoutButton = `<div class="payout-actions">
        <button class="btn btn-ghost payout-review" data-action="review-return" data-invoice-no="${safeNo}"
          title="Review the returned-items audit before releasing the deposit">🧾 Review return</button>
        <button class="btn btn-ghost payout-locked" disabled
          title="Approve the return report to unlock this payout">🔒 Payout locked</button>
      </div>`;
    } else {
      payoutButton = `<button class="btn btn-ghost payout-locked" disabled
        title="Only when transaction status is set to RETURNED can the refundable deposit payout be enabled">🔒 Requires RETURNED Status</button>`;
    }

    const payoutSub = isRefunded
      ? `<div class="payout-sub">${refundAmount > 0
          ? `Paid: ₦ ${refundAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
          : 'No refund paid'}</div>`
      : (reviewApproved && refundAmount > 0)
        ? `<div class="payout-sub">Approved refund: ₦ ${refundAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div>`
        : '';
    const reviewBadge = isReturned && !isRefunded
      ? reviewApproved
        ? '<div class="payout-sub payout-sub-ok">✓ Review approved</div>'
        : '<div class="payout-sub payout-sub-warn">⏳ Review pending</div>'
      : '';
    const balanceFlag = balanceDue > 0
      ? `<div class="payout-sub payout-sub-due" title="Return charges exceed the deposit; this balance is still owed by the customer">⚠ Balance due: ₦ ${balanceDue.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div>`
      : '';

    return `
      <tr>
        <td><strong style="color: var(--red); font-family: 'Outfit', sans-serif;">${safeNo}</strong></td>
        <td><strong>${safeCust}</strong></td>
        <td>
          <strong style="color: var(--text);">₦ ${Number(inv.caution || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</strong>
          ${payoutSub}
          ${savedBank ? `<div class="payout-sub">${escapeHtml(savedBank)}</div>` : ''}
          ${reviewBadge}
          ${balanceFlag}
        </td>
        <td><span class="status-badge ${statusClass}">${escapeHtml(statusLabel)}</span></td>
        <td>${depositBadge}</td>
        <td style="text-align: center;">${payoutButton}</td>
      </tr>
    `;
  }).join('');

  paintDepositKpis();
}

/* ── SUPER ADMIN TRANSACTION EDITING FUNCTION ──────────────────────────── */
function editInvoiceAsSuperAdmin(invoiceNo) {
  if (currentRole !== 'super_admin' && currentRole !== 'admin') {
    showToast('Super Admin permission required to edit transactions', 'error');
    return;
  }

  const inv = MASTER_INVOICES.find(i => i.invoiceNo === invoiceNo);
  if (!inv) {
    showToast('Invoice not found', 'error');
    return;
  }

  // Block editing of returned invoices whose deposit has already been paid out.
  if (inv.status === 'RETURNED' && inv.depositStatus === 'REFUNDED') {
    showToast('This transaction has been returned and its deposit paid out — it is no longer editable', 'error');
    return;
  }

  // Edits are applied to one specific database row, keyed by id. Without an id
  // the save would have to guess a row (the old order_no lookup) — refuse instead
  // of risking another merchant's invoice.
  if (!inv.dbId) {
    showToast(
      `${inv.invoiceNo} is not linked to a database row yet. Reload the invoice list (the sync may still be pending), then edit it again.`,
      'error'
    );
    return;
  }

  closeInvoiceDetailModal();

  // Editing mode pins this form to the existing row: no new number is allocated
  // and the save becomes an update by id.
  editingInvoiceDbId = inv.dbId;
  setInvoiceFormMode('editing');
  setInvoiceNumberDisplay(inv.invoiceNo);
  document.getElementById('fCustomerName').value = inv.customerName || '';
  document.getElementById('fPhone').value = inv.phone || '';
  document.getElementById('fEmail').value = inv.email || '';
  document.getElementById('fCustomerAddress').value = inv.customerAddress || inv.address || '';
  document.getElementById('fAddress').value = inv.address || '';
  document.getElementById('fStartDate').value = inv.startDate || inv.date || new Date().toISOString().split('T')[0];
  // A record saved before hire periods were captured has no end date. Leave the
  // field empty instead of defaulting to today, so editing an old invoice can
  // never invent a due date that would then drive return alerts.
  document.getElementById('fEndDate').value = inv.endDate || '';
  document.getElementById('fCaution').value = inv.caution || '';
  document.getElementById('fTransport').value = inv.transport || '';

  const tbody = document.getElementById('itemsBody');
  tbody.innerHTML = '';
  rowId = 0;

  if (Array.isArray(inv.items) && inv.items.length > 0) {
    inv.items.forEach(item => {
      rowId++;
      const id = rowId;
      const tr = document.createElement('tr');
      tr.id = 'r' + id;
      tr.innerHTML = `
        <td data-label="Quantity"><input type="number" min="0" class="qty" value="${escapeHtml(item.qty)}" data-calc-row="${id}" placeholder="0" /></td>
        <td data-label="Item Description" style="position:relative;">
          <input type="text" class="desc" value="${escapeHtml(item.desc)}" data-search-catalog="${id}" placeholder="Search item catalog..." autocomplete="off" />
          <div class="autocomplete-results" id="ac-${id}"></div>
        </td>
        <td data-label="Daily Rate (₦)"><input type="number" min="0" step="0.01" class="price" value="${escapeHtml(item.price)}" data-calc-row="${id}" placeholder="0.00" /></td>
        <td data-label="Charge (₦)"><input type="number" class="charge" value="${escapeHtml(item.total)}" readonly placeholder="—" tabindex="-1" /></td>
        <td class="row-delete"><button class="btn btn-ghost" data-action="del-row" data-row-id="${id}" style="padding: 4px 8px; color: #ef4444;">✕</button></td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    addRow(); addRow(); addRow();
  }

  recalc();
  setFormReadOnly(false);
  switchTab('invoicing');

  showToast(`Editing transaction ${inv.invoiceNo} — make your changes and click Save & Fulfill Invoice`, 'success');
}

/* ── SAVE & FULFILL INVOICE ─────────────────────────────────────────────── */
// New invoices are inserted with a server-allocated number. Edits are updates
// keyed on the database id, so a number can never be used to find (and then
// overwrite) a different invoice.
async function saveInvoice(status = 'CONFIRMED') {
  const invoiceNo = (document.getElementById('fOrderNo')?.value || '').trim();
  const customerName = (document.getElementById('fCustomerName')?.value || '').trim();
  const phone = (document.getElementById('fPhone')?.value || '').trim();
  const email = (document.getElementById('fEmail')?.value || '').trim();
  const customerAddress = (document.getElementById('fCustomerAddress')?.value || '').trim();
  const address = (document.getElementById('fAddress')?.value || '').trim();
  const startDate = document.getElementById('fStartDate')?.value;
  const caution = parseFloat(document.getElementById('fCaution')?.value) || 0;
  const transport = parseFloat(document.getElementById('fTransport')?.value) || 0;

  // Which record are we writing? Either the row this form was opened to edit
  // (pinned by database id) or a brand-new invoice. The number is display-only
  // and is never used to decide which row to write.
  const editingInv = editingInvoiceDbId
    ? MASTER_INVOICES.find(i => i.dbId === editingInvoiceDbId) || null
    : null;
  const isEdit = Boolean(editingInv);

  if (editingInvoiceDbId && !editingInv) {
    // The row being edited vanished from the list (deleted, or the list was
    // reloaded). Saving here would insert a second invoice under the same number.
    showToast(
      `The transaction you were editing (${invoiceNo}) is no longer in the invoice list. ` +
      'Reload the page and edit it again — nothing was saved.',
      'error'
    );
    return;
  }

  if (typeof validateInvoiceForm === 'function' && !validateInvoiceForm()) {
    showToast('Please fix the highlighted fields before saving.', 'error');
    return;
  }

  const items = [];
  let subtotal = 0;
  const rentalDays = getRentalDays(startDate, document.getElementById('fEndDate')?.value);
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    const qty = parseFloat(row.querySelector('.qty').value) || 0;
    const desc = row.querySelector('.desc').value.trim();
    const price = parseFloat(row.querySelector('.price').value) || 0;
    const total = qty * price * rentalDays;
    if (qty > 0 && desc) {
      items.push({ qty, desc, price, total });
      subtotal += total;
    }
  });

  if (items.length === 0) {
    showToast('Please add at least one rental item', 'error');
    return;
  }

  const vat = subtotal * 0.075;
  const grandTotal = subtotal + vat + caution + transport;

  // Normalize the status passed from the "Save & Fulfill" action into a valid lifecycle state
  const VALID_STATUSES = ['CONFIRMED', 'OUT_ON_HIRE', 'RETURNED', 'PENDING'];
  const finalStatus = VALID_STATUSES.includes(status) ? status : 'CONFIRMED';

  const saveBtn = document.getElementById('btnSaveInvoice');
  const stickyBtn = document.getElementById('btnStickySave');
  const restoreButton = () => {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<span>💾</span> Save &amp; Fulfill Invoice';
    }
    if (stickyBtn) stickyBtn.disabled = false;
    updateInvoiceSaveAvailability();
  };
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span>⏳</span> Saving & Syncing...';
  }
  if (stickyBtn) stickyBtn.disabled = true;

  try {
    // 1. Claim the invoice number now. This is the only place a number is taken,
    // so a number exists only for an invoice that is actually being saved.
    let invoiceNoForSave = invoiceNo;
    if (!isEdit) {
      invoiceNoForSave = await allocateInvoiceNo();
      if (!invoiceNoForSave) throw new Error('The server did not return an invoice number.');
    }

    // 2. Sync & persist customer details to DB customer table, keeping the id
    //    so the order is linked to the right customer.
    const customerId = await saveCustomerToDb({
      name: customerName,
      telephone: phone,
      email: email,
      address: customerAddress,
      notes: `Customer created from Invoice ${invoiceNoForSave}`
    });

    const newInvoiceObj = {
      invoiceNo: invoiceNoForSave,
      // Preserved on insert; ignored on update (the row keeps its own values).
      dbId: isEdit ? editingInv.dbId : undefined,
      updatedAt: isEdit ? editingInv.updatedAt : undefined,
      isNew: !isEdit,
      customerId: customerId || (isEdit ? editingInv.customerId : undefined),
      date: startDate || new Date().toISOString().split('T')[0],
      customerName,
      phone: phone || 'N/A',
      email: email || 'N/A',
      customerAddress: customerAddress || '',
      address: address || 'Store Pickup / Local Delivery',
      totalCost: grandTotal,
      subtotal,
      vat,
      caution,
      transport,
      rentalDays,
      startDate: startDate || new Date().toISOString().split('T')[0],
      endDate: document.getElementById('fEndDate')?.value || '',
      status: isEdit ? editingInv.status : finalStatus,
      depositStatus: isEdit ? editingInv.depositStatus : (caution > 0 ? 'HELD' : 'N/A'),
      isLegacy: false,
      items
    };

    if (isEdit) {
      // Editing must not discard the returned-items audit, its review, or the
      // payout/refund trail recorded against this transaction.
      [
        'returnReport', 'returnedAt', 'returnReview', 'refundAmount', 'refundBank',
        'refundedAt', 'refundedBy', 'payoutAdjustment', 'payoutDetailsUpdatedAt',
        'payoutClosed', 'payoutClosedAt', 'payoutClosedBy', 'reviewRevocations'
      ].forEach(key => {
        if (editingInv[key] !== undefined) newInvoiceObj[key] = editingInv[key];
      });
    }

    // 3. Persist to Supabase FIRST. Local state only reflects a confirmed write.
    const res = await syncInvoiceToSupabase(newInvoiceObj);
    if (res && res.error) {
      console.warn('Supabase order write failed:', res.error);
      if (res.conflict) {
        showToast(res.error.message, 'error');
        // Re-pull the authoritative version so the user can retry on fresh data.
        await fetchInvoicesFromSupabase();
        renderAllInvoicesTable(MASTER_INVOICES);
        return;
      }
      showToast(`Not saved: ${res.error.message || 'Database write failed'}`, 'error');
      return;
    }

    const savedNo = newInvoiceObj.invoiceNo;
    // The header number is only a projection, so it can differ from the number the
    // server actually handed out (another device saved first, or the projection was
    // stale). Say so instead of silently showing a different number.
    const normalizedInputNo = invoiceNo.replace(/^#?INV-/i, '');
    const renamed = !isEdit && savedNo.replace(/^#?INV-/i, '') !== normalizedInputNo;

    // 4. Commit to local state only after the database accepted the write.
    const replaceIdx = isEdit
      ? MASTER_INVOICES.findIndex(i => i.dbId === newInvoiceObj.dbId)
      : -1;
    if (replaceIdx !== -1) {
      MASTER_INVOICES[replaceIdx] = { ...MASTER_INVOICES[replaceIdx], ...newInvoiceObj, isNew: false };
    } else {
      MASTER_INVOICES.unshift({ ...newInvoiceObj, isNew: false });
    }
    persistMasterInvoices();

    // Keep an audit-ready snapshot of every saved document for the print archive.
    if (typeof archiveInvoiceSnapshot === 'function') archiveInvoiceSnapshot(newInvoiceObj);

    if (typeof logAuditAction === 'function') {
      logAuditAction(savedNo, isEdit ? 'ORDER_UPDATED' : 'ORDER_CREATED', {
        grandTotal,
        customerName,
        itemsCount: items.length,
        dbId: newInvoiceObj.dbId,
        ...(renamed ? { renumberedFrom: invoiceNo } : {})
      });
    }

    if (renamed) {
      showToast(
        `Saved as ${savedNo} — another save took ${invoiceNo || 'the number on screen'} first, ` +
        'so this invoice was given the next free number. No existing invoice was changed.',
        'success'
      );
    } else {
      showToast(`Invoice ${savedNo} saved & synced successfully!`, 'success');
    }

    renderAllInvoicesTable(MASTER_INVOICES);
    renderDepositsTable();
    renderLegacyLogsTable();
    updateDashboardMetrics();
    createNewTransaction();
  } catch (err) {
    console.error('Error in saveInvoice:', err);
    showToast(`Error saving invoice: ${err.message}`, 'error');
  } finally {
    restoreButton();
  }
}

/* ── CLICKABLE CONFIRMATION INVOICE DETAIL MODAL ───────────────────────── */
function openInvoiceDetailModal(invoiceNo) {
  const inv = MASTER_INVOICES.find(i => i.invoiceNo === invoiceNo);
  if (!inv) return;

  activeSelectedInvoice = inv;
  document.getElementById('modalInvoiceNo').textContent = `INVOICE ${inv.invoiceNo}`;
  
  const typeBadgeEl = document.getElementById('modalInvoiceTypeBadge');
  if (typeBadgeEl) {
    typeBadgeEl.innerHTML = inv.isLegacy
      ? `<span class="badge-legacy">📜 HISTORICAL LEGACY RECORD</span>`
      : `<span class="badge-new">⚡ LIVE SYSTEM INVOICE</span>`;
  }

  document.getElementById('modalInvoiceDate').textContent = `Issued: ${inv.date}`;
  document.getElementById('modalCustomerName').textContent = inv.customerName;
  document.getElementById('modalCustomerContact').textContent = `${inv.phone} · ${inv.email}`;
  document.getElementById('modalCustomerAddress').textContent = inv.customerAddress || inv.address;
  const modalDelivery = document.getElementById('modalDeliveryAddress');
  if (modalDelivery) modalDelivery.textContent = inv.address || '—';
  document.getElementById('modalInvoiceStatusSelect').value = inv.status;

  const isSuperAdmin = (currentRole === 'super_admin' || currentRole === 'admin');
  const editInvoiceBtn = document.getElementById('invoiceDetailModal')?.querySelector('[data-action="edit-invoice"]');
  if (editInvoiceBtn) editInvoiceBtn.style.display = isSuperAdmin ? 'inline-flex' : 'none';

  const itemsBody = document.getElementById('modalInvoiceItemsBody');
  const rentalDays = inv.rentalDays || getRentalDays(inv.startDate || inv.date, inv.endDate) || 1;
  itemsBody.innerHTML = (inv.items || []).map(item => `
    <tr>
      <td><strong>${escapeHtml(item.qty)}</strong></td>
      <td>${escapeHtml(item.desc)}</td>
      <td>₦ ${Number(item.price || 0).toLocaleString()}</td>
      <td><strong>₦ ${Number((Number(item.qty) || 0) * (Number(item.price) || 0) * rentalDays || 0).toLocaleString()}</strong></td>
    </tr>
  `).join('');

  const vat = inv.vat !== undefined ? inv.vat : (inv.subtotal * 0.075);
  document.getElementById('modalSubtotal').textContent = '₦ ' + Number(inv.subtotal || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
  document.getElementById('modalVat').textContent = '₦ ' + Number(vat || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
  document.getElementById('modalCaution').textContent = '₦ ' + Number(inv.caution || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
  document.getElementById('modalTransport').textContent = '₦ ' + Number(inv.transport || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });
  document.getElementById('modalGrandTotal').textContent = '₦ ' + Number(inv.totalCost || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });

  document.getElementById('invoiceDetailModal').style.display = 'flex';
  if (typeof syncReturnReportAction === 'function') syncReturnReportAction(inv);
}

function closeInvoiceDetailModal() {
  document.getElementById('invoiceDetailModal').style.display = 'none';
}

async function updateInvoiceStatusFromModal(newStatus) {
  if (!activeSelectedInvoice) return;

  // Block status changes from RETURNED when deposit has already been paid out.
  if (activeSelectedInvoice.status === 'RETURNED' && activeSelectedInvoice.depositStatus === 'REFUNDED') {
    showToast('This transaction has been returned and its deposit paid out — the status cannot be changed', 'error');
    return;
  }

  activeSelectedInvoice.status = newStatus;
  if (newStatus === 'RETURNED' && !activeSelectedInvoice.returnedAt) {
    activeSelectedInvoice.returnedAt = new Date().toISOString();
  }
  // Leaving RETURNED invalidates the review: the payout gate must be
  // re-established for the new return.
  if (newStatus !== 'RETURNED') {
    delete activeSelectedInvoice.returnReview;
    if (activeSelectedInvoice.depositStatus !== 'REFUNDED') delete activeSelectedInvoice.refundAmount;
  }
  persistMasterInvoices();
  renderAllInvoicesTable(MASTER_INVOICES);
  renderDepositsTable();
  if (typeof syncReturnReportAction === 'function') syncReturnReportAction(activeSelectedInvoice);
  showToast(`Updated ${activeSelectedInvoice.invoiceNo} status to ${newStatus}`, 'success');

  try {
    if (typeof syncInvoiceToSupabase === 'function') {
      await syncInvoiceToSupabase(activeSelectedInvoice);
    } else {
      const cleanNo = activeSelectedInvoice.invoiceNo.replace('#INV-', '').replace('#', '');
      await db.from('orders').update({ status: newStatus }).eq('order_no', cleanNo);
    }
    if (typeof logAuditAction === 'function') {
      logAuditAction(activeSelectedInvoice.invoiceNo, 'STATUS_CHANGE', { newStatus });
    }
  } catch (e) {
    console.warn('Status update sync note:', e);
  }
}

/* ── RENTAL DURATION CALCULATOR ─────────────────────────────────────────── */
function getRentalDays(startDate, endDate) {
  if (!startDate || !endDate) return 1;
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const days = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
  return days > 0 ? days : 1;
}

/* ── ITEM ROW MANAGEMENT & AUTOCOMPLETE ────────────────────────────────── */
function addRow() {
  rowId++;
  const id = rowId;
  const tr = document.createElement('tr');
  tr.id = 'r' + id;
  tr.innerHTML = `
    <td data-label="Quantity"><input type="number" min="0" class="qty" data-calc-row="${id}" placeholder="0" /></td>
    <td data-label="Item Description" style="position:relative;">
      <input type="text" class="desc" data-search-catalog="${id}" placeholder="Search item catalog..." autocomplete="off" />
      <div class="autocomplete-results" id="ac-${id}"></div>
    </td>
    <td data-label="Daily Rate (₦)"><input type="number" min="0" step="0.01" class="price" data-calc-row="${id}" placeholder="0.00" /></td>
    <td data-label="Charge (₦)"><input type="number" class="charge" readonly placeholder="—" tabindex="-1" /></td>
    <td class="row-delete"><button class="btn btn-ghost" data-action="del-row" data-row-id="${id}" style="padding: 4px 8px; color: #ef4444;">✕</button></td>
  `;
  document.getElementById('itemsBody').appendChild(tr);
}

function delRow(id) {
  const row = document.getElementById('r' + id);
  if (row) { row.remove(); recalc(); }
}

function searchCatalog(inputEl, id) {
  const val = inputEl.value.toLowerCase().trim();
  const res = document.getElementById(`ac-${id}`);
  if (!val) { res.style.display = 'none'; return; }

  const matches = INVENTORY_CATALOG.filter(i => i.desc.toLowerCase().includes(val));
  if (!matches.length) { res.style.display = 'none'; return; }

  res.innerHTML = matches.map(m => `
    <div class="autocomplete-item" data-action="select-catalog" data-catalog-id="${id}" data-catalog-desc="${escapeHtml(m.desc)}" data-catalog-price="${m.price}">
      <div class="name">${escapeHtml(m.desc)}</div>
      <div class="sub">₦ ${m.price.toLocaleString()} / day</div>
    </div>
  `).join('');
  res.style.display = 'block';
}

function selectCatalogItem(id, desc, price) {
  const row = document.getElementById('r' + id);
  if (!row) return;
  row.querySelector('.desc').value = desc;
  row.querySelector('.price').value = price;
  document.getElementById(`ac-${id}`).style.display = 'none';
  calcRow(id);
}

function calcRow(id) {
  const row = document.getElementById('r' + id);
  if (!row) return;
  const qty = parseFloat(row.querySelector('.qty').value) || 0;
  const price = parseFloat(row.querySelector('.price').value) || 0;
  const days = getRentalDays(document.getElementById('fStartDate')?.value, document.getElementById('fEndDate')?.value);
  const charge = qty * price * days;
  row.querySelector('.charge').value = charge > 0 ? charge.toFixed(2) : '';
  recalc();
}

function recalc() {
  const days = getRentalDays(document.getElementById('fStartDate')?.value, document.getElementById('fEndDate')?.value);
  let rental = 0;
  document.querySelectorAll('#itemsBody tr').forEach(row => {
    const qty = parseFloat(row.querySelector('.qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.price')?.value) || 0;
    rental += qty * price * days;
  });
  const vat = rental * 0.075;
  const caution = parseFloat(document.getElementById('fCaution')?.value) || 0;
  const transport = parseFloat(document.getElementById('fTransport')?.value) || 0;
  const grand = rental + vat + caution + transport;

  if (document.getElementById('sRental')) document.getElementById('sRental').textContent = '₦ ' + fmt(rental);
  if (document.getElementById('sVat')) document.getElementById('sVat').textContent = '₦ ' + fmt(vat);
  if (document.getElementById('sCaution')) document.getElementById('sCaution').textContent = '₦ ' + fmt(caution);
  if (document.getElementById('sTransport')) document.getElementById('sTransport').textContent = '₦ ' + fmt(transport);
  if (document.getElementById('sTotal')) document.getElementById('sTotal').textContent = '₦ ' + fmt(grand);
  if (document.getElementById('sWords')) document.getElementById('sWords').textContent = numWords(Math.round(grand)) + ' Naira only';

  // Mirror the figures into the sticky total bar
  const mirror = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '₦ ' + fmt(value);
  };
  mirror('stRental', rental);
  mirror('stVat', vat);
  mirror('stCaution', caution);
  mirror('stTransport', transport);
  mirror('stTotal', grand);

  updateInvoiceOrderMeta(days);
}

/* Order chip beside the title: #INV-0005 · 3 days · 2 items */
function updateInvoiceOrderMeta(days) {
  const meta = document.getElementById('invOrderMeta');
  if (!meta) return;

  const filled = [...document.querySelectorAll('#itemsBody .desc')].filter(input => input.value.trim()).length;
  // Collected before the chip is rebuilt: the meta element is the insertion point,
  // so its own text (invoice label + number) is excluded from the chip
  const chips = [
    `${days} ${days === 1 ? 'day' : 'days'}`,
    filled ? `${filled} ${filled === 1 ? 'item' : 'items'}` : ''
  ].filter(Boolean);
  const span = document.createElement('span');
  span.className = 'order-meta-extra';
  span.textContent = chips.join(' · ');
  meta.querySelectorAll('.order-meta-extra').forEach(el => el.remove());
  meta.appendChild(span);
}

/* ── STICKY TOTAL BAR ─────────────────────────────────────────────────── */
function updateStickyTotalVisibility() {
  const bar = document.getElementById('stickyTotal');
  if (!bar) return;

  const invoicingActive = document.getElementById('tab-invoicing')?.classList.contains('active');
  const totalRow = document.querySelector('#tab-invoicing .summary-row.total');
  let totalVisible = false;

  if (totalRow) {
    const rect = totalRow.getBoundingClientRect();
    // While the bar is up it covers the bottom of the viewport, so treat that
    // strip as off-screen too — otherwise the bar can never retire.
    const covered = bar.classList.contains('visible') ? bar.offsetHeight : 0;
    // Only hide the bar once the real total is fully on screen
    totalVisible = rect.top >= 0 && rect.bottom <= window.innerHeight - covered;
  }

  const show = Boolean(invoicingActive && totalRow && !totalVisible);
  bar.classList.toggle('visible', show);
  bar.setAttribute('aria-hidden', show ? 'false' : 'true');
  document.body.classList.toggle('sticky-total-open', show);
}

function initStickyTotal() {
  if (!document.querySelector('#tab-invoicing .summary-box')) return;
  window.addEventListener('scroll', updateStickyTotalVisibility, { passive: true });
  window.addEventListener('resize', updateStickyTotalVisibility);
  updateStickyTotalVisibility();
}

/* ── READ ONLY LOCK & SUPER ADMIN ENFORCEMENT ────────────────────────── */
function setFormReadOnly(isReadOnly) {
  const inputs = document.querySelectorAll('#tab-invoicing input');
  inputs.forEach(i => i.readOnly = isReadOnly);
  const banner = document.getElementById('readOnlyBanner');
  if (banner) banner.style.display = isReadOnly ? 'flex' : 'none';
  const saveBtn = document.getElementById('btnSaveInvoice');
  if (saveBtn) saveBtn.style.display = isReadOnly ? 'none' : 'inline-flex';
  const stickySaveBtn = document.getElementById('btnStickySave');
  if (stickySaveBtn) stickySaveBtn.style.display = isReadOnly ? 'none' : 'inline-flex';
}

function enableSuperAdminEdit() {
  if (currentRole !== 'super_admin' && currentRole !== 'admin') {
    showToast('Super Admin access required', 'error');
    return;
  }
  setFormReadOnly(false);
  showToast('Super Admin editing enabled');
}

/* ── REFUNDABLE DEPOSITS PAYOUT (SUPER ADMIN ONLY) ────────────────────── */
let refundModalMode = 'payout';

function approvedRefundDue(inv) {
  if (!inv || typeof returnReviewState !== 'function') return null;
  const review = returnReviewState(inv);
  return review.status === 'APPROVED' ? Number(review.refundDue) || 0 : null;
}

function syncRefundAdjustField() {
  const inv = activeSelectedInvoice;
  const wrap = document.getElementById('refundAdjustWrap');
  const hint = document.getElementById('refundApprovedHint');
  const amountInput = document.getElementById('modalRefundAmount');
  const reason = document.getElementById('modalAdjustReason');
  const approved = inv ? approvedRefundDue(inv) : null;
  const isEdit = refundModalMode === 'edit';

  if (hint) {
    hint.textContent = (approved !== null && !isEdit)
      ? `Approved by return review: ₦ ${approved.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
      : '';
  }
  if (!wrap) return;

  if (isEdit || approved === null) {
    wrap.hidden = true;
    if (reason) reason.value = '';
    return;
  }

  const amount = Number(amountInput?.value);
  const differs = Number.isFinite(amount) && Math.abs(amount - approved) > 0.005;
  wrap.hidden = !differs;
  if (!differs && reason) reason.value = '';
}

function applyRefundModalMode() {
  const editing = refundModalMode === 'edit';
  const title = document.getElementById('refundModalTitle');
  const intro = document.getElementById('refundModalIntro');
  const primary = document.getElementById('refundPrimaryBtn');

  if (title) title.textContent = editing ? '✏️ Edit Refund Details' : '💳 Refundable Deposit Payout';
  if (intro) {
    intro.innerHTML = editing
      ? 'Update the refund amount and bank details for this transaction. Accessible by <strong class="text-red">Super Admin</strong> only.'
      : 'Release the deposit after the return audit has been reviewed. Accessible by <strong class="text-red">Super Admin</strong> only.';
  }
  if (primary) {
    primary.dataset.action = editing ? 'save-refund-details' : 'payout';
    primary.textContent = editing ? '💾 Save details' : 'Record payout';
  }
  syncRefundAdjustField();
}

function openRefundModal(invoiceNo, customerName, amount, mode) {
  if (currentRole !== 'super_admin' && currentRole !== 'admin') {
    showToast('Only Super Admin can initiate refundable deposit payouts', 'error');
    return;
  }
  const inv = MASTER_INVOICES.find(i => i.invoiceNo === invoiceNo);
  if (!inv) {
    showToast('That transaction could not be found', 'error');
    return;
  }

  // A payout may only be initiated from an approved return review.
  const review = typeof returnReviewState === 'function'
    ? returnReviewState(inv)
    : { status: 'PENDING' };
  if (inv.depositStatus !== 'REFUNDED' && review.status !== 'APPROVED') {
    showToast('Review and approve the return report before initiating a payout', 'error');
    if (review.status === 'PENDING' && typeof openReturnReview === 'function') {
      if (typeof openServiceReport === 'function') openServiceReport(inv.invoiceNo);
      openReturnReview(inv.invoiceNo);
    }
    return;
  }

  activeSelectedInvoice = inv;
  refundModalMode = (inv.depositStatus === 'REFUNDED' || mode === 'edit') ? 'edit' : 'payout';

  document.getElementById('modalCustomerInfo').value = `${invoiceNo} - ${customerName || inv.customerName || 'Customer'}`;
  document.getElementById('modalRefundAmount').value = invoiceRefundAmount(inv) || Number(amount) || 0;
  const adjustReason = document.getElementById('modalAdjustReason');
  if (adjustReason) adjustReason.value = '';

  const bankSelect = document.getElementById('modalBankName');
  const savedBank = (inv.refundBank && inv.refundBank.bankName) || '';
  if (bankSelect) {
    if (savedBank && ![...bankSelect.options].some(opt => opt.value === savedBank)) {
      bankSelect.add(new Option(savedBank, savedBank));
    }
    bankSelect.value = savedBank || bankSelect.options[0]?.value || 'Access Bank';
  }
  document.getElementById('modalAccountNumber').value =
    (inv.refundBank && inv.refundBank.accountNumber) || '';

  applyRefundModalMode();
  document.getElementById('refundModal').style.display = 'flex';
  document.getElementById('modalRefundAmount')?.focus();
}

function closeRefundModal() {
  document.getElementById('refundModal').style.display = 'none';
}

/* Read and validate the editable payout details. */
function readRefundForm() {
  const amount = Number(document.getElementById('modalRefundAmount')?.value);
  const bankName = (document.getElementById('modalBankName')?.value || '').trim();
  const accountNumber = (document.getElementById('modalAccountNumber')?.value || '').replace(/\D+/g, '');
  const approved = activeSelectedInvoice ? approvedRefundDue(activeSelectedInvoice) : null;
  const alreadyPaid = activeSelectedInvoice && activeSelectedInvoice.depositStatus === 'REFUNDED';
  // A nil refund is valid when the review says nothing is due, when correcting
  // an existing payout, or when a payout is explicitly adjusted to zero.
  const allowZero = alreadyPaid || approved === 0 || (refundModalMode === 'payout' && approved !== null);

  if (!Number.isFinite(amount) || amount < 0 || (amount <= 0 && !allowZero)) {
    showToast(allowZero ? 'Enter zero or a valid refund amount' : 'Enter a refund amount greater than zero', 'error');
    return null;
  }
  if (!bankName) {
    showToast('Select the customer’s bank', 'error');
    return null;
  }
  if (accountNumber.length !== 10) {
    showToast('Enter the 10-digit account number', 'error');
    return null;
  }
  return { amount, bankName, accountNumber };
}

function saveRefundDetails() {
  if (currentRole !== 'super_admin' && currentRole !== 'admin') {
    showToast('Only Super Admin can edit payout details', 'error');
    return;
  }
  if (!activeSelectedInvoice) {
    showToast('Open a transaction before editing payout details', 'error');
    return;
  }
  const review = typeof returnReviewState === 'function'
    ? returnReviewState(activeSelectedInvoice)
    : { status: 'PENDING' };
  if (activeSelectedInvoice.depositStatus !== 'REFUNDED' && review.status !== 'APPROVED') {
    showToast('Approve the return report before editing payout details', 'error');
    return;
  }
  const details = readRefundForm();
  if (!details) return;

  const previousAmount = Number(activeSelectedInvoice.refundAmount) || 0;
  activeSelectedInvoice.refundAmount = details.amount;
  activeSelectedInvoice.refundBank = {
    bankName: details.bankName,
    accountNumber: details.accountNumber
  };
  activeSelectedInvoice.payoutDetailsUpdatedAt = new Date().toISOString();

  // Keep the payout trail and the paid amount in sync after a post-payout edit.
  if (activeSelectedInvoice.depositStatus === 'REFUNDED' && previousAmount !== details.amount) {
    const at = activeSelectedInvoice.payoutDetailsUpdatedAt;
    const by = currentUser?.email || currentRole;
    activeSelectedInvoice.payoutEditHistory = [
      ...(Array.isArray(activeSelectedInvoice.payoutEditHistory) ? activeSelectedInvoice.payoutEditHistory : []),
      { at, by, from: previousAmount, to: details.amount }
    ];

    const approved = Number(activeSelectedInvoice.returnReview?.refundDue);
    const adjustment = activeSelectedInvoice.payoutAdjustment;

    if (adjustment && Number.isFinite(approved) && Math.abs(approved - details.amount) <= 0.005) {
      // The correction brings the payout back to the approved figure.
      delete activeSelectedInvoice.payoutAdjustment;
    } else if (adjustment) {
      activeSelectedInvoice.payoutAdjustment = {
        ...adjustment,
        paidAmount: details.amount,
        updatedAt: at,
        updatedBy: by
      };
    } else if (Number.isFinite(approved) && Math.abs(approved - details.amount) > 0.005) {
      activeSelectedInvoice.payoutAdjustment = {
        approvedAmount: approved,
        paidAmount: details.amount,
        reason: 'Paid amount corrected after payout',
        at,
        by
      };
    }
  }

  persistMasterInvoices();
  renderDepositsTable();
  renderAllInvoicesTable(MASTER_INVOICES);
  if (typeof renderServiceReport === 'function') renderServiceReport();
  if (typeof syncInvoiceToSupabase === 'function') syncInvoiceToSupabase(activeSelectedInvoice);
  showToast(`Payout details saved for ${activeSelectedInvoice.invoiceNo}`, 'success');
  closeRefundModal();
}

async function processPayout() {
  if (!activeSelectedInvoice) return;

  if (activeSelectedInvoice.depositStatus === 'REFUNDED') {
    showToast('This deposit has already been refunded', 'error');
    return;
  }

  // A refundable deposit may only be paid out once items are RETURNED
  if (activeSelectedInvoice.status !== 'RETURNED') {
    showToast('Payouts are only permitted once rental items are RETURNED.', 'error');
    return;
  }

  // ...and once the returned-items audit has been reviewed and approved.
  const review = typeof returnReviewState === 'function'
    ? returnReviewState(activeSelectedInvoice)
    : { status: 'PENDING' };
  if (review.status !== 'APPROVED') {
    showToast('Approve the return report before releasing the deposit', 'error');
    return;
  }

  const details = readRefundForm();
  if (!details) return;

  const approved = approvedRefundDue(activeSelectedInvoice);
  const reasonField = document.getElementById('modalAdjustReason');
  const reason = (reasonField?.value || '').trim();
  const differs = approved !== null && Math.abs(details.amount - approved) > 0.005;

  if (differs && !reason) {
    showToast('Add a reason for paying a different amount', 'error');
    reasonField?.focus();
    return;
  }

  activeSelectedInvoice.refundAmount = details.amount;
  activeSelectedInvoice.refundBank = {
    bankName: details.bankName,
    accountNumber: details.accountNumber
  };
  if (differs) {
    activeSelectedInvoice.payoutAdjustment = {
      approvedAmount: approved,
      paidAmount: details.amount,
      reason,
      at: new Date().toISOString(),
      by: currentUser?.email || currentRole
    };
  } else {
    delete activeSelectedInvoice.payoutAdjustment;
  }
  activeSelectedInvoice.depositStatus = 'REFUNDED';
  activeSelectedInvoice.refundedAt = new Date().toISOString();
  activeSelectedInvoice.refundedBy = currentUser?.email || currentRole;

  persistMasterInvoices();
  renderDepositsTable();
  renderAllInvoicesTable(MASTER_INVOICES);
  if (typeof renderServiceReport === 'function') renderServiceReport();

  // Sync status and payout trail with Supabase
  try {
    if (typeof syncInvoiceToSupabase === 'function') {
      await syncInvoiceToSupabase(activeSelectedInvoice);
    } else {
      const cleanNo = activeSelectedInvoice.invoiceNo.replace('#INV-', '').replace('#', '');
      await db.from('orders').update({ deposit_status: 'REFUNDED' }).eq('order_no', cleanNo);
    }
    if (typeof logAuditAction === 'function') {
      logAuditAction(activeSelectedInvoice.invoiceNo, 'PAYOUT_RECORDED', {
        amount: details.amount,
        bank: details.bankName,
        adjustment: activeSelectedInvoice.payoutAdjustment || null
      });
    }
  } catch (e) {
    console.warn('Payout sync note:', e);
  }

  showToast(
    details.amount > 0
      ? `Deposit payout of ₦ ${details.amount.toLocaleString('en-NG')} recorded and synced successfully!`
      : `Nil refund recorded for ${activeSelectedInvoice.invoiceNo}`,
    'success'
  );
  closeRefundModal();
}

/* A completed payout can be closed, which clears it from the payouts list. */
async function closePayoutTransaction(invoiceNo) {
  if (currentRole !== 'super_admin' && currentRole !== 'admin') {
    showToast('Only Super Admin can close a payout', 'error');
    return;
  }
  const inv = MASTER_INVOICES.find(i => i.invoiceNo === invoiceNo);
  if (!inv) {
    showToast('That transaction could not be found', 'error');
    return;
  }
  if (inv.depositStatus !== 'REFUNDED') {
    showToast('Only a completed payout can be closed', 'error');
    return;
  }

  const balanceDue = typeof returnBalanceDue === 'function' ? returnBalanceDue(inv) : 0;
  inv.payoutClosed = true;
  inv.payoutClosedAt = new Date().toISOString();
  inv.payoutClosedBy = currentUser?.email || currentRole;
  persistMasterInvoices();
  renderDepositsTable();

  try {
    if (typeof syncInvoiceToSupabase === 'function') {
      await syncInvoiceToSupabase(inv);
    }
    if (typeof logAuditAction === 'function') {
      logAuditAction(inv.invoiceNo, 'PAYOUT_CLOSED', { balanceDue });
    }
  } catch (e) {
    console.warn('Close payout sync note:', e);
  }
  if (balanceDue > 0) {
    showToast(
      `Transaction ${inv.invoiceNo} closed — ₦ ${balanceDue.toLocaleString('en-NG', { minimumFractionDigits: 2 })} balance remains flagged in All Invoices`,
      'error'
    );
  } else {
    showToast(`Transaction ${inv.invoiceNo} closed and cleared from the payout list`, 'success');
  }
}

/* Keep the payout adjustment reason in sync with the entered amount. */
document.getElementById('modalRefundAmount')?.addEventListener('input', syncRefundAdjustField);
document.getElementById('modalAccountNumber')?.addEventListener('input', (event) => {
  event.target.value = event.target.value.replace(/\D+/g, '').slice(0, 10);
});
