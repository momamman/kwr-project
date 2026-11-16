/* ==============================================================================
   Kitchenware Rentals Ltd — ERP & Order Management System
   MODULE: RETURN REPORT — service report and returned-items audit for invoices
           whose transaction status is RETURNED.
   ============================================================================== */

let serviceReportInvoiceNo = null;
let auditInvoiceNo = null;
let returnAuditFromReview = false;

const RETURN_CONDITIONS = [
  { value: 'GOOD', label: 'Good', tone: 'good' },
  { value: 'DAMAGED', label: 'Damaged', tone: 'damaged' },
  { value: 'MIXED', label: 'Mixed', tone: 'mixed' },
  { value: 'MISSING', label: 'Not returned', tone: 'missing' }
];

function getInvoiceByNumber(invoiceNo) {
  if (typeof MASTER_INVOICES === 'undefined' || !Array.isArray(MASTER_INVOICES)) return null;
  return MASTER_INVOICES.find(inv => inv.invoiceNo === invoiceNo) || null;
}

function returnReportNumber(invoiceNo) {
  return 'SR-' + String(invoiceNo || '').replace(/^#/, '').replace(/^INV-/, '');
}

function returnConditionMeta(value) {
  return RETURN_CONDITIONS.find(condition => condition.value === value) || RETURN_CONDITIONS[0];
}

/* A line's overall condition is derived from its quantity buckets. */
function returnConditionFromBuckets(goodQty, damagedQty, lostQty) {
  if (damagedQty > 0 && goodQty > 0) return 'MIXED';
  if (damagedQty > 0) return 'DAMAGED';
  if (goodQty > 0) return 'GOOD';
  if (lostQty > 0) return 'MISSING';
  return 'GOOD';
}

/* Normalise a saved audit line from either the current bucket model
   (goodQty / damagedQty) or the legacy single-condition model
   (qtyReturned + condition). Lost units are always derived. */
function returnAuditBuckets(previous, qty) {
  const out = Math.max(0, Number(qty) || 0);
  const source = previous && typeof previous === 'object' ? previous : {};
  const hasBuckets = source.goodQty !== undefined || source.damagedQty !== undefined;

  let good;
  let damaged;

  if (hasBuckets) {
    good = Math.max(0, Number(source.goodQty) || 0);
    damaged = Math.max(0, Number(source.damagedQty) || 0);
  } else {
    const returnedRaw = Number(source.qtyReturned);
    const returned = Number.isFinite(returnedRaw)
      ? Math.max(0, Math.min(out, returnedRaw))
      : out;
    const condition = returnConditionMeta(source.condition).value;
    if (condition === 'DAMAGED') { good = 0; damaged = returned; }
    else if (condition === 'MISSING') { good = 0; damaged = 0; }
    else { good = returned; damaged = 0; }
  }

  good = Math.min(good, out);
  damaged = Math.min(damaged, Math.max(0, out - good));
  const lost = Math.max(0, out - good - damaged);
  return { goodQty: good, damagedQty: damaged, lostQty: lost };
}

/* Split charges into damage vs loss, migrating the legacy single charge. */
function returnAuditCharges(previous) {
  const source = previous && typeof previous === 'object' ? previous : {};
  const hasSplit = source.damageCharge !== undefined || source.lostCharge !== undefined;
  if (hasSplit) {
    return {
      damageCharge: Math.max(0, Number(source.damageCharge) || 0),
      lostCharge: Math.max(0, Number(source.lostCharge) || 0)
    };
  }
  const legacy = Math.max(0, Number(source.charge) || 0);
  const condition = returnConditionMeta(source.condition).value;
  return {
    damageCharge: condition === 'MISSING' ? 0 : legacy,
    lostCharge: condition === 'MISSING' ? legacy : 0
  };
}

function returnMoney(value) {
  return typeof printMoney === 'function'
    ? printMoney(value)
    : `₦ ${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function returnDate(value) {
  return typeof printDate === 'function' ? printDate(value) : String(value || '');
}

function returnTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/* A compact fingerprint of everything the reviewer actually approved.
   If the audit is edited later, the fingerprint no longer matches and the
   approval is treated as stale. */
function returnAuditSignature(report) {
  const parts = [
    String(report.serviceNotes || ''),
    Number(report.lateFee) || 0,
    Number(report.cleaningFee) || 0,
    Number(report.otherAmount) || 0,
    String(report.otherLabel || '')
  ];
  (report.items || []).forEach(item => {
    parts.push([
      String(item.desc || ''),
      Number(item.qty) || 0,
      Number(item.goodQty) || 0,
      Number(item.damagedQty) || 0,
      Number(item.lostQty) || 0,
      Number(item.damageCharge) || 0,
      Number(item.lostCharge) || 0,
      String(item.note || '')
    ].join('|'));
  });
  const text = parts.join('~');
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return `${hash.toString(36)}:${text.length}`;
}

/* The review gate for a returned transaction.
   PENDING  — returned, audit needs a reviewer decision
   APPROVED — reviewer signed off on this exact audit snapshot
   PAID     — deposit payout already recorded
   LOCKED   — transaction is not RETURNED yet
   MISSING  — invoice could not be found */
function returnReviewState(inv) {
  if (!inv) return { status: 'MISSING', refundDue: 0 };
  const report = buildReturnReport(inv);
  if (!report) {
    return { status: inv.status === 'RETURNED' ? 'PENDING' : 'LOCKED', refundDue: 0 };
  }
  return {
    status: report.review.status,
    refundDue: report.review.refundDue,
    balanceDue: report.balanceDue,
    reviewedAt: report.review.reviewedAt || '',
    reviewedBy: report.review.reviewedBy || '',
    notes: report.review.notes || ''
  };
}

/* Merge the invoice with any audit previously saved on the record. */
function buildReturnReport(inv) {
  if (!inv || typeof buildInvoicePrintView !== 'function') return null;
  const base = buildInvoicePrintView(inv);
  const saved = inv.returnReport && typeof inv.returnReport === 'object' ? inv.returnReport : {};
  const savedItems = Array.isArray(saved.items) ? saved.items : [];

  const items = base.items.map((item, index) => {
    const sameIndex = savedItems[index];
    const previous = sameIndex && sameIndex.desc === item.desc
      ? sameIndex
      : (savedItems.find(entry => entry && entry.desc === item.desc) || {});
    const qty = Number(item.qty) || 0;
    const buckets = returnAuditBuckets(previous, qty);
    const charges = returnAuditCharges(previous);
    const qtyReturned = buckets.goodQty + buckets.damagedQty;

    return {
      desc: item.desc,
      qty,
      days: base.days,
      price: Number(item.price) || 0,
      amount: Number(item.amount) || 0,
      goodQty: buckets.goodQty,
      damagedQty: buckets.damagedQty,
      lostQty: buckets.lostQty,
      qtyReturned,
      condition: returnConditionFromBuckets(buckets.goodQty, buckets.damagedQty, buckets.lostQty),
      damageCharge: charges.damageCharge,
      lostCharge: charges.lostCharge,
      charge: charges.damageCharge + charges.lostCharge,
      note: String(previous.note || '')
    };
  });

  const lateFee = Math.max(0, Number(saved.lateFee) || 0);
  const cleaningFee = Math.max(0, Number(saved.cleaningFee) || 0);
  const otherAmount = Math.max(0, Number(saved.otherAmount) || 0);
  const otherLabel = String(saved.otherLabel || '').trim();
  const itemsCharges = items.reduce((sum, item) => sum + item.charge, 0);
  const returnCharges = itemsCharges + lateFee + cleaningFee + otherAmount;
  const deposit = Math.max(0, Number(inv.caution) || 0);
  const parsedRefund = Number(inv.refundAmount);
  const refundPaidAmount = inv.depositStatus === 'REFUNDED'
    ? (Number.isFinite(parsedRefund) && inv.refundAmount !== null && inv.refundAmount !== ''
      ? Math.max(0, parsedRefund)
      : Math.max(0, deposit - returnCharges))
    : 0;
  // After a payout the deposit is no longer "held"; only the portion
  // retained against return charges counts as applied.
  const depositApplied = inv.depositStatus === 'REFUNDED'
    ? Math.max(0, deposit - refundPaidAmount)
    : deposit;
  const balanceDue = Math.max(0, returnCharges - depositApplied);
  const auditSignature = returnAuditSignature({
    serviceNotes: saved.serviceNotes,
    lateFee,
    cleaningFee,
    otherAmount,
    otherLabel,
    items
  });
  const savedReview = inv.returnReview && typeof inv.returnReview === 'object' ? inv.returnReview : null;
  const reviewApproved = Boolean(
    savedReview &&
    savedReview.status === 'APPROVED' &&
    savedReview.auditSignature === auditSignature
  );
  const review = {
    status: inv.status !== 'RETURNED'
      ? 'LOCKED'
      : inv.depositStatus === 'REFUNDED'
        ? 'PAID'
        : reviewApproved ? 'APPROVED' : 'PENDING',
    reviewedAt: reviewApproved ? savedReview.reviewedAt || '' : '',
    reviewedBy: reviewApproved ? savedReview.reviewedBy || '' : '',
    notes: reviewApproved ? String(savedReview.notes || '') : '',
    refundDue: reviewApproved
      ? Math.max(0, Number(savedReview.refundDue) || 0)
      : Math.max(0, depositApplied - returnCharges)
  };

  return {
    kind: 'report',
    invoiceNo: inv.invoiceNo,
    number: returnReportNumber(inv.invoiceNo),
    customer: base.customerName,
    phone: base.phone,
    email: base.email,
    customerAddress: base.customerAddress,
    deliveryAddress: base.deliveryAddress,
    issued: base.issued,
    inspectedOn: inv.returnedAt || inv.returnDate || base.endDate || base.issued,
    status: inv.status,
    startDate: base.startDate,
    endDate: base.endDate,
    periodKnown: base.periodKnown,
    days: base.days,
    items,
    serviceNotes: String(saved.serviceNotes || ''),
    lateFee,
    cleaningFee,
    otherAmount,
    otherLabel,
    itemsCharges,
    returnCharges,
    originalTotal: base.total,
    deposit,
    depositApplied,
    depositStatus: inv.depositStatus || 'N/A',
    refundPaidAmount,
    refundedAt: inv.refundedAt || '',
    refundedBy: inv.refundedBy || '',
    refundBank: inv.refundBank || null,
    payoutAdjustment: inv.payoutAdjustment || null,
    balanceDue,
    auditLocked: inv.depositStatus === 'REFUNDED',
    recordedAt: saved.recordedAt || '',
    auditSignature,
    review
  };
}

function returnFinance(report) {
  const refundPaid = report.depositStatus === 'REFUNDED'
    ? Math.max(0, Number(report.refundPaidAmount) || 0)
    : 0;
  const depositApplied = report.depositStatus === 'REFUNDED'
    ? Math.max(0, Number(report.deposit) - refundPaid)
    : Number(report.deposit) || 0;
  const net = report.returnCharges - depositApplied;
  return {
    depositApplied,
    depositRefunded: report.depositStatus === 'REFUNDED',
    refundPaid,
    net,
    direction: net > 0 ? 'due' : net < 0 ? 'refund' : 'settled'
  };
}

function returnBalanceDue(inv) {
  const report = buildReturnReport(inv);
  if (!report) return 0;
  const finance = returnFinance(report);
  return finance.direction === 'due' ? finance.net : 0;
}

function returnServiceSummary(report) {
  if (report.serviceNotes) return report.serviceNotes;

  const count = report.items.length;
  const period = report.periodKnown
    ? ` for the hire period ${printDateRange(report.startDate, report.endDate)} (${report.days} ${report.days === 1 ? 'day' : 'days'})`
    : '';
  const place = report.deliveryAddress ? ` at ${report.deliveryAddress}` : '';
  const issues = report.items.some(item =>
    item.damagedQty > 0 || item.lostQty > 0 || item.charge > 0
  ) || report.returnCharges > 0;

  return `${count} ${count === 1 ? 'line item was' : 'line items were'} supplied${period}${place} and returned on ${returnDate(report.inspectedOn) || 'the recorded return date'}. `
    + `The items were checked against the quantities issued. `
    + (issues
      ? 'The condition of the returned items and any resulting charges are recorded in this report.'
      : 'All items were returned in good condition with no additional charges.');
}

/* Compact read-only evidence table shown inside the review modal so the
   reviewer can actually see the audit before ticking the checklist. */
function returnReviewAuditMarkup(report) {
  if (!report || !Array.isArray(report.items) || report.items.length === 0) {
    return '<div class="review-audit-empty">No line items were recorded for this transaction.</div>';
  }

  const totals = report.items.reduce((acc, item) => {
    acc.out += item.qty;
    acc.good += item.goodQty;
    acc.damaged += item.damagedQty;
    acc.lost += item.lostQty;
    acc.charge += item.charge;
    return acc;
  }, { out: 0, good: 0, damaged: 0, lost: 0, charge: 0 });

  const rows = report.items.map((item, index) => {
    const flagged = item.damagedQty > 0 || item.lostQty > 0 || item.charge > 0;
    return `
      <tr class="${flagged ? 'ra-flagged' : ''}">
        <td>
          <div class="ra-item"><span class="ra-no">${index + 1}</span>${escapeHtml(item.desc) || '—'}</div>
          ${item.note ? `<div class="ra-note">${escapeHtml(item.note)}</div>` : ''}
        </td>
        <td class="ra-num">${item.qty.toLocaleString('en-NG')}</td>
        <td class="ra-num">${item.goodQty.toLocaleString('en-NG')}</td>
        <td class="ra-num ${item.damagedQty ? 'ra-damaged' : ''}">${item.damagedQty.toLocaleString('en-NG')}</td>
        <td class="ra-num ${item.lostQty ? 'ra-short' : ''}">${item.lostQty.toLocaleString('en-NG')}</td>
        <td class="ra-num">${item.charge > 0 ? returnMoney(item.charge) : '—'}</td>
      </tr>`;
  }).join('');

  return `
    <div class="review-audit-head">
      <span class="review-audit-title">🔍 Returned-items audit</span>
      <span class="review-audit-meta">${report.items.length} item${report.items.length === 1 ? '' : 's'} · ${totals.damaged} damaged · ${totals.lost} lost</span>
    </div>
    <div class="review-audit-scroll">
      <table class="review-audit-table">
        <thead>
          <tr>
            <th>Item</th>
            <th class="ra-num">Out</th>
            <th class="ra-num">Good</th>
            <th class="ra-num">Damaged</th>
            <th class="ra-num">Lost</th>
            <th class="ra-num">Cost</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td>Totals</td>
            <td class="ra-num">${totals.out.toLocaleString('en-NG')}</td>
            <td class="ra-num">${totals.good.toLocaleString('en-NG')}</td>
            <td class="ra-num">${totals.damaged.toLocaleString('en-NG')}</td>
            <td class="ra-num">${totals.lost.toLocaleString('en-NG')}</td>
            <td class="ra-num">${totals.charge > 0 ? returnMoney(totals.charge) : '—'}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

function returnReportMarkup(report) {
  const companyMeta = typeof printCompanyMeta === 'function' ? printCompanyMeta() : [];
  const logoUrl = typeof PRINT_COMPANY !== 'undefined'
    ? new URL(PRINT_COMPANY.logo, location.href).href
    : '';
  const companyName = typeof PRINT_COMPANY !== 'undefined' ? PRINT_COMPANY.name : 'Kitchenware Rentals Ltd';
  const contactLine = [report.phone, report.email].filter(Boolean).join(' · ');
  const finance = returnFinance(report);
  const periodLine = report.periodKnown
    ? `${printDateRange(report.startDate, report.endDate)} · ${report.days} ${report.days === 1 ? 'day' : 'days'}`
    : `${report.days} ${report.days === 1 ? 'day' : 'days'}`;
  const generated = returnTimestamp(report.recordedAt);

  const serviceRows = report.items.length
    ? report.items.map((item, index) => `
        <tr>
          <td class="rr-col-no">${index + 1}</td>
          <td>${escapeHtml(item.desc) || '—'}</td>
          <td class="rr-num">${item.qty.toLocaleString('en-NG')}</td>
          <td class="rr-num">${item.days}</td>
          <td class="rr-num">${returnMoney(item.price)}</td>
          <td class="rr-num rr-strong">${returnMoney(item.amount)}</td>
        </tr>`).join('')
    : '<tr><td colspan="6" class="rr-empty">No line items recorded on this invoice.</td></tr>';

  const auditTotals = report.items.reduce((acc, item) => {
    acc.out += item.qty;
    acc.good += item.goodQty;
    acc.damaged += item.damagedQty;
    acc.lost += item.lostQty;
    acc.charge += item.charge;
    return acc;
  }, { out: 0, good: 0, damaged: 0, lost: 0, charge: 0 });

  const auditRows = report.items.length
    ? report.items.map((item, index) => {
        const cost = item.charge > 0
          ? `<div class="rr-strong">${returnMoney(item.charge)}</div>
             <div class="rr-cost-split">
               ${item.damageCharge > 0 ? `<span>Dmg ${returnMoney(item.damageCharge)}</span>` : ''}
               ${item.lostCharge > 0 ? `<span>Lost ${returnMoney(item.lostCharge)}</span>` : ''}
             </div>`
          : '—';
        return `
          <tr>
            <td class="rr-col-no">${index + 1}</td>
            <td>${escapeHtml(item.desc) || '—'}</td>
            <td class="rr-num">${item.qty.toLocaleString('en-NG')}</td>
            <td class="rr-num">${item.goodQty.toLocaleString('en-NG')}</td>
            <td class="rr-num${item.damagedQty ? ' rr-short' : ''}">${item.damagedQty.toLocaleString('en-NG')}</td>
            <td class="rr-num${item.lostQty ? ' rr-short' : ''}">${item.lostQty.toLocaleString('en-NG')}</td>
            <td class="rr-num">${cost}</td>
            <td>${escapeHtml(item.note) || '—'}</td>
          </tr>`;
      }).join('')
    : '<tr><td colspan="8" class="rr-empty">No items were recorded for this transaction.</td></tr>';

  const otherLabel = report.otherLabel || 'Other charges';

  return `
    <div class="rr-doc">
      <header class="rr-head">
        <div class="rr-brand">
          ${logoUrl ? `<img class="rr-logo" src="${escapeHtml(logoUrl)}" alt="" />` : ''}
          <div>
            <div class="rr-company">${escapeHtml(companyName)}</div>
            <div class="rr-tagline">Service &amp; return documentation</div>
            ${companyMeta.length ? `<div class="rr-company-meta">${companyMeta.map(escapeHtml).join(' · ')}</div>` : ''}
          </div>
        </div>
        <div class="rr-doc-meta">
          <div class="rr-kind">Service &amp; return report</div>
          <div class="rr-no">${escapeHtml(report.number)}</div>
          <div class="rr-meta-row"><span>Report date</span><strong>${escapeHtml(returnDate(report.recordedAt) || returnDate(new Date()))}</strong></div>
          <div class="rr-meta-row"><span>Invoice</span><strong>${escapeHtml(report.invoiceNo)}</strong></div>
        </div>
      </header>

      <div class="rr-band">
        <span>Returned-items inspection</span>
        <span>Status: <strong>Returned</strong></span>
        <span>Inspected: <strong>${escapeHtml(returnDate(report.inspectedOn)) || '—'}</strong></span>
      </div>

      ${report.review.status === 'APPROVED'
        ? `<div class="rr-review rr-review-approved">
            <strong>✓ Return approved</strong>
            <span>by ${escapeHtml(report.review.reviewedBy) || 'authorised reviewer'} on ${escapeHtml(returnTimestamp(report.review.reviewedAt)) || '—'} · Approved refund: ${returnMoney(report.review.refundDue)}</span>
          </div>`
        : report.review.status === 'PAID'
          ? `<div class="rr-review rr-review-paid">
              <strong>✅ Deposit refunded</strong>
              <span>${report.refundPaidAmount > 0
                ? `Refund paid: ${returnMoney(report.refundPaidAmount)}`
                : 'No refund was paid'}${report.refundBank && report.refundBank.bankName ? ` · ${escapeHtml(report.refundBank.bankName)}${report.refundBank.accountNumber ? ' · ' + escapeHtml(report.refundBank.accountNumber) : ''}` : ''}${report.refundedAt ? ` on ${escapeHtml(returnTimestamp(report.refundedAt))}` : ''}. The audit below is locked as the record used for the payout.</span>
              ${report.payoutAdjustment
                ? `<span class="rr-adjust">Adjusted from approved ${returnMoney(report.payoutAdjustment.approvedAmount)} — ${escapeHtml(report.payoutAdjustment.reason || 'no reason recorded')}.</span>`
                : ''}
            </div>`
          : report.review.status === 'PENDING'
            ? `<div class="rr-review rr-review-pending">
                <strong>⏳ Review pending</strong>
                <span>This return must be approved before any deposit payout can be initiated.</span>
              </div>`
            : ''}

      ${report.balanceDue > 0
        ? `<div class="rr-review rr-review-due">
            <strong>⚠ Balance payable: ${returnMoney(report.balanceDue)}</strong>
            <span>This amount is not covered by the caution deposit and remains outstanding.</span>
          </div>`
        : ''}

      <section class="rr-parties">
        <div class="rr-party">
          <div class="rr-label">Customer</div>
          <div class="rr-party-name">${escapeHtml(report.customer) || '—'}</div>
          ${contactLine ? `<div class="rr-party-line">${escapeHtml(contactLine)}</div>` : ''}
          ${report.customerAddress ? `<div class="rr-party-line">${escapeHtml(report.customerAddress)}</div>` : ''}
        </div>
        <div class="rr-party">
          <div class="rr-label">Hire &amp; return details</div>
          <div class="rr-party-line"><strong>Period:</strong> ${escapeHtml(periodLine)}</div>
          ${report.deliveryAddress ? `<div class="rr-party-line"><strong>Service address:</strong> ${escapeHtml(report.deliveryAddress)}</div>` : ''}
          <div class="rr-party-line"><strong>Invoice issued:</strong> ${escapeHtml(returnDate(report.issued)) || '—'}</div>
          <div class="rr-party-line"><strong>Returned:</strong> ${escapeHtml(returnDate(report.inspectedOn)) || '—'}</div>
        </div>
      </section>

      <section class="rr-block">
        <h3 class="rr-h">Service rendered</h3>
        <p class="rr-text">${escapeHtml(returnServiceSummary(report))}</p>
        <table class="rr-table rr-items">
          <thead>
            <tr>
              <th class="rr-col-no">#</th>
              <th>Item supplied</th>
              <th class="rr-num">Qty</th>
              <th class="rr-num">Days</th>
              <th class="rr-num">Rate / day</th>
              <th class="rr-num">Rental charge</th>
            </tr>
          </thead>
          <tbody>${serviceRows}</tbody>
        </table>
      </section>

      <section class="rr-block">
        <h3 class="rr-h">Returned items audit</h3>
        <table class="rr-table">
          <thead>
            <tr>
              <th class="rr-col-no">#</th>
              <th>Item returned</th>
              <th class="rr-num">Out</th>
              <th class="rr-num">Good</th>
              <th class="rr-num">Damaged</th>
              <th class="rr-num">Lost</th>
              <th class="rr-num">Charges</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>${auditRows}</tbody>
          ${report.items.length
            ? `<tfoot>
                <tr class="rr-audit-total">
                  <td colspan="2">Totals</td>
                  <td class="rr-num">${auditTotals.out.toLocaleString('en-NG')}</td>
                  <td class="rr-num">${auditTotals.good.toLocaleString('en-NG')}</td>
                  <td class="rr-num${auditTotals.damaged ? ' rr-short' : ''}">${auditTotals.damaged.toLocaleString('en-NG')}</td>
                  <td class="rr-num${auditTotals.lost ? ' rr-short' : ''}">${auditTotals.lost.toLocaleString('en-NG')}</td>
                  <td class="rr-num">${auditTotals.charge > 0 ? returnMoney(auditTotals.charge) : '—'}</td>
                  <td></td>
                </tr>
              </tfoot>`
            : ''}
        </table>
        ${report.returnCharges === 0
          ? '<p class="rr-ok">No damage, shortage or extra cost was recorded for this return.</p>'
          : ''}
      </section>

      <section class="rr-block rr-money">
        <div>
          <h3 class="rr-h">Additional charges</h3>
          <table class="rr-totals">
            <tr><th>Damaged / lost items</th><td>${returnMoney(report.itemsCharges)}</td></tr>
            <tr><th>Late return fee</th><td>${returnMoney(report.lateFee)}</td></tr>
            <tr><th>Cleaning / restoration</th><td>${returnMoney(report.cleaningFee)}</td></tr>
            <tr><th>${escapeHtml(otherLabel)}</th><td>${returnMoney(report.otherAmount)}</td></tr>
            <tr class="rr-total"><th>Total return charges</th><td>${returnMoney(report.returnCharges)}</td></tr>
          </table>
        </div>
        <div>
          <h3 class="rr-h">Account summary</h3>
          <table class="rr-totals">
            <tr><th>Original invoice total</th><td>${returnMoney(report.originalTotal)}</td></tr>
            <tr><th>Return charges (this report)</th><td>${returnMoney(report.returnCharges)}</td></tr>
            ${report.deposit > 0
              ? `<tr>
                  <th>Caution deposit ${finance.depositRefunded ? 'applied' : 'held'}</th>
                  <td>${returnMoney(finance.depositApplied)}</td>
                </tr>`
              : ''}
            ${finance.depositRefunded
              ? `<tr><th>Refund paid to customer</th><td>${returnMoney(finance.refundPaid)}</td></tr>`
              : ''}
            <tr class="rr-total">
              <th>${finance.direction === 'due'
                ? 'Balance payable by customer'
                : finance.direction === 'refund'
                  ? 'Deposit refund due to customer'
                  : 'Settled — no balance due'}</th>
              <td>${returnMoney(Math.abs(finance.net))}</td>
            </tr>
          </table>
        </div>
      </section>

      <div class="ps-fill" aria-hidden="true"></div>

      <footer class="rr-foot">
        <div class="rr-sign">
          <div class="rr-sign-line"></div>
          <div class="rr-sign-label">Inspected by / authorised signature</div>
        </div>
        <div class="rr-foot-note">
          ${generated ? `Report generated ${escapeHtml(generated)}<br />` : ''}
          This report records the service rendered and the condition of returned rental items.
          It is not a tax invoice. Additional charges may be settled from the caution deposit or invoiced separately.
        </div>
      </footer>
    </div>`;
}

/* ── REPORT MODAL ────────────────────────────────────────────────────────── */
function renderServiceReport() {
  const inv = getInvoiceByNumber(serviceReportInvoiceNo);
  const body = document.getElementById('serviceReportBody');
  if (!inv || !body) return;

  const report = buildReturnReport(inv);
  if (!report) return;

  const reviewLabel = report.review.status === 'APPROVED'
    ? '✓ Return approved'
    : report.review.status === 'PAID'
      ? '✅ Deposit refunded'
      : report.review.status === 'PENDING'
        ? '⏳ Review pending'
        : '';
  document.getElementById('serviceReportSub').textContent =
    `${inv.invoiceNo} · ${report.customer} · ${report.items.length} ${report.items.length === 1 ? 'item' : 'items'}${reviewLabel ? ' · ' + reviewLabel : ''}`;
  body.innerHTML = returnReportMarkup(report);

  const editBtn = document.querySelector('#serviceReportModal [data-action="edit-return-audit"]');
  if (editBtn) {
    editBtn.disabled = report.auditLocked;
    editBtn.textContent = report.auditLocked ? '🔒 Audit locked' : '✏️ Edit audit';
    editBtn.title = report.auditLocked
      ? 'The audit is locked after the deposit payout'
      : 'Edit the returned-items audit';
  }

  const isAdmin = currentRole === 'super_admin' || currentRole === 'admin';

  const approveBtn = document.getElementById('btnApproveReturn');
  if (approveBtn) {
    const canApprove = report.review.status === 'PENDING' && isAdmin;
    approveBtn.hidden = !canApprove;
    approveBtn.style.display = canApprove ? '' : 'none';
    approveBtn.dataset.invoiceNo = inv.invoiceNo;
  }

  const revokeBtn = document.getElementById('btnRevokeReturn');
  if (revokeBtn) {
    const canRevoke = report.review.status === 'APPROVED' && isAdmin;
    revokeBtn.hidden = !canRevoke;
    revokeBtn.style.display = canRevoke ? '' : 'none';
    revokeBtn.dataset.invoiceNo = inv.invoiceNo;
  }
}

function openServiceReport(invoiceNo) {
  const inv = getInvoiceByNumber(invoiceNo);
  if (!inv) {
    showToast('That invoice could not be found', 'error');
    return;
  }
  if (inv.status !== 'RETURNED') {
    showToast('The service report is available once the invoice is marked RETURNED', 'error');
    return;
  }

  serviceReportInvoiceNo = invoiceNo;
  renderServiceReport();
  const modal = document.getElementById('serviceReportModal');
  if (modal) modal.style.display = 'flex';
}

function closeServiceReport() {
  const modal = document.getElementById('serviceReportModal');
  if (modal) modal.style.display = 'none';
}

/* ── REVIEW GATE ─────────────────────────────────────────────────────────── */
let returnReviewInvoiceNo = null;

function openReturnReview(invoiceNo) {
  if (currentRole !== 'super_admin' && currentRole !== 'admin') {
    showToast('Only Super Admin can approve a return', 'error');
    return;
  }
  const inv = getInvoiceByNumber(invoiceNo || serviceReportInvoiceNo || returnReviewInvoiceNo);
  if (!inv) {
    showToast('Open a returned invoice before reviewing it', 'error');
    return;
  }
  if (inv.status !== 'RETURNED') {
    showToast('Only a RETURNED transaction can be reviewed', 'error');
    return;
  }
  if (inv.depositStatus === 'REFUNDED') {
    showToast('This deposit has already been refunded', 'error');
    return;
  }

  const report = buildReturnReport(inv);
  if (!report) return;
  if (report.review.status === 'APPROVED') {
    showToast('This return is already approved', 'error');
    return;
  }

  returnReviewInvoiceNo = inv.invoiceNo;

  const auditWrap = document.getElementById('returnReviewAudit');
  if (auditWrap) auditWrap.innerHTML = returnReviewAuditMarkup(report);

  const finance = returnFinance(report);
  const refundDue = Math.max(0, finance.depositApplied - report.returnCharges);
  const balanceDue = Math.max(0, report.returnCharges - finance.depositApplied);
  const summary = document.getElementById('returnReviewSummary');
  if (summary) {
    summary.innerHTML = `
      <div class="review-row"><span>Return charges</span><strong>${returnMoney(report.returnCharges)}</strong></div>
      <div class="review-row"><span>Caution deposit held</span><strong>${returnMoney(finance.depositApplied)}</strong></div>
      ${balanceDue > 0
        ? `<div class="review-row review-refund review-due"><span>Balance payable by customer</span><strong>${returnMoney(balanceDue)}</strong></div>
           <p class="review-note">The deposit is fully consumed. Approving records a nil refund, and the balance above stays flagged as outstanding.</p>`
        : `<div class="review-row review-refund"><span>Refund due to customer</span><strong>${returnMoney(refundDue)}</strong></div>
           <p class="review-note">${refundDue > 0
             ? 'Approving locks this refund amount as the default payout. A different amount can still be paid with a recorded reason.'
             : 'No refund is due. Approving closes the payout as a nil refund.'}</p>`}`;
  }

  const intro = document.getElementById('returnReviewIntro');
  if (intro) {
    intro.innerHTML = `Check the audit evidence for <strong>${escapeHtml(inv.invoiceNo)}</strong> · ${escapeHtml(report.customer || 'Customer')}, then confirm the checklist below. Approving records the evidence used for the deposit payout.`;
  }

  ['reviewCheckItems', 'reviewCheckCharges', 'reviewCheckRefund'].forEach(id => {
    const box = document.getElementById(id);
    if (box) box.checked = false;
  });
  const notes = document.getElementById('reviewNotes');
  if (notes) notes.value = '';

  const modal = document.getElementById('returnReviewModal');
  if (modal) modal.style.display = 'flex';
}

function closeReturnReview() {
  const modal = document.getElementById('returnReviewModal');
  if (modal) modal.style.display = 'none';
}

function approveReturnReview() {
  if (currentRole !== 'super_admin' && currentRole !== 'admin') {
    showToast('Only Super Admin can approve a return', 'error');
    return;
  }
  const inv = getInvoiceByNumber(returnReviewInvoiceNo || serviceReportInvoiceNo);
  if (!inv) {
    showToast('That invoice could not be found', 'error');
    return;
  }

  const boxes = ['reviewCheckItems', 'reviewCheckCharges', 'reviewCheckRefund']
    .map(id => document.getElementById(id));
  if (boxes.some(box => !box || !box.checked)) {
    showToast('Complete the review checklist before approving', 'error');
    return;
  }

  const report = buildReturnReport(inv);
  if (!report) return;
  const finance = returnFinance(report);
  const refundDue = Math.max(0, finance.depositApplied - report.returnCharges);

  inv.returnReview = {
    status: 'APPROVED',
    reviewedAt: new Date().toISOString(),
    reviewedBy: currentUser?.email || currentRole,
    notes: (document.getElementById('reviewNotes')?.value || '').trim(),
    returnCharges: report.returnCharges,
    depositApplied: finance.depositApplied,
    refundDue,
    auditSignature: report.auditSignature
  };
  inv.refundAmount = refundDue;

  const balanceDue = Math.max(0, report.returnCharges - finance.depositApplied);

  persistMasterInvoices();
  closeReturnReview();
  if (serviceReportInvoiceNo === inv.invoiceNo) renderServiceReport();
  if (typeof renderDepositsTable === 'function') renderDepositsTable();
  if (typeof renderAllInvoicesTable === 'function') renderAllInvoicesTable(MASTER_INVOICES);
  showToast(
    balanceDue > 0
      ? `Return approved for ${inv.invoiceNo} — no refund due; ${returnMoney(balanceDue)} balance remains payable`
      : `Return approved for ${inv.invoiceNo} — refund due ${returnMoney(refundDue)}`,
    'success'
  );
}

/* ── REVOKE APPROVAL ─────────────────────────────────────────────────────── */
let returnRevokeInvoiceNo = null;

function openReturnRevoke(invoiceNo) {
  if (currentRole !== 'super_admin' && currentRole !== 'admin') {
    showToast('Only Super Admin can revoke a return approval', 'error');
    return;
  }
  const inv = getInvoiceByNumber(invoiceNo || serviceReportInvoiceNo || returnRevokeInvoiceNo);
  if (!inv) {
    showToast('Open a returned invoice before revoking its approval', 'error');
    return;
  }
  if (inv.status !== 'RETURNED') {
    showToast('Only a RETURNED transaction can be revoked', 'error');
    return;
  }
  if (inv.depositStatus === 'REFUNDED') {
    showToast('This deposit has already been paid out — the approval cannot be revoked', 'error');
    return;
  }
  const report = buildReturnReport(inv);
  if (!report || report.review.status !== 'APPROVED') {
    showToast('This return is not currently approved', 'error');
    return;
  }

  returnRevokeInvoiceNo = inv.invoiceNo;
  const intro = document.getElementById('returnRevokeIntro');
  if (intro) {
    intro.innerHTML = `Revoke the approval for <strong>${escapeHtml(inv.invoiceNo)}</strong> · ${escapeHtml(report.customer || 'Customer')}. The payout will lock again until the return is reviewed and approved once more.`;
  }
  const reason = document.getElementById('returnRevokeReason');
  if (reason) reason.value = '';

  const modal = document.getElementById('returnRevokeModal');
  if (modal) modal.style.display = 'flex';
  reason?.focus();
}

function closeReturnRevoke() {
  const modal = document.getElementById('returnRevokeModal');
  if (modal) modal.style.display = 'none';
}

function revokeReturnApproval() {
  if (currentRole !== 'super_admin' && currentRole !== 'admin') {
    showToast('Only Super Admin can revoke a return approval', 'error');
    return;
  }
  const inv = getInvoiceByNumber(returnRevokeInvoiceNo || serviceReportInvoiceNo);
  if (!inv) {
    showToast('That invoice could not be found', 'error');
    return;
  }
  if (inv.depositStatus === 'REFUNDED') {
    showToast('This deposit has already been paid out', 'error');
    return;
  }
  if (!inv.returnReview || inv.returnReview.status !== 'APPROVED') {
    showToast('This return is not currently approved', 'error');
    return;
  }

  const reason = (document.getElementById('returnRevokeReason')?.value || '').trim();
  if (reason.length < 3) {
    showToast('Add a reason for revoking the approval', 'error');
    document.getElementById('returnRevokeReason')?.focus();
    return;
  }

  const previous = inv.returnReview;
  inv.reviewRevocations = [
    ...(Array.isArray(inv.reviewRevocations) ? inv.reviewRevocations : []),
    {
      at: new Date().toISOString(),
      by: currentUser?.email || currentRole,
      reason,
      previous: {
        reviewedAt: previous.reviewedAt || '',
        reviewedBy: previous.reviewedBy || '',
        notes: previous.notes || '',
        returnCharges: Number(previous.returnCharges) || 0,
        refundDue: Number(previous.refundDue) || 0,
        auditSignature: previous.auditSignature || ''
      }
    }
  ];
  delete inv.returnReview;
  delete inv.refundAmount;

  persistMasterInvoices();
  closeReturnRevoke();
  if (serviceReportInvoiceNo === inv.invoiceNo) renderServiceReport();
  if (typeof renderDepositsTable === 'function') renderDepositsTable();
  if (typeof renderAllInvoicesTable === 'function') renderAllInvoicesTable(MASTER_INVOICES);
  showToast(`Approval revoked for ${inv.invoiceNo} — return must be reviewed again`, 'success');
}

function syncReturnReportAction(inv) {
  const btn = document.getElementById('btnViewReturnReport');
  if (!btn) return;
  const returned = Boolean(inv) && inv.status === 'RETURNED';
  btn.hidden = !returned;
  btn.dataset.invoiceNo = returned ? inv.invoiceNo : '';
  btn.style.display = returned ? '' : 'none';
}

/* ── RETURN AUDIT FORM ───────────────────────────────────────────────────── */
/* Open the audit editor straight from the review modal. After saving, the
   reviewer is returned to the refreshed review gate. */
function openReturnAuditFromReview() {
  const inv = getInvoiceByNumber(returnReviewInvoiceNo || serviceReportInvoiceNo || auditInvoiceNo);
  if (!inv) {
    showToast('Open a returned invoice before recording an audit', 'error');
    return;
  }
  returnAuditFromReview = true;
  closeReturnReview();
  closeServiceReport();
  openReturnAudit(inv.invoiceNo);
  // If the audit editor refused to open (e.g. settled payout), clear the
  // return-to-review flag so the next save does not jump unexpectedly.
  if (document.getElementById('returnAuditModal')?.style.display !== 'flex') {
    returnAuditFromReview = false;
  }
}

function openReturnAudit(invoiceNo) {
  const inv = getInvoiceByNumber(invoiceNo || serviceReportInvoiceNo || auditInvoiceNo);
  if (!inv) {
    showToast('Open a returned invoice before recording an audit', 'error');
    return;
  }
  if (inv.status !== 'RETURNED') {
    showToast('The return audit is available once the invoice is marked RETURNED', 'error');
    return;
  }
  if (inv.depositStatus === 'REFUNDED') {
    showToast('This return is settled — the audit is locked after payout', 'error');
    return;
  }

  auditInvoiceNo = inv.invoiceNo;
  const report = buildReturnReport(inv);
  if (!report) return;

  document.getElementById('returnAuditSub').textContent =
    `${inv.invoiceNo} · ${report.customer} · record damages, shortages and extra costs`;

  const tbody = document.getElementById('returnAuditItemsBody');
  tbody.innerHTML = report.items.length
    ? report.items.map((item, index) => `
        <tr data-audit-index="${index}" data-audit-qty="${item.qty}">
          <td class="audit-row-no">${index + 1}</td>
          <td>
            <div class="audit-item-name">${escapeHtml(item.desc) || '—'}</div>
            <div class="audit-muted">${returnMoney(item.price)} / day · ${item.days} ${item.days === 1 ? 'day' : 'days'}</div>
            <div class="audit-row-status" data-role="status"></div>
          </td>
          <td class="audit-num">${item.qty.toLocaleString('en-NG')}</td>
          <td><input type="number" class="audit-good" min="0" max="${item.qty}" step="1" value="${item.goodQty}" aria-label="Good units of ${escapeHtml(item.desc)}" /></td>
          <td><input type="number" class="audit-damaged" min="0" max="${item.qty}" step="1" value="${item.damagedQty}" aria-label="Damaged units of ${escapeHtml(item.desc)}" /></td>
          <td class="audit-lost-cell"><span class="audit-lost" data-role="lost">${item.lostQty}</span></td>
          <td><input type="number" class="audit-damage-charge" min="0" step="0.01" value="${item.damageCharge || ''}" placeholder="0.00" aria-label="Damage charge for ${escapeHtml(item.desc)}" /></td>
          <td><input type="number" class="audit-lost-charge" min="0" step="0.01" value="${item.lostCharge || ''}" placeholder="0.00" aria-label="Loss charge for ${escapeHtml(item.desc)}" /></td>
          <td><input type="text" class="audit-note" maxlength="120" value="${escapeHtml(item.note)}" placeholder="e.g. 2 chipped rims" aria-label="Remarks for ${escapeHtml(item.desc)}" /></td>
        </tr>`).join('')
    : '<tr><td colspan="9" class="rr-empty">No items were recorded for this transaction.</td></tr>';

  document.getElementById('auditLateFee').value = report.lateFee || '';
  document.getElementById('auditCleaningFee').value = report.cleaningFee || '';
  document.getElementById('auditOtherLabel').value = report.otherLabel;
  document.getElementById('auditOtherAmount').value = report.otherAmount || '';
  document.getElementById('auditServiceNotes').value = report.serviceNotes;

  updateReturnAuditPreview();

  const modal = document.getElementById('returnAuditModal');
  if (modal) modal.style.display = 'flex';
}

function closeReturnAudit() {
  returnAuditFromReview = false;
  const modal = document.getElementById('returnAuditModal');
  if (modal) modal.style.display = 'none';
}

function readReturnAuditForm(report) {
  const rows = [...document.querySelectorAll('#returnAuditItemsBody tr[data-audit-index]')];
  const items = rows.map((row, index) => {
    const base = report.items[index] || {};
    const qty = Math.max(0, Number(base.qty) || 0);
    const goodInput = parseFloat(row.querySelector('.audit-good')?.value);
    const damagedInput = parseFloat(row.querySelector('.audit-damaged')?.value);
    const goodQty = Number.isFinite(goodInput) ? Math.max(0, goodInput) : 0;
    const damagedQty = Number.isFinite(damagedInput) ? Math.max(0, damagedInput) : 0;
    const allocated = goodQty + damagedQty;
    const overQty = Math.max(0, allocated - qty);
    const lostQty = Math.max(0, qty - allocated);
    const damageCharge = Math.max(0, Number(parseFloat(row.querySelector('.audit-damage-charge')?.value)) || 0);
    const lostCharge = Math.max(0, Number(parseFloat(row.querySelector('.audit-lost-charge')?.value)) || 0);
    return {
      desc: base.desc || '',
      qty,
      goodQty,
      damagedQty,
      lostQty,
      overQty,
      qtyReturned: Math.min(qty, allocated),
      condition: returnConditionFromBuckets(Math.min(goodQty, qty), Math.min(damagedQty, Math.max(0, qty - Math.min(goodQty, qty))), lostQty),
      damageCharge,
      lostCharge,
      charge: damageCharge + lostCharge,
      note: (row.querySelector('.audit-note')?.value || '').trim()
    };
  });

  const lateFee = Math.max(0, parseFloat(document.getElementById('auditLateFee')?.value) || 0);
  const cleaningFee = Math.max(0, parseFloat(document.getElementById('auditCleaningFee')?.value) || 0);
  const otherAmount = Math.max(0, parseFloat(document.getElementById('auditOtherAmount')?.value) || 0);
  const otherLabel = (document.getElementById('auditOtherLabel')?.value || '').trim();
  const serviceNotes = (document.getElementById('auditServiceNotes')?.value || '').trim();

  return { items, lateFee, cleaningFee, otherAmount, otherLabel, serviceNotes };
}

function updateReturnAuditPreview() {
  const preview = document.getElementById('returnAuditPreview');
  const inv = getInvoiceByNumber(auditInvoiceNo);
  if (!preview || !inv) return;
  const report = buildReturnReport(inv);
  if (!report) return;

  const values = readReturnAuditForm(report);
  const rows = [...document.querySelectorAll('#returnAuditItemsBody tr[data-audit-index]')];

  // Per-row reconciliation: show the derived lost quantity and flag any row
  // whose Good + Damaged exceeds the quantity issued.
  const totals = values.items.reduce((acc, item) => {
    acc.out += item.qty;
    acc.good += item.goodQty;
    acc.damaged += item.damagedQty;
    acc.lost += item.lostQty;
    acc.damageCharge += item.damageCharge;
    acc.lostCharge += item.lostCharge;
    return acc;
  }, { out: 0, good: 0, damaged: 0, lost: 0, damageCharge: 0, lostCharge: 0 });

  rows.forEach((row, index) => {
    const item = values.items[index];
    if (!item) return;
    const lostCell = row.querySelector('.audit-lost');
    const statusCell = row.querySelector('[data-role="status"]');
    const over = item.overQty > 0;

    row.classList.toggle('audit-row-over', over);
    if (lostCell) {
      lostCell.textContent = over ? `+${item.overQty}` : item.lostQty.toLocaleString('en-NG');
      lostCell.classList.toggle('is-lost', !over && item.lostQty > 0);
      lostCell.classList.toggle('is-over', over);
    }
    if (statusCell) {
      statusCell.textContent = over
        ? `⚠ ${item.overQty} more than out`
        : item.lostQty > 0
          ? `⚠ ${item.lostQty} not returned`
          : '✓ Fully accounted for';
      statusCell.className = `audit-row-status ${over ? 'is-over' : item.lostQty > 0 ? 'is-lost' : 'is-ok'}`;
    }
  });

  const overRows = values.items.filter(item => item.overQty > 0);
  const totalOut = document.getElementById('auditTotalOut');
  const totalGood = document.getElementById('auditTotalGood');
  const totalDamaged = document.getElementById('auditTotalDamaged');
  const totalLost = document.getElementById('auditTotalLost');
  const totalDamage = document.getElementById('auditTotalDamageCharge');
  const totalLostCharge = document.getElementById('auditTotalLostCharge');
  const totalsFlag = document.getElementById('auditTotalsFlag');
  if (totalOut) totalOut.textContent = totals.out.toLocaleString('en-NG');
  if (totalGood) totalGood.textContent = totals.good.toLocaleString('en-NG');
  if (totalDamaged) totalDamaged.textContent = totals.damaged.toLocaleString('en-NG');
  if (totalLost) totalLost.textContent = totals.lost.toLocaleString('en-NG');
  if (totalDamage) totalDamage.textContent = totals.damageCharge > 0 ? returnMoney(totals.damageCharge) : '—';
  if (totalLostCharge) totalLostCharge.textContent = totals.lostCharge > 0 ? returnMoney(totals.lostCharge) : '—';
  if (totalsFlag) {
    totalsFlag.textContent = overRows.length
      ? `⚠ ${overRows.length} row${overRows.length === 1 ? '' : 's'} over-allocated`
      : totals.lost > 0
        ? `${totals.lost} unit${totals.lost === 1 ? '' : 's'} not returned`
        : '✓ All units accounted for';
    totalsFlag.className = `audit-totals-flag ${overRows.length ? 'is-over' : totals.lost > 0 ? 'is-lost' : 'is-ok'}`;
  }

  const itemsCharges = values.items.reduce((sum, item) => sum + item.charge, 0);
  const returnCharges = itemsCharges + values.lateFee + values.cleaningFee + values.otherAmount;
  const finance = returnFinance({
    ...report,
    returnCharges
  });

  const balanceText = finance.direction === 'due'
    ? 'Balance payable'
    : finance.direction === 'refund'
      ? 'Deposit refund due'
      : 'Balance';

  preview.innerHTML = `
    ${overRows.length
      ? `<div class="audit-preview-warn">⚠ Good + Damaged exceeds the quantity out for ${overRows.map(item => escapeHtml(item.desc)).join(', ')}. Reduce the buckets before saving.</div>`
      : ''}
    <div><span>Units returned (good / damaged / lost)</span><strong>${totals.good} / ${totals.damaged} / ${totals.lost}</strong></div>
    <div><span>Return charges</span><strong>${returnMoney(returnCharges)}</strong></div>
    <div><span>Caution deposit ${finance.depositRefunded ? '(refunded)' : 'held'}</span><strong>${returnMoney(finance.depositApplied)}</strong></div>
    <div class="${finance.direction}"><span>${balanceText}</span><strong>${returnMoney(Math.abs(finance.net))}</strong></div>`;
}

function saveReturnAudit() {
  const inv = getInvoiceByNumber(auditInvoiceNo);
  if (!inv) {
    showToast('That invoice could not be found', 'error');
    return;
  }
  if (inv.depositStatus === 'REFUNDED') {
    showToast('This return is settled — the audit is locked after payout', 'error');
    closeReturnAudit();
    return;
  }
  const report = buildReturnReport(inv);
  if (!report) return;

  const values = readReturnAuditForm(report);

  const overRows = values.items.filter(item => item.overQty > 0);
  if (overRows.length > 0) {
    const names = overRows.map(item => item.desc || 'item').join(', ');
    showToast(`Cannot save — Good + Damaged exceeds the quantity out for ${names}`, 'error');
    return;
  }

  // Persist only the reviewed evidence; lost quantity and condition are
  // always derived from the buckets so they cannot drift out of sync.
  inv.returnReport = {
    recordedAt: new Date().toISOString(),
    serviceNotes: values.serviceNotes,
    items: values.items.map(item => ({
      desc: item.desc,
      goodQty: item.goodQty,
      damagedQty: item.damagedQty,
      damageCharge: item.damageCharge,
      lostCharge: item.lostCharge,
      note: item.note
    })),
    lateFee: values.lateFee,
    cleaningFee: values.cleaningFee,
    otherAmount: values.otherAmount,
    otherLabel: values.otherLabel
  };
  if (!inv.returnedAt) inv.returnedAt = new Date().toISOString();

  // Editing the evidence invalidates any earlier sign-off, so the payout
  // cannot ride on numbers the reviewer never saw.
  const hadApproval = Boolean(inv.returnReview && inv.returnReview.status === 'APPROVED');
  if (hadApproval) {
    delete inv.returnReview;
    if (inv.depositStatus !== 'REFUNDED') delete inv.refundAmount;
  }

  const fromReview = returnAuditFromReview;
  persistMasterInvoices();
  closeReturnAudit();
  if (serviceReportInvoiceNo === inv.invoiceNo) renderServiceReport();
  syncReturnReportAction(inv);
  if (typeof renderDepositsTable === 'function') renderDepositsTable();

  // Came from the review gate: reopen it with the updated evidence so the
  // reviewer can confirm the checklist against what they just saved.
  if (fromReview) {
    openReturnReview(inv.invoiceNo);
  }

  showToast(
    hadApproval
      ? `Return audit saved for ${inv.invoiceNo} — previous approval reset`
      : `Return audit saved for ${inv.invoiceNo}`,
    'success'
  );
}

/* ── PRINT ───────────────────────────────────────────────────────────────── */
function printServiceReport() {
  const inv = getInvoiceByNumber(serviceReportInvoiceNo);
  if (!inv) {
    showToast('Open a return report before printing', 'error');
    return;
  }
  const report = buildReturnReport(inv);
  if (!report) return;

  const title = [report.number, report.customer].filter(Boolean).join(' — ');
  if (typeof printCustomDocument === 'function') {
    printCustomDocument(returnReportMarkup(report), title);
  } else {
    window.print();
  }
}

/* ── MODAL WIRING ────────────────────────────────────────────────────────── */
function initReturnReportModals() {
  const reportModal = document.getElementById('serviceReportModal');
  const auditModal = document.getElementById('returnAuditModal');
  const reviewModal = document.getElementById('returnReviewModal');
  const revokeModal = document.getElementById('returnRevokeModal');

  reportModal?.addEventListener('click', (event) => {
    if (event.target === reportModal) closeServiceReport();
  });
  auditModal?.addEventListener('click', (event) => {
    if (event.target === auditModal) closeReturnAudit();
  });
  reviewModal?.addEventListener('click', (event) => {
    if (event.target === reviewModal) closeReturnReview();
  });
  revokeModal?.addEventListener('click', (event) => {
    if (event.target === revokeModal) closeReturnRevoke();
  });

  auditModal?.addEventListener('input', updateReturnAuditPreview);
  auditModal?.addEventListener('change', updateReturnAuditPreview);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (revokeModal && revokeModal.style.display === 'flex') {
      closeReturnRevoke();
    } else if (reviewModal && reviewModal.style.display === 'flex') {
      closeReturnReview();
    } else if (auditModal && auditModal.style.display === 'flex') {
      closeReturnAudit();
    } else if (reportModal && reportModal.style.display === 'flex') {
      closeServiceReport();
    }
  });
}

initReturnReportModals();

window.openServiceReport = openServiceReport;
window.closeServiceReport = closeServiceReport;
window.renderServiceReport = renderServiceReport;
window.printServiceReport = printServiceReport;
window.openReturnAudit = openReturnAudit;
window.openReturnAuditFromReview = openReturnAuditFromReview;
window.closeReturnAudit = closeReturnAudit;
window.saveReturnAudit = saveReturnAudit;
window.syncReturnReportAction = syncReturnReportAction;
window.returnReviewState = returnReviewState;
window.returnBalanceDue = returnBalanceDue;
window.openReturnReview = openReturnReview;
window.closeReturnReview = closeReturnReview;
window.approveReturnReview = approveReturnReview;
window.openReturnRevoke = openReturnRevoke;
window.closeReturnRevoke = closeReturnRevoke;
window.revokeReturnApproval = revokeReturnApproval;
