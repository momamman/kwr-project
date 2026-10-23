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
    if (val < 1e3) return ones[Math.floor(val / 100)] + ' Hundred ' + cvt(val % 100);
    if (val < 1e6) return cvt(Math.floor(val / 1e3)) + 'Thousand ' + cvt(val % 1e6);
    return cvt(Math.floor(val / 1e6)) + 'Million ' + cvt(val % 1e6);
  }
  
  return cvt(num).trim();
}

window.escapeHtml = escapeHtml;
window.fmt = fmt;
window.showToast = showToast;
window.debounce = debounce;
window.numWords = numWords;
