/* ==============================================================================
   Kitchenware Rentals Ltd — ERP & Order Management System
   MODULE: PRINT — builds an A4 invoice document and prints that instead of the
           application screen. Used by the toolbar, the command palette, the
           invoice detail modal and Ctrl/Cmd+P.
   ============================================================================== */

/* Company details shown in the letterhead. Fill in the optional fields and they
   appear on the document automatically; empty ones are omitted. */
const PRINT_COMPANY = {
  name: 'Kitchenware Rentals Ltd',
  tagline: 'ERP & Hire System',
  logo: 'src/logo-mark.png',
  addressLines: [],
  phone: '',
  email: '',
  rcNumber: '',
  bank: null // { bankName: '…', accountName: '…', accountNumber: '…' }
};

const PRINT_STATUS_LABELS = {
  NEW: 'New',
  CONFIRMED: 'Confirmed',
  OUT_ON_HIRE: 'Out on hire',
  RETURNED: 'Returned',
  PENDING: 'Pending',
  DRAFT: 'Draft — not yet saved'
};

let printIssuedAt = 0;

/* ── FORMATTERS ──────────────────────────────────────────────────────────── */
function printMoney(value) {
  return `₦ ${fmt(Number(value) || 0)}`;
}

/* Fixed month names: Intl's en-GB "short" month is "Sept", which reads wrongly
   on a formal document. Invoice dates are always 26 Sep 2026. */
const PRINT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function printDateParts(value) {
  if (!value) return null;
  const raw = String(value);
  const date = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(date.getTime())) return null;
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: PRINT_MONTHS[date.getMonth()],
    year: date.getFullYear()
  };
}

function printDate(value) {
  const parts = printDateParts(value);
  if (!parts) return value ? String(value) : '';
  return `${parts.day} ${parts.month} ${parts.year}`;
}

function printDateRange(start, end) {
  if (!start && !end) return '';
  if (start && !end) return printDate(start);
  if (!start && end) return printDate(end);
  const a = printDateParts(start);
  const b = printDateParts(end);
  if (!a || !b) return `${printDate(start)} – ${printDate(end)}`;
  if (start === end) return printDate(start);
  const sameMonth = a.month === b.month && a.year === b.year;
  const left = sameMonth ? a.day : `${a.day} ${a.month}`;
  return `${left} – ${b.day} ${b.month} ${b.year}`;
}

function printDaysBetween(start, end) {
  if (typeof getRentalDays === 'function') return getRentalDays(start, end);
  if (!start || !end) return 1;
  const diff = Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000) + 1;
  return diff > 0 ? diff : 1;
}

function printStatusLabel(status) {
  return PRINT_STATUS_LABELS[status] || status || '—';
}

function printCompanyMeta() {
  const bits = [...PRINT_COMPANY.addressLines];
  if (PRINT_COMPANY.phone) bits.push(`Tel ${PRINT_COMPANY.phone}`);
  if (PRINT_COMPANY.email) bits.push(PRINT_COMPANY.email);
  if (PRINT_COMPANY.rcNumber) bits.push(`RC ${PRINT_COMPANY.rcNumber}`);
  return bits;
}

/* ── VIEW MODELS ─────────────────────────────────────────────────────────── */
function printNormaliseItems(items, days) {
  return (items || [])
    .map(item => {
      const qty = Number(item.qty) || 0;
      const price = Number(item.price) || 0;
      const amount = item.total != null && item.total !== '' ? Number(item.total) : qty * price * (days || 1);
      return { qty, desc: item.desc || '', price, amount };
    })
    .filter(item => item.desc || item.qty || item.amount);
}

function buildInvoicePrintView(inv) {
  let days = inv.startDate && inv.endDate ? printDaysBetween(inv.startDate, inv.endDate) : 1;
  // Records ingested without a hire period still encode the multiplier in each
  // line total; recover it so the Days column is not misleading.
  if (!inv.startDate && !inv.endDate && Array.isArray(inv.items)) {
    const sample = inv.items.find(item => Number(item.qty) && Number(item.price) && Number(item.total));
    if (sample) {
      const ratio = Math.round(Number(sample.total) / (Number(sample.qty) * Number(sample.price)));
      if (ratio > 0) days = ratio;
    }
  }
  const items = printNormaliseItems(inv.items, days);
  const subtotal = inv.subtotal != null ? Number(inv.subtotal) : items.reduce((sum, i) => sum + i.amount, 0);
  const vat = inv.vat != null ? Number(inv.vat) : subtotal * 0.075;
  const caution = Number(inv.caution) || 0;
  const transport = Number(inv.transport) || 0;
  const total = inv.totalCost != null ? Number(inv.totalCost) : subtotal + vat + caution + transport;

  return {
    kind: inv.isLegacy ? 'legacy' : 'invoice',
    number: inv.invoiceNo || '',
    issued: inv.date || inv.startDate || '',
    status: inv.status || '',
    customerName: inv.customerName || '',
    phone: inv.phone || '',
    email: inv.email || '',
    customerAddress: inv.customerAddress || inv.address || '',
    deliveryAddress: inv.address || '',
    startDate: inv.startDate || inv.date || '',
    endDate: inv.endDate || '',
    periodKnown: Boolean(inv.startDate && inv.endDate),
    days,
    items,
    subtotal,
    vat,
    caution,
    transport,
    total,
    words: `${numWords(Math.round(total))} Naira\u00A0Only`
  };
}

function buildInvoiceViewFromForm() {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const number = val('fOrderNo') || (document.getElementById('badgeNo')?.textContent || '').trim();
  const startDate = val('fStartDate');
  const endDate = val('fEndDate');
  const days = printDaysBetween(startDate, endDate);

  const items = [...document.querySelectorAll('#itemsBody tr')].map(row => {
    const qty = parseFloat(row.querySelector('.qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.price')?.value) || 0;
    return { qty, desc: row.querySelector('.desc')?.value.trim() || '', price, amount: qty * price * days };
  }).filter(item => item.desc || item.qty);

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const vat = subtotal * 0.075;
  const caution = parseFloat(val('fCaution')) || 0;
  const transport = parseFloat(val('fTransport')) || 0;
  const total = subtotal + vat + caution + transport;
  const savedInvoice = Array.isArray(MASTER_INVOICES)
    ? MASTER_INVOICES.find(inv => inv.invoiceNo === number)
    : null;

  return {
    kind: 'invoice',
    number,
    issued: savedInvoice?.date || new Date().toISOString().slice(0, 10),
    status: savedInvoice?.status || 'DRAFT',
    draft: !savedInvoice,
    customerName: val('fCustomerName'),
    phone: val('fPhone'),
    email: val('fEmail'),
    customerAddress: val('fCustomerAddress'),
    deliveryAddress: val('fAddress'),
    startDate,
    endDate,
    periodKnown: Boolean(startDate && endDate),
    days,
    items,
    subtotal,
    vat,
    caution,
    transport,
    total,
    words: `${numWords(Math.round(total))} Naira\u00A0Only`
  };
}

function buildLegacyViewFromForm() {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const number = val('legRefNo') || (document.getElementById('legBadgeNo')?.textContent || '').trim();
  const startDate = val('legDate');
  const endDate = val('legEndDate');
  const days = printDaysBetween(startDate, endDate);

  const items = [...document.querySelectorAll('#legItemsBody tr')].map(row => {
    const qty = parseFloat(row.querySelector('.leg-qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.leg-price')?.value) || 0;
    return { qty, desc: row.querySelector('.leg-desc')?.value.trim() || '', price, amount: qty * price * days };
  }).filter(item => item.desc || item.qty);

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const vat = subtotal * 0.075;
  const caution = parseFloat(val('legCaution')) || 0;
  const transport = parseFloat(val('legTransport')) || 0;
  const total = subtotal + vat + caution + transport;

  return {
    kind: 'legacy',
    number,
    issued: startDate,
    status: 'RETURNED',
    customerName: val('legCustomerName'),
    phone: val('legPhone'),
    email: val('legEmail'),
    customerAddress: val('legAddress'),
    deliveryAddress: val('legAddress'),
    startDate,
    endDate,
    periodKnown: Boolean(startDate && endDate),
    days,
    items,
    subtotal,
    vat,
    caution,
    transport,
    total,
    words: `${numWords(Math.round(total))} Naira\u00A0Only`
  };
}

/* ── RENDERER ────────────────────────────────────────────────────────────── */
function printPartyBlock(label, name, lines, extra) {
  const body = [];
  if (name) body.push(`<div class="ps-party-name">${escapeHtml(name)}</div>`);
  lines.filter(Boolean).forEach(line => body.push(`<div class="ps-party-line">${escapeHtml(line)}</div>`));
  if (extra) body.push(`<div class="ps-period">${extra}</div>`);
  return `
    <div class="ps-party">
      <div class="ps-party-label">${escapeHtml(label)}</div>
      ${body.join('') || '<div class="ps-party-line">—</div>'}
    </div>`;
}

function printVerificationUrl(view) {
  const serial = String(view.number || '').replace(/^#/, '');
  return `${location.origin}${location.pathname}?invoice=${encodeURIComponent(serial)}`;
}

function printQrMarkup(view) {
  const url = printVerificationUrl(view);
  let svg = '';
  try {
    if (typeof qrcode === 'function') {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      svg = qr.createSvgTag({
        cellSize: 3,
        margin: 0,
        scalable: true,
        alt: `Verify ${view.number}`,
        title: `QR code for ${view.number}`
      });
    }
  } catch (error) {
    svg = '';
  }

  if (!svg) {
    return `
      <div class="ps-verify ps-verify-text-only">
        <span class="ps-party-label">Verify online</span>
        <div class="ps-verify-url">${escapeHtml(url)}</div>
      </div>`;
  }

  return `
    <div class="ps-verify">
      <div class="ps-qr">${svg}</div>
      <div class="ps-verify-text">
        <span class="ps-party-label">Scan to verify</span>
        <div class="ps-verify-ref">${escapeHtml(view.number)}</div>
      </div>
    </div>`;
}

function printSheetMarkup(view) {
  const isLegacy = view.kind === 'legacy';
  const companyMeta = printCompanyMeta();
  const contactLine = [view.phone, view.email].filter(Boolean).join(' · ');
  const logoUrl = new URL(PRINT_COMPANY.logo, location.href).href;

  const periodBits = [];
  if (view.periodKnown) {
    periodBits.push(`<strong>${escapeHtml(printDateRange(view.startDate, view.endDate))}</strong>`);
    periodBits.push(`${view.days} ${view.days === 1 ? 'day' : 'days'}`);
  }
  if (view.items.length) {
    periodBits.push(`${view.items.length} ${view.items.length === 1 ? 'line item' : 'line items'}`);
  }

  const itemRows = view.items.length
    ? view.items.map((item, index) => `
        <tr>
          <td class="ps-col-no">${index + 1}</td>
          <td>${escapeHtml(item.desc) || '—'}</td>
          <td class="ps-num">${item.qty.toLocaleString('en-NG')}</td>
          <td class="ps-num">${view.days}</td>
          <td class="ps-num">${printMoney(item.price)}</td>
          <td class="ps-num ps-strong">${printMoney(item.amount)}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" class="ps-empty">No line items recorded on this document.</td></tr>`;

  const bank = PRINT_COMPANY.bank;
  const bankLine = bank && (bank.bankName || bank.accountNumber)
    ? `<div class="ps-bank">
         <span class="ps-party-label">Payment details</span>
         <div>${[bank.bankName, bank.accountName, bank.accountNumber].filter(Boolean).map(escapeHtml).join(' · ')}</div>
       </div>`
    : '';

  return `
    ${view.draft ? '<div class="ps-watermark" aria-hidden="true">Draft</div>' : ''}
    <header class="ps-head">
      <div class="ps-brand">
        <img class="ps-logo" src="${escapeHtml(logoUrl)}" alt="" />
        <div>
          <div class="ps-company">${escapeHtml(PRINT_COMPANY.name)}</div>
          <div class="ps-tagline">${escapeHtml(PRINT_COMPANY.tagline)}</div>
          ${companyMeta.length ? `<div class="ps-company-meta">${companyMeta.map(escapeHtml).join(' · ')}</div>` : ''}
        </div>
      </div>
      <div class="ps-doc">
        <div class="ps-doc-kind">${isLegacy ? 'Historical record' : 'Tax invoice'}</div>
        <div class="ps-doc-no">${escapeHtml(view.number)}</div>
        <div class="ps-doc-meta">
          <div><span>Issued</span><strong>${escapeHtml(printDate(view.issued)) || '—'}</strong></div>
          <div><span>Status</span><strong>${escapeHtml(printStatusLabel(view.status))}</strong></div>
        </div>
      </div>
    </header>

    ${isLegacy ? '<div class="ps-legacy-band">Ingested historical record — transcribed from a physical receipt. Not a current tax invoice.</div>' : ''}

    <section class="ps-parties">
      ${printPartyBlock('Billed to', view.customerName, [contactLine, view.customerAddress])}
      ${printPartyBlock('Delivered to', '', [view.deliveryAddress || 'Same as billing address'], periodBits.join(' · '))}
    </section>

    <table class="ps-items">
      <thead>
        <tr class="ps-runhead">
          <td colspan="6">
            <span class="ps-runhead-doc">${escapeHtml(view.number)}</span>
            <span class="ps-runhead-customer">${escapeHtml(view.customerName) || '—'}</span>
            <span class="ps-runhead-kind">${isLegacy ? 'Historical record' : 'Tax invoice'}</span>
          </td>
        </tr>
        <tr>
          <th class="ps-col-no">#</th>
          <th>Item description</th>
          <th class="ps-num">Qty</th>
          <th class="ps-num">Days</th>
          <th class="ps-num">Rate / day</th>
          <th class="ps-num">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <section class="ps-close">
      <div class="ps-notes">
        <div class="ps-party-label">Amount in words</div>
        <div class="ps-words">${escapeHtml(view.words)}</div>
        ${bankLine}
        <div class="ps-terms">
          <span class="ps-party-label">Terms</span>
          <div>Caution deposit is refundable on return of all items in good condition.</div>
          <div>All equipment remains the property of ${escapeHtml(PRINT_COMPANY.name)}.</div>
        </div>
      </div>

      <table class="ps-totals">
        <tr><th>Subtotal</th><td>${printMoney(view.subtotal)}</td></tr>
        <tr><th>VAT (7.5%)</th><td>${printMoney(view.vat)}</td></tr>
        <tr><th>Caution deposit</th><td>${printMoney(view.caution)}</td></tr>
        <tr><th>Transport</th><td>${printMoney(view.transport)}</td></tr>
        <tr class="ps-grand"><th>Total payable</th><td>${printMoney(view.total)}</td></tr>
      </table>
    </section>

    <div class="ps-fill" aria-hidden="true"></div>

    <footer class="ps-foot">
      <div class="ps-sign">
        <div class="ps-sign-line"></div>
        <div class="ps-sign-label">Authorised signature</div>
      </div>
      <div class="ps-foot-side">
        ${printQrMarkup(view)}
        <div class="ps-foot-note">
          ${view.draft ? '<strong class="ps-draft">DRAFT — not saved to the ledger</strong><br />' : ''}
          Issued by ${escapeHtml(PRINT_COMPANY.name)}${PRINT_COMPANY.phone ? ` · ${escapeHtml(PRINT_COMPANY.phone)}` : ''}
        </div>
      </div>
    </footer>
  `;
}

function renderPrintSheet(view) {
  const sheet = document.getElementById('printSheet');
  if (!sheet || !view) return;

  document.body.classList.add('print-document');
  sheet.innerHTML = printSheetMarkup(view);
  const fitsOnePage = applyPrintPageFill(sheet);
  setPrintPageMode(fitsOnePage);
}

/* Push the signature block towards the bottom of the last page on short
   invoices. A spacer is only added when the document easily fits one page, so
   long documents keep their natural flow. Measurements use the same styles at
   the same 186 mm content width as the printed sheet. */
const PRINT_PAGE_CONTENT_PX = ((297 - 14 - 15) / 25.4) * 96;

function applyPrintPageFill(sheet) {
  const spacer = sheet.querySelector('.ps-fill');
  if (!spacer) return false;

  spacer.style.height = '0px';
  sheet.classList.add('measure');
  const height = sheet.getBoundingClientRect().height;
  sheet.classList.remove('measure');

  const fits = height <= PRINT_PAGE_CONTENT_PX - 6;
  const gap = PRINT_PAGE_CONTENT_PX - 10 - height;
  spacer.style.height = gap > 40 ? `${Math.round(gap)}px` : '0px';
  return fits;
}

/* Single-page documents print with a zero page margin so Chrome suppresses
   its URL/date headers; the sheet supplies the 14/12/15 mm page inset itself.
   Long documents keep real page margins so continuation pages stay inset. */
function setPrintPageMode(singlePage) {
  let style = document.getElementById('printPageRule');
  if (!style) {
    style = document.createElement('style');
    style.id = 'printPageRule';
    document.head.appendChild(style);
  }
  style.textContent = singlePage
    ? '@media print { @page { size: A4 portrait; margin: 0; } body.print-document .print-sheet { padding: 14mm 12mm 15mm; } }'
    : '@media print { @page { size: A4 portrait; margin: 8mm 12mm; } body.print-document .print-sheet { padding: 6mm 0 7mm; } }';
}

/* Drop the document-specific page rule so the application's own print
   stylesheet applies again. */
function clearPrintPageMode() {
  const style = document.getElementById('printPageRule');
  if (style) style.textContent = '';
}

/* ── PRINT DRIVER ────────────────────────────────────────────────────────── */
function printDocument(view, options = {}) {
  if (!view) return false;
  renderPrintSheet(view);
  if (options.archive !== false) archivePrintDocument(view);

  const previousTitle = document.title;
  const docTitle = [view.number, view.customerName].filter(Boolean).join(' — ');
  if (docTitle) document.title = docTitle;

  const restoreTitle = () => {
    document.title = previousTitle;
    window.removeEventListener('afterprint', restoreTitle);
  };
  window.addEventListener('afterprint', restoreTitle);

  printIssuedAt = Date.now();
  window.print();
  return true;
}

/* Print an already-built document (e.g. the service & return report), reusing
   the same A4 page rules, filler measurement and filename handling. */
function printCustomDocument(markup, title) {
  const sheet = document.getElementById('printSheet');
  if (!sheet || !markup) return false;

  document.body.classList.add('print-document');
  sheet.innerHTML = markup;
  const fitsOnePage = applyPrintPageFill(sheet);
  setPrintPageMode(fitsOnePage);

  const previousTitle = document.title;
  if (title) document.title = title;
  const restoreTitle = () => {
    document.title = previousTitle;
    window.removeEventListener('afterprint', restoreTitle);
  };
  window.addEventListener('afterprint', restoreTitle);

  printIssuedAt = Date.now();
  window.print();
  return true;
}

/* Toolbar / palette / Ctrl+P: print the invoice currently in the editor. */
function printInvoice() {  const view = buildInvoiceViewFromForm();
  if (!view.customerName && view.items.length === 0) {
    showToast('Nothing to print yet — add a customer and at least one item', 'error');
    return;
  }
  printDocument(view);
}

/* Invoice detail modal: print the record the modal is showing. */
function printActiveInvoice() {
  if (typeof activeSelectedInvoice !== 'undefined' && activeSelectedInvoice) {
    printDocument(buildInvoicePrintView(activeSelectedInvoice));
    return;
  }
  printInvoice();
}

/* Data Entry tab: print the legacy record in the editor. */
function printCurrentLegacyForm() {
  const view = buildLegacyViewFromForm();
  if (!view.customerName && view.items.length === 0) {
    showToast('Nothing to print yet — add a customer and at least one item', 'error');
    return;
  }
  printDocument(view);
}

/* ── SHARE ───────────────────────────────────────────────────────────────── */
let shareView = null;
let shareAnchor = null;

function currentShareView() {
  const modal = document.getElementById('invoiceDetailModal');
  const modalOpen = Boolean(modal) && getComputedStyle(modal).display !== 'none';
  if (modalOpen && typeof activeSelectedInvoice !== 'undefined' && activeSelectedInvoice) {
    return buildInvoicePrintView(activeSelectedInvoice);
  }

  const activeTab = document.querySelector('.tab-content.active')?.id;
  if (activeTab === 'tab-data-entry') {
    const legacy = buildLegacyViewFromForm();
    if (legacy.customerName || legacy.items.length) return legacy;
  } else if (activeTab === 'tab-invoicing') {
    const invoice = buildInvoiceViewFromForm();
    if (invoice.customerName || invoice.items.length) return invoice;
  }
  return null;
}

function shareSummary(view) {
  const title = [view.number, view.customerName].filter(Boolean).join(' — ') || 'Invoice';
  const lines = [title];
  if (view.periodKnown) {
    lines.push(`Hire period: ${printDateRange(view.startDate, view.endDate)} (${view.days} ${view.days === 1 ? 'day' : 'days'})`);
  }
  if (view.items.length) lines.push(`Items: ${view.items.length}`);
  lines.push(`Total payable: ${printMoney(view.total)}`);
  lines.push(`Status: ${view.draft ? 'Draft — not yet saved' : printStatusLabel(view.status)}`);
  lines.push('— Kitchenware Rentals Ltd');
  return { title, text: lines.join('\n'), phone: view.phone || '', email: view.email || '' };
}

/* Nigerian numbers: 0803… -> 234803…; already-international numbers pass through. */
function phoneForWhatsApp(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `234${digits.slice(1)}`;
  return digits;
}

function shareViaWhatsApp(view) {
  const payload = shareSummary(view);
  const phone = phoneForWhatsApp(payload.phone);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(payload.text)}`;
  window.open(url, '_blank', 'noopener');
  showToast('Opening WhatsApp…', 'success');
}

function shareViaEmail(view) {
  const payload = shareSummary(view);
  const subject = encodeURIComponent(payload.title);
  const body = encodeURIComponent(payload.text);
  window.location.href = `mailto:${payload.email}?subject=${subject}&body=${body}`;
}

async function copyShareSummary(view) {
  const payload = shareSummary(view);
  try {
    await navigator.clipboard.writeText(payload.text);
    showToast('Invoice summary copied', 'success');
    return;
  } catch {
    // Fall through to the legacy path when the Clipboard API is unavailable.
  }

  const area = document.createElement('textarea');
  area.value = payload.text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
    showToast('Invoice summary copied', 'success');
  } catch {
    showToast('Could not copy the invoice summary', 'error');
  }
  area.remove();
}

function closeShareMenu() {
  const menu = document.getElementById('shareMenu');
  if (!menu) return;
  menu.hidden = true;
  document.querySelectorAll('[data-action="share-invoice"]').forEach(btn => {
    btn.setAttribute('aria-expanded', 'false');
  });
  shareView = null;
  shareAnchor = null;
}

function openShareMenu(anchor) {
  const menu = document.getElementById('shareMenu');
  if (!menu) return;

  // Clicking the same button again closes the menu.
  if (!menu.hidden && shareAnchor === anchor) {
    closeShareMenu();
    return;
  }

  const view = currentShareView();
  if (!view) {
    showToast('Nothing to share yet — open an invoice or fill in the form', 'error');
    return;
  }

  shareView = view;
  shareAnchor = anchor || null;
  menu.hidden = false;

  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = rect.right - menuRect.width;
    left = Math.max(12, Math.min(left, window.innerWidth - menuRect.width - 12));
    let top = rect.bottom + 8;
    if (top + menuRect.height > window.innerHeight - 12) {
      top = rect.top - menuRect.height - 8;
    }
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    anchor.setAttribute('aria-expanded', 'true');
  }

  menu.querySelector('.share-menu-item')?.focus({ preventScroll: true });
}

function handleShareChannel(channel) {
  const view = shareView;
  if (!view) return;
  closeShareMenu();
  if (channel === 'whatsapp') shareViaWhatsApp(view);
  else if (channel === 'email') shareViaEmail(view);
  else if (channel === 'copy') copyShareSummary(view);
}

function initShareMenu() {
  const menu = document.getElementById('shareMenu');
  if (!menu) return;

  menu.addEventListener('click', (event) => {
    const item = event.target.closest('[data-share-channel]');
    if (!item) return;
    handleShareChannel(item.dataset.shareChannel);
  });

  document.addEventListener('click', (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target)) return;
    if (event.target.closest('[data-action="share-invoice"]')) return;
    closeShareMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || menu.hidden) return;
    const anchor = shareAnchor;
    closeShareMenu();
    anchor?.focus?.();
  });

  window.addEventListener('resize', closeShareMenu);
  window.addEventListener('scroll', closeShareMenu, { capture: true, passive: true });
}

/* ── CONTEXT FOR PLAIN Ctrl/Cmd+P ────────────────────────────────────────── */
function preparePrintFromCurrentContext() {
  const sheet = document.getElementById('printSheet');
  if (!sheet) return;

  const modal = document.getElementById('invoiceDetailModal');
  const modalOpen = Boolean(modal) && getComputedStyle(modal).display !== 'none';
  const activeTab = document.querySelector('.tab-content.active')?.id;

  let view = null;
  if (modalOpen && typeof activeSelectedInvoice !== 'undefined' && activeSelectedInvoice) {
    view = buildInvoicePrintView(activeSelectedInvoice);
  } else if (activeTab === 'tab-data-entry') {
    const legacy = buildLegacyViewFromForm();
    if (legacy.customerName || legacy.items.length) view = legacy;
  } else if (activeTab === 'tab-invoicing') {
    const invoice = buildInvoiceViewFromForm();
    if (invoice.customerName || invoice.items.length) view = invoice;
  }

  if (view) {
    renderPrintSheet(view);
  } else {
    // No document context: fall back to the app's own print stylesheet.
    sheet.innerHTML = '';
    document.body.classList.remove('print-document');
    clearPrintPageMode();
  }
}

function initPrintDocument() {
  const sheet = document.getElementById('printSheet');
  if (!sheet) return;

  window.addEventListener('beforeprint', () => {
    // printDocument() renders the sheet synchronously just before calling print(),
    // so a beforeprint firing within the same tick must not rebuild the document
    // from whatever tab happens to be active.
    if (Date.now() - printIssuedAt < 1000) return;
    preparePrintFromCurrentContext();
  });

  initShareMenu();
}

window.printInvoice = printInvoice;
window.printActiveInvoice = printActiveInvoice;
window.printCurrentLegacyForm = printCurrentLegacyForm;
window.initPrintDocument = initPrintDocument;
window.printCustomDocument = printCustomDocument;
window.openShareMenu = openShareMenu;
window.closeShareMenu = closeShareMenu;

/* ── PRINT ARCHIVE ───────────────────────────────────────────────────────── */
const PRINT_ARCHIVE_KEY = 'kwr_print_archive_v1';
const PRINT_ARCHIVE_LIMIT = 60;

function readPrintArchive() {
  try {
    const raw = localStorage.getItem(PRINT_ARCHIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(entry => entry && entry.view) : [];
  } catch {
    return [];
  }
}

function writePrintArchive(entries) {
  try {
    localStorage.setItem(PRINT_ARCHIVE_KEY, JSON.stringify((entries || []).slice(0, PRINT_ARCHIVE_LIMIT)));
    return true;
  } catch (error) {
    console.warn('Print archive could not be saved:', error);
    return false;
  }
}

function archivePrintDocument(view) {
  if (!view || (!view.number && !view.customerName && !(view.items && view.items.length))) return false;

  const entry = {
    id: `arch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    number: view.number || '(no number)',
    customer: view.customerName || 'Unnamed customer',
    kind: view.kind || 'invoice',
    total: Number(view.total) || 0,
    status: view.status || '',
    draft: Boolean(view.draft),
    savedAt: new Date().toISOString(),
    view
  };

  // One archive slot per document: reprinting refreshes the snapshot rather
  // than filling the list with duplicates.
  const entries = readPrintArchive().filter(
    item => !(item.number === entry.number && item.kind === entry.kind)
  );
  entries.unshift(entry);
  return writePrintArchive(entries);
}

function archiveInvoiceSnapshot(invoice) {
  if (!invoice || !invoice.invoiceNo) return false;
  return archivePrintDocument(buildInvoicePrintView(invoice));
}

function printArchiveTimestamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function renderPrintArchive() {
  const list = document.getElementById('printArchiveList');
  if (!list) return;

  const entries = readPrintArchive();
  if (!entries.length) {
    list.innerHTML = `
      <div class="archive-empty">
        Nothing archived yet. Print or save an invoice and a snapshot will appear here for reprinting.
      </div>`;
    return;
  }

  list.innerHTML = entries.map(entry => {
    const kindLabel = entry.kind === 'legacy' ? 'Historical record' : 'Tax invoice';
    return `
      <div class="archive-item" data-archive-id="${escapeHtml(entry.id)}">
        <div class="archive-main">
          <div class="archive-no">
            ${escapeHtml(entry.number)}
            ${entry.draft ? '<span class="archive-draft">Draft</span>' : ''}
          </div>
          <div class="archive-customer">${escapeHtml(entry.customer)}</div>
          <div class="archive-meta">
            ${kindLabel} · ${printMoney(entry.total)} · Printed ${escapeHtml(printArchiveTimestamp(entry.savedAt))}
          </div>
        </div>
        <div class="archive-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="archive-reprint">🖨️ Reprint</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="archive-download">⬇️ HTML</button>
          <button type="button" class="btn btn-ghost btn-sm btn-icon-danger" data-action="archive-delete"
            aria-label="Delete archived document">🗑️</button>
        </div>
      </div>`;
  }).join('');
}

function openPrintArchive() {
  const modal = document.getElementById('printArchiveModal');
  if (!modal) return;
  renderPrintArchive();
  modal.style.display = 'flex';
  modal.querySelector('[data-action="close-print-archive"]')?.focus({ preventScroll: true });
}

function closePrintArchive() {
  const modal = document.getElementById('printArchiveModal');
  if (modal) modal.style.display = 'none';
}

function getArchivedEntry(id) {
  return readPrintArchive().find(entry => entry.id === id) || null;
}

function reprintArchivedDocument(id) {
  const entry = getArchivedEntry(id);
  if (!entry) {
    showToast('That archived document is no longer available', 'error');
    return;
  }
  closePrintArchive();
  if (entry.view.draft === undefined) entry.view.draft = false;
  printDocument(entry.view, { archive: false });
}

async function downloadArchivedDocument(id) {
  const entry = getArchivedEntry(id);
  if (!entry) {
    showToast('That archived document is no longer available', 'error');
    return;
  }

  let css = '';
  try {
    const response = await fetch('css/main.css', { cache: 'force-cache' });
    if (response.ok) css = await response.text();
  } catch {
    // A document without the stylesheet still prints, just plainer.
  }

  const title = [entry.number, entry.customer].filter(Boolean).join(' — ') || 'Archived invoice';
  let markup = printSheetMarkup(entry.view);

  // Recreate the footer placement of the live print sheet: short documents get
  // the same measured spacer that pins the signature block to the page bottom.
  try {
    const probe = document.createElement('section');
    probe.className = 'print-sheet';
    probe.setAttribute('aria-hidden', 'true');
    probe.innerHTML = markup;
    document.body.appendChild(probe);
    applyPrintPageFill(probe);
    markup = probe.innerHTML;
    probe.remove();
  } catch {
    // Measurement is cosmetic; fall back to the unspaced document.
  }
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
${css}
html, body { background: #ffffff; }
body { margin: 0; padding: 0; }
.print-sheet { display: block !important; max-width: 210mm; margin: 0 auto; padding: 14mm 12mm; }
@media print {
  @page { size: A4 portrait; margin: 14mm 12mm 15mm; }
  body { margin: 0 !important; padding: 0 !important; }
  .print-sheet { display: block !important; padding: 0 !important; max-width: none; }
}
</style>
</head>
<body class="print-document">
<section class="print-sheet">
${markup}
</section>
</body>
</html>`;

  const filename = `${entry.number} — ${entry.customer}`.replace(/^#/, '').replace(/[\\/:*?"<>|]+/g, '-');
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast('Archived document downloaded', 'success');
}

function deleteArchivedDocument(id) {
  const entry = getArchivedEntry(id);
  if (!entry) return;
  writePrintArchive(readPrintArchive().filter(item => item.id !== id));
  renderPrintArchive();
  showToast(`Removed ${entry.number} from the archive`, 'success');
}

/* ── QR DEEP LINK (?invoice=INV-0001) ────────────────────────────────────── */
function normaliseInvoiceParam(raw) {
  const value = decodeURIComponent(String(raw || '')).trim();
  if (!value) return '';
  if (value.startsWith('#')) return value.toUpperCase().replace(/^#LEG-/, 'LEG-');
  if (/^LEG-/i.test(value)) return value.toUpperCase();
  if (/^INV-/i.test(value)) return `#${value.toUpperCase()}`;
  if (/^\d+$/.test(value)) return `#INV-${value.padStart(4, '0')}`;
  return `#${value.toUpperCase()}`;
}

function handleInvoiceDeepLink() {
  let raw = '';
  try {
    raw = new URLSearchParams(window.location.search).get('invoice') || '';
  } catch {
    return false;
  }
  if (!raw) return false;
  if (typeof MASTER_INVOICES === 'undefined' || !Array.isArray(MASTER_INVOICES)) return false;

  const target = normaliseInvoiceParam(raw);
  const invoice = MASTER_INVOICES.find(
    inv => String(inv.invoiceNo || '').toUpperCase() === target.toUpperCase()
  );

  if (!invoice) {
    showToast(`Invoice ${target} was not found`, 'error');
    return false;
  }

  if (typeof switchTab === 'function') switchTab('all-invoices');
  if (typeof openInvoiceDetailModal === 'function') openInvoiceDetailModal(invoice.invoiceNo);
  showToast(`Opened ${invoice.invoiceNo} from the QR code`, 'success');
  return true;
}

function initPrintArchive() {
  const modal = document.getElementById('printArchiveModal');
  if (!modal) return;

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closePrintArchive();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.style.display === 'flex') closePrintArchive();
  });
}

initPrintArchive();

window.openPrintArchive = openPrintArchive;
window.closePrintArchive = closePrintArchive;
window.reprintArchivedDocument = reprintArchivedDocument;
window.downloadArchivedDocument = downloadArchivedDocument;
window.deleteArchivedDocument = deleteArchivedDocument;
window.archiveInvoiceSnapshot = archiveInvoiceSnapshot;
window.handleInvoiceDeepLink = handleInvoiceDeepLink;
