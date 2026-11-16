/* ==============================================================================
   Kitchenware Rentals Ltd — Utility Functions & Security Sanitizers
   ============================================================================== */

/**
 * Escapes HTML characters to prevent Stored & Reflected Cross-Site Scripting (XSS).
 * @param {*} str Value to sanitize
 * @returns {string} HTML-escaped string
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a number with commas and 2 decimal places in en-NG locale.
 * @param {number} n
 * @returns {string}
 */
function fmt(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Displays a toast notification in the UI.
 * @param {string} msg 
 * @param {'success'|'error'|''} type 
 * @param {number} durationMs 
 */
function showToast(msg, type = '', durationMs = 3500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show ' + (type || '');
  if (t._toastTimeout) clearTimeout(t._toastTimeout);
  t._toastTimeout = setTimeout(() => {
    t.className = '';
  }, durationMs);
}

/**
 * Debounce helper to prevent excessive function execution on rapid keystrokes.
 * @param {Function} func 
 * @param {number} wait 
 */
function debounce(func, wait = 250) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Converts a numeric amount to English words (e.g. for Nigerian Naira invoices).
 * @param {number} n 
 * @returns {string}
 */
function numWords(n) {
  const num = Math.round(Number(n) || 0);
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
                'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  function cvt(val) {
    if (val === 0) return '';
    if (val < 20) return ones[val] + ' ';
    if (val < 100) return tens[Math.floor(val / 10)] + (val % 10 ? '-' + ones[val % 10] : '') + ' ';
    if (val < 1e3) return (ones[Math.floor(val / 100)] || '') + ' Hundred ' + cvt(val % 100);
    if (val < 1e6) return cvt(Math.floor(val / 1e3)) + 'Thousand ' + cvt(val % 1e3);
    return cvt(Math.floor(val / 1e6)) + 'Million ' + cvt(val % 1e6);
  }
  
  return cvt(num).trim();
}

window.escapeHtml = escapeHtml;
window.fmt = fmt;
window.showToast = showToast;
window.debounce = debounce;
window.numWords = numWords;

/* ==============================================================================
   INLINE FORM VALIDATION
   Field-level errors are rendered next to the offending input instead of only
   as a toast, so users can see what needs correcting after a failed save.
   ============================================================================== */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function fieldErrorHost(el) {
  return el.closest('.field') || el.closest('td') || el.parentElement;
}

function setFieldError(el, message) {
  if (!el) return;
  const host = fieldErrorHost(el);
  if (host) host.classList.add('has-error');
  el.classList.add('is-invalid');
  el.setAttribute('aria-invalid', 'true');

  if (!host) return;
  let node = host.querySelector(':scope > .field-error');
  if (!node) {
    node = document.createElement('span');
    node.className = 'field-error';
    host.appendChild(node);
  }
  node.textContent = message;
}

function clearFieldError(el) {
  if (!el) return;
  const host = fieldErrorHost(el);
  if (host) {
    host.classList.remove('has-error');
    const node = host.querySelector(':scope > .field-error');
    if (node) node.remove();
  }
  el.classList.remove('is-invalid');
  el.removeAttribute('aria-invalid');
}

/**
 * Validates a single customer/date field and paints the inline error.
 * @returns {boolean} true when valid
 */
function validateField(el) {
  if (!el) return true;
  const id = el.id;
  const value = (el.value || '').trim();
  let message = '';

  if (id === 'fCustomerName') {
    if (!value) message = 'Customer name is required.';
    else if (value.length < 2) message = 'Enter at least 2 characters.';
  } else if (id === 'fPhone' && value) {
    const digits = value.replace(/[^\d]/g, '');
    if (digits.length < 7 || digits.length > 15) message = 'Enter a valid phone number (7–15 digits).';
  } else if (id === 'fEmail' && value) {
    if (!EMAIL_PATTERN.test(value)) message = 'Enter a valid email address.';
  } else if (id === 'fEndDate') {
    const start = document.getElementById('fStartDate')?.value;
    if (start && value && value < start) message = 'End date cannot be before the start date.';
  }

  if (message) setFieldError(el, message);
  else clearFieldError(el);
  return !message;
}

/**
 * Validates a single line-item row. Completely blank rows are ignored.
 * @returns {boolean} true when valid
 */
function validateItemRow(row) {
  if (!row) return true;
  const qtyEl = row.querySelector('.qty');
  const descEl = row.querySelector('.desc');
  const priceEl = row.querySelector('.price');
  if (!qtyEl || !descEl || !priceEl) return true;

  [qtyEl, descEl, priceEl].forEach(clearFieldError);

  const qty = parseFloat(qtyEl.value) || 0;
  const price = parseFloat(priceEl.value) || 0;
  const desc = descEl.value.trim();
  const touched = Boolean(desc || qtyEl.value || priceEl.value);

  if (!touched) return true;
  if (!desc) { setFieldError(descEl, 'Description is required.'); return false; }
  if (qty <= 0) { setFieldError(qtyEl, 'Qty must be > 0.'); return false; }
  if (price < 0) { setFieldError(priceEl, 'Rate cannot be negative.'); return false; }
  return true;
}

/**
 * Validates the whole invoice form and focuses/scrolls to the first problem.
 * @returns {boolean} true when the form is ready to save
 */
function validateInvoiceForm() {
  const fieldIds = ['fCustomerName', 'fPhone', 'fEmail', 'fStartDate', 'fEndDate'];
  let firstInvalid = null;

  fieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el && !validateField(el) && !firstInvalid) firstInvalid = el;
  });

  let firstInvalidRow = null;
  const rows = Array.from(document.querySelectorAll('#itemsBody tr'));
  rows.forEach(row => {
    if (!validateItemRow(row) && !firstInvalidRow) firstInvalidRow = row;
  });

  const hasValidItem = rows.some(row => {
    const qty = parseFloat(row.querySelector('.qty')?.value) || 0;
    const desc = row.querySelector('.desc')?.value.trim() || '';
    return qty > 0 && desc;
  });

  const target = firstInvalid || firstInvalidRow?.querySelector('.is-invalid');
  if (target) {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => target.focus({ preventScroll: true }), 280);
  }

  if (firstInvalid || firstInvalidRow) return false;

  if (!hasValidItem) {
    const addBtn = document.querySelector('#tab-invoicing [data-action="add-row"]');
    if (addBtn) addBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    showToast('Add at least one rental item before saving.', 'error');
    return false;
  }

  return true;
}

function clearInvoiceErrors() {
  document.querySelectorAll('#tab-invoicing .is-invalid').forEach(clearFieldError);
  document.querySelectorAll('#tab-invoicing .field-error').forEach(node => node.remove());
  document.querySelectorAll('#tab-invoicing .has-error').forEach(host => host.classList.remove('has-error'));
}

function initInlineValidation() {
  const watched = new Set(['fCustomerName', 'fPhone', 'fEmail', 'fStartDate', 'fEndDate']);

  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (watched.has(el.id)) {
      validateField(el);
      if (el.id === 'fStartDate') validateField(document.getElementById('fEndDate'));
      return;
    }
    if (el.matches('#itemsBody .desc, #itemsBody .qty, #itemsBody .price')) {
      validateItemRow(el.closest('tr'));
    }
  });

  // Clear a visible error as soon as the user starts correcting it
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.matches('#itemsBody input')) {
      if (el.classList.contains('is-invalid')) validateItemRow(el.closest('tr'));
      return;
    }
    if (watched.has(el.id)) {
      if (el.classList.contains('is-invalid')) validateField(el);
      if (el.id === 'fStartDate' && document.getElementById('fEndDate')?.classList.contains('is-invalid')) {
        validateField(document.getElementById('fEndDate'));
      }
    }
  });
}

window.validateField = validateField;
window.validateInvoiceForm = validateInvoiceForm;
window.clearInvoiceErrors = clearInvoiceErrors;
window.initInlineValidation = initInlineValidation;
