/* ==============================================================================
   Kitchenware Rentals Ltd — ERP & Order Management System
   MODULE: LEGACY — data entry, ingestion, logs
   ============================================================================== */
function getNextSerialLegacyNo() {
  let maxSeq = 0;
  MASTER_INVOICES.forEach(inv => {
    if (inv.isLegacy || (inv.invoiceNo && inv.invoiceNo.includes('LEG-'))) {
      const match = inv.invoiceNo.match(/\d+/);
      if (match) {
        const num = parseInt(match[0], 10);
        if (num > maxSeq) maxSeq = num;
      }
    }
  });
  const nextNum = maxSeq + 1;
  return `#LEG-${nextNum.toString().padStart(4, '0')}`;
}

function createNewLegacyEntry() {
  clearLegacyForm();
  const nextNo = getNextSerialLegacyNo();
  const badge = document.getElementById('legBadgeNo');
  const hidden = document.getElementById('legRefNo');
  if (badge) badge.textContent = nextNo;
  if (hidden) hidden.value = nextNo;
}

function handleClearLegacy() {
  createNewLegacyEntry();
  showToast('All legacy data entry fields cleared');
}

function clearLegacyForm() {
  if (document.getElementById('legCustomerName')) document.getElementById('legCustomerName').value = '';
  if (document.getElementById('legPhone')) document.getElementById('legPhone').value = '';
  if (document.getElementById('legEmail')) document.getElementById('legEmail').value = '';
  if (document.getElementById('legAddress')) document.getElementById('legAddress').value = '';
  if (document.getElementById('legCaution')) document.getElementById('legCaution').value = '';
  if (document.getElementById('legTransport')) document.getElementById('legTransport').value = '';

  const legRes = document.getElementById('legCustomerResults');
  if (legRes) {
    legRes.innerHTML = '';
    legRes.style.display = 'none';
  }

  const today = new Date().toISOString().split('T')[0];
  if (document.getElementById('legDate')) document.getElementById('legDate').value = today;
  if (document.getElementById('legEndDate')) document.getElementById('legEndDate').value = today;

  clearLegacyFile();

  const tbody = document.getElementById('legItemsBody');
  if (tbody) {
    tbody.innerHTML = '';
    legacyRowId = 0;
    addLegacyRow(); addLegacyRow(); addLegacyRow();
  }
  recalcLegacy();
}

function addLegacyRow(item = null) {
  legacyRowId++;
  const id = legacyRowId;
  const tr = document.createElement('tr');
  tr.id = 'leg-r' + id;
  tr.innerHTML = `
    <td data-label="Quantity"><input type="number" min="0" class="leg-qty" value="${escapeHtml(item ? item.qty : '')}" data-calc-legacy-row="${id}" placeholder="0" /></td>
    <td data-label="Item Description" style="position:relative;">
      <input type="text" class="leg-desc" value="${escapeHtml(item ? item.desc : '')}" data-search-legacy-catalog="${id}" placeholder="Search inventory catalog..." autocomplete="off" />
      <div class="autocomplete-results" id="leg-ac-${id}"></div>
    </td>
    <td data-label="Daily Rate (₦)"><input type="number" min="0" step="0.01" class="leg-price" value="${escapeHtml(item ? item.price : '')}" data-calc-legacy-row="${id}" placeholder="0.00" /></td>
    <td data-label="Total (₦)"><input type="number" class="leg-charge" value="${escapeHtml(item ? item.total : '')}" readonly placeholder="—" tabindex="-1" /></td>
    <td class="row-delete"><button class="btn btn-ghost" data-action="del-legacy-row" data-legacy-row-id="${id}" style="padding: 4px 8px; color: #ef4444;">✕</button></td>
  `;
  const tbody = document.getElementById('legItemsBody');
  if (tbody) tbody.appendChild(tr);
}

function delLegacyRow(id) {
  const row = document.getElementById('leg-r' + id);
  if (row) {
    row.remove();
    recalcLegacy();
  }
}

function searchLegacyCatalog(inputEl, id) {
  const val = inputEl.value.toLowerCase().trim();
  const res = document.getElementById(`leg-ac-${id}`);
  if (!res) return;
  if (!val) { res.style.display = 'none'; return; }

  const matches = INVENTORY_CATALOG.filter(i => i.desc.toLowerCase().includes(val));
  if (!matches.length) { res.style.display = 'none'; return; }

  res.innerHTML = matches.map(m => `
    <div class="autocomplete-item" data-action="select-legacy-catalog" data-legacy-catalog-id="${id}" data-legacy-catalog-desc="${escapeHtml(m.desc)}" data-legacy-catalog-price="${m.price}">
      <div class="name">${escapeHtml(m.desc)}</div>
      <div class="sub">₦ ${m.price.toLocaleString()} / day</div>
    </div>
  `).join('');
  res.style.display = 'block';
}

function selectLegacyCatalogItem(id, desc, price) {
  const row = document.getElementById('leg-r' + id);
  if (!row) return;
  row.querySelector('.leg-desc').value = desc;
  row.querySelector('.leg-price').value = price;
  const res = document.getElementById(`leg-ac-${id}`);
  if (res) res.style.display = 'none';
  calcLegacyRow(id);
}

function calcLegacyRow(id) {
  const row = document.getElementById('leg-r' + id);
  if (!row) return;
  const qty = parseFloat(row.querySelector('.leg-qty')?.value) || 0;
  const price = parseFloat(row.querySelector('.leg-price')?.value) || 0;
  const days = getRentalDays(document.getElementById('legDate')?.value, document.getElementById('legEndDate')?.value);
  const charge = qty * price * days;
  const chargeEl = row.querySelector('.leg-charge');
  if (chargeEl) chargeEl.value = charge > 0 ? charge.toFixed(2) : '';
  recalcLegacy();
}

function recalcLegacy() {
  const days = getRentalDays(document.getElementById('legDate')?.value, document.getElementById('legEndDate')?.value);
  let rental = 0;
  document.querySelectorAll('#legItemsBody tr').forEach(row => {
    const qty = parseFloat(row.querySelector('.leg-qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.leg-price')?.value) || 0;
    rental += qty * price * days;
  });
  const vat = rental * 0.075;
  const caution = parseFloat(document.getElementById('legCaution')?.value) || 0;
  const transport = parseFloat(document.getElementById('legTransport')?.value) || 0;
  const grand = rental + vat + caution + transport;

  if (document.getElementById('legRental')) document.getElementById('legRental').textContent = '₦ ' + fmt(rental);
  if (document.getElementById('legVat')) document.getElementById('legVat').textContent = '₦ ' + fmt(vat);
  if (document.getElementById('legCautionSummary')) document.getElementById('legCautionSummary').textContent = '₦ ' + fmt(caution);
  if (document.getElementById('legTransportSummary')) document.getElementById('legTransportSummary').textContent = '₦ ' + fmt(transport);
  if (document.getElementById('legTotal')) document.getElementById('legTotal').textContent = '₦ ' + fmt(grand);
  if (document.getElementById('legWords')) document.getElementById('legWords').textContent = numWords(Math.round(grand)) + ' Naira only';
}

function handleLegacyReceiptFile(files) {
  if (!files || !files.length) return;
  const file = files[0];
  if (!file.type.startsWith('image/')) {
    showToast('Please upload an image file (PNG, JPG, JPEG, WEBP)', 'error');
    return;
  }
  selectedLegacyFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('legacyReceiptPreview');
    const dropzone = document.getElementById('legacyDropzone');
    if (dropzone) dropzone.style.display = 'none';
    if (preview) {
      preview.innerHTML = `
        <div class="receipt-preview-card">
          <img src="${e.target.result}" alt="Receipt Thumbnail" />
          <div style="flex: 1;">
            <div style="font-weight: 700; font-size: 13.5px; color: var(--text);">${escapeHtml(file.name)}</div>
            <div style="font-size: 11.5px; color: var(--muted);">${(file.size / 1024).toFixed(1)} KB · Scanned Physical Receipt</div>
          </div>
          <button class="btn btn-ghost" style="color: #ef4444; padding: 6px 12px; font-size: 12px;" data-action="clear-legacy-file">✕ Remove</button>
        </div>
      `;
      preview.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

function clearLegacyFile() {
  selectedLegacyFile = null;
  const fileInput = document.getElementById('legReceiptFile');
  if (fileInput) fileInput.value = '';
  const preview = document.getElementById('legacyReceiptPreview');
  if (preview) {
    preview.innerHTML = '';
    preview.style.display = 'none';
  }
  const dropzone = document.getElementById('legacyDropzone');
  if (dropzone) dropzone.style.display = 'flex';
}

async function saveLegacyInvoice() {
  const refNo = document.getElementById('legRefNo')?.value || getNextSerialLegacyNo();
  const customerName = (document.getElementById('legCustomerName')?.value || '').trim();
  const phone = (document.getElementById('legPhone')?.value || '').trim();
  const email = (document.getElementById('legEmail')?.value || '').trim();
  const address = (document.getElementById('legAddress')?.value || '').trim();
  const legacyDate = document.getElementById('legDate')?.value || new Date().toISOString().split('T')[0];
  const caution = parseFloat(document.getElementById('legCaution')?.value) || 0;
  const transport = parseFloat(document.getElementById('legTransport')?.value) || 0;

  if (!customerName) {
    showToast('Please enter customer full name before ingesting', 'error');
    document.getElementById('legCustomerName')?.focus();
    return;
  }

  const items = [];
  let subtotal = 0;
  const rentalDays = getRentalDays(legacyDate, document.getElementById('legEndDate')?.value);
  document.querySelectorAll('#legItemsBody tr').forEach(row => {
    const qty = parseFloat(row.querySelector('.leg-qty')?.value) || 0;
    const desc = (row.querySelector('.leg-desc')?.value || '').trim();
    const price = parseFloat(row.querySelector('.leg-price')?.value) || 0;
    const total = qty * price * rentalDays;
    if (qty > 0 && desc) {
      items.push({ qty, desc, price, total });
      subtotal += total;
    }
  });

  if (items.length === 0) {
    showToast('Please add at least one rental item to the legacy breakdown', 'error');
    return;
  }

  const vat = subtotal * 0.075;
  const grandTotal = subtotal + vat + caution + transport;

  const ingestBtn = document.getElementById('btnSaveLegacy');
  if (ingestBtn) {
    ingestBtn.disabled = true;
    ingestBtn.innerHTML = '<span>⏳</span> Ingesting Record...';
  }

  try {
    // 1. Sync & persist customer details to the Supabase customer table
    await saveCustomerToDb({
      name: customerName,
      telephone: phone,
      email: email,
      address: address,
      notes: `Legacy customer ingested from historical record ${refNo}`
    });

    // 2. Build local Master Invoice Object with isLegacy = true
    const existingIdx = MASTER_INVOICES.findIndex(i => i.invoiceNo === refNo);
    const legacyInvoiceObj = {
      invoiceNo: refNo,
      date: legacyDate,
      customerName,
      phone: phone || 'N/A',
      email: email || 'N/A',
      address: address || 'Store Pickup / Local Delivery',
      totalCost: grandTotal,
      subtotal,
      vat,
      caution,
      transport,
      status: 'CONFIRMED',
      depositStatus: caution > 0 ? 'HELD' : 'N/A',
      isLegacy: true,
      items
    };

    if (existingIdx !== -1) {
      MASTER_INVOICES[existingIdx] = legacyInvoiceObj;
    } else {
      MASTER_INVOICES.unshift(legacyInvoiceObj);
    }

    persistMasterInvoices();

    // Keep an audit-ready snapshot of every ingested document for the archive.
    if (typeof archiveInvoiceSnapshot === 'function') archiveInvoiceSnapshot(legacyInvoiceObj);

    // 3. Persist to Supabase orders table with awaiting feedback
    const res = typeof syncInvoiceToSupabase === 'function'
      ? await syncInvoiceToSupabase(legacyInvoiceObj)
      : await insertOrderWithFallback({
          order_no: refNo.replace(/^#/, ''),
          order_date: legacyDate,
          cust_name: customerName,
          telephone: phone,
          email: email,
          address: address,
          rental_total: subtotal,
          caution_dep: caution,
          transport: transport,
          grand_total: grandTotal,
          items: items,
          is_legacy: true,
          order_type: 'legacy',
          notes: 'Legacy paper receipt ingestion'
        });

    if (typeof logAuditAction === 'function') {
      logAuditAction(refNo, 'LEGACY_INGESTION', {
        itemsCount: items.length,
        totalCost: grandTotal
      });
    }

    if (res && res.error) {
      console.warn('Legacy order Supabase sync note:', res.error);
      showToast(`Ingested locally! Supabase note: ${res.error.message || 'Database sync pending'}`, 'error');
    } else {
      showToast(`Legacy record ${refNo} ingested and synced to Supabase!`, 'success');
    }

    renderAllInvoicesTable(MASTER_INVOICES);
    renderDepositsTable();
    renderLegacyLogsTable();
    updateDashboardMetrics();
    createNewLegacyEntry();
  } catch (err) {
    console.error('Error saving legacy invoice:', err);
    showToast(`Error saving legacy record: ${err.message}`, 'error');
  } finally {
    if (ingestBtn) {
      ingestBtn.disabled = false;
      ingestBtn.innerHTML = '<span>📥</span> Ingest Historical Record';
    }
  }
}

function renderLegacyLogsTable(records = null) {
  const tbody = document.getElementById('legacyLogsBody');
  if (!tbody) return;

  const logs = records || MASTER_INVOICES.filter(i => i.isLegacy);
  const empty = document.getElementById('legacyLogsEmpty');
  const wrap = tbody.closest('.table-scroll');

  if (logs.length === 0) {
    tbody.innerHTML = '';
    if (empty) {
      const noneAtAll = MASTER_INVOICES.filter(i => i.isLegacy).length === 0;
      document.getElementById('legacyLogsEmptyTitle').textContent = noneAtAll
        ? 'No legacy records yet'
        : 'No matching legacy records';
      document.getElementById('legacyLogsEmptyText').textContent = noneAtAll
        ? 'Ingest a historical paper receipt above and it will be listed here.'
        : 'Try a different search term.';
      const action = document.getElementById('legacyLogsEmptyAction');
      if (action) action.hidden = !noneAtAll;
      empty.hidden = false;
    }
    if (wrap) wrap.hidden = true;
    return;
  }

  if (empty) empty.hidden = true;
  if (wrap) wrap.hidden = false;

  tbody.innerHTML = logs.map(inv => {
    const itemsSummary = Array.isArray(inv.items) && inv.items.length > 0
      ? inv.items.map(it => `${escapeHtml(it.qty)}x ${escapeHtml(it.desc)}`).join(', ')
      : 'Legacy items package';

    const safeNo = escapeHtml(inv.invoiceNo);
    const safeDate = escapeHtml(inv.date || '');
    const safeCust = escapeHtml(inv.customerName || 'Customer');
    const safeTotal = Number(inv.totalCost || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 });

    return `
      <tr class="clickable-row" data-action="view-invoice" data-invoice-no="${safeNo}">
        <td><strong style="color: var(--forest-dark); font-family: 'Outfit', sans-serif;">${safeNo}</strong></td>
        <td>${safeDate}</td>
        <td><strong>${safeCust}</strong></td>
        <td style="max-width: 280px; white-space: normal; line-height: 1.4; font-size: 12.5px; color: #475569;">${itemsSummary}</td>
        <td><strong>₦ ${safeTotal}</strong></td>
        <td><span class="badge-legacy">📜 LEGACY</span></td>
        <td style="text-align: center; white-space: nowrap;">
          <button class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;">View ➔</button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterLegacyLogsTable(query) {
  const q = (query || '').toLowerCase().trim();
  let legacyOnly = MASTER_INVOICES.filter(i => i.isLegacy);
  if (q) {
    legacyOnly = legacyOnly.filter(i =>
      (i.invoiceNo && i.invoiceNo.toLowerCase().includes(q)) ||
      (i.customerName && i.customerName.toLowerCase().includes(q)) ||
      (Array.isArray(i.items) && i.items.some(it => it.desc && it.desc.toLowerCase().includes(q))) ||
      (i.totalCost && i.totalCost.toString().includes(q))
    );
  }
  renderLegacyLogsTable(legacyOnly);
}

function printLegacyRecord() {
  if (typeof printCurrentLegacyForm === 'function') printCurrentLegacyForm();
  else window.print();
}
