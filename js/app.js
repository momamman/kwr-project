/* ==============================================================================
   Kitchenware Rentals Ltd — ERP & Order Management System
   MODULE: APP — bootstrap, event delegation, window exports
   ============================================================================== */

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Super Admin',
  data_entry: 'Data Entry',
  invoicing: 'Invoicing',
  analyst: 'Analyst'
};

function readStoredSession() {
  try {
    return JSON.parse(localStorage.getItem('kwr_demo_user') || 'null');
  } catch (err) {
    return null;
  }
}

const LEGACY_INFO_STORAGE_KEY = 'kwr_hide_legacy_info';

/* The legacy ingestion explainer is only guidance, so let it be dismissed to
   free vertical space. The preference persists per browser; a small ⓘ button
   in the header brings it back. */
function setLegacyInfoVisibility(visible, persist) {
  const banner = document.getElementById('legacyInfoBanner');
  const toggle = document.getElementById('legacyInfoToggle');
  if (banner) banner.hidden = !visible;
  if (toggle) toggle.hidden = visible;
  if (!persist) return;
  try {
    if (visible) localStorage.removeItem(LEGACY_INFO_STORAGE_KEY);
    else localStorage.setItem(LEGACY_INFO_STORAGE_KEY, '1');
  } catch (err) {
    // Storage can be unavailable in private mode; the banner still closes.
  }
}

function initLegacyInfoBanner() {
  let hidden = false;
  try {
    hidden = localStorage.getItem(LEGACY_INFO_STORAGE_KEY) === '1';
  } catch (err) {
    hidden = false;
  }
  setLegacyInfoVisibility(!hidden, false);
}

function renderUserPanel() {
  const emailEl = document.getElementById('user-email-display');
  const roleEl = document.getElementById('user-role-badge');
  const adminLink = document.getElementById('admin-panel-link');
  const isAdmin = currentRole === 'super_admin' || currentRole === 'admin';

  if (emailEl) emailEl.textContent = currentUser?.email || 'No active session';

  if (roleEl) {
    roleEl.textContent = ROLE_LABELS[currentRole] || 'User';
    roleEl.className = `role-badge ${currentRole}`;
  }

  if (adminLink && !isAdmin) adminLink.style.display = 'none';
}

(async function init() {
  // Apply the saved legacy-info preference before auth resolves, so the
  // explainer does not flash for users who dismissed it.
  initLegacyInfoBanner();

  // Paint the header from the stored session first, so it never sits on "Loading..."
  // while (or if) the Supabase round-trip resolves.
  const storedSession = readStoredSession();
  if (storedSession) {
    currentUser = storedSession.user || storedSession.session?.user || null;
    currentRole = storedSession.role || 'user';
    renderUserPanel();
  }

  let authData = null;
  try {
    authData = await auth.checkAuth();
  } catch (err) {
    console.error('Auth check failed:', err);
  }
  if (!authData) return;

  currentUser = authData.user || authData.session?.user || null;
  currentRole = authData.role || 'user';

  renderUserPanel();

  // Setup Role-based Tab Permissions
  setupTabPermissions();

  // Sticky invoice total bar
  initStickyTotal();

  // Field-level validation feedback
  initInlineValidation();

  // Command palette (Ctrl/Cmd + K)
  if (typeof initCommandPalette === 'function') initCommandPalette();

  // A4 print document (toolbar, modal and Ctrl/Cmd+P)
  if (typeof initPrintDocument === 'function') initPrintDocument();

  // Return-due alerts, reminder cadence and the late-fee policy
  if (typeof initReturnAlerts === 'function') initReturnAlerts();

  // ── Event Delegation: tab navigation (replaces inline onclick) ──
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    btn.addEventListener('keydown', (e) => {
      const navKeys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
      if (!navKeys.includes(e.key)) return;
      e.preventDefault();
      const tabs = Array.from(document.querySelectorAll('.tab-btn[data-tab]'));
      const index = tabs.indexOf(btn);
      let next = index;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else next = tabs.length - 1;
      const target = tabs[next];
      target.focus();
      if (!target.classList.contains('disabled')) switchTab(target.dataset.tab);
    });
  });

  // ── Event Delegation: UI actions (replaces inline onclick) ──
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    switch (action) {
      case 'new-invoice':
        switchTab('invoicing');
        createNewTransaction();
        break;
      case 'open-palette':
        if (typeof openCommandPalette === 'function') openCommandPalette();
        break;
      case 'clear-invoicing':
        handleClearInvoicing();
        break;
      case 'save-invoice':
        saveInvoice(el.dataset.status || 'CONFIRMED');
        break;
      case 'print-invoice':
        printInvoice();
        break;
      case 'share-invoice':
        if (typeof openShareMenu === 'function') openShareMenu(el);
        break;
      case 'open-print-archive':
        if (typeof openPrintArchive === 'function') openPrintArchive();
        break;
      case 'close-print-archive':
        if (typeof closePrintArchive === 'function') closePrintArchive();
        break;
      case 'archive-reprint': {
        const archived = el.closest('[data-archive-id]');
        if (archived && typeof reprintArchivedDocument === 'function') {
          reprintArchivedDocument(archived.dataset.archiveId);
        }
        break;
      }
      case 'archive-download': {
        const archived = el.closest('[data-archive-id]');
        if (archived && typeof downloadArchivedDocument === 'function') {
          downloadArchivedDocument(archived.dataset.archiveId);
        }
        break;
      }
      case 'archive-delete': {
        const archived = el.closest('[data-archive-id]');
        if (archived && typeof deleteArchivedDocument === 'function') {
          deleteArchivedDocument(archived.dataset.archiveId);
        }
        break;
      }
      case 'add-row':
        addRow();
        break;
      case 'add-legacy-row':
        addLegacyRow();
        break;
      case 'new-legacy':
        createNewLegacyEntry();
        break;
      case 'dismiss-legacy-info':
        setLegacyInfoVisibility(false, true);
        break;
      case 'show-legacy-info':
        setLegacyInfoVisibility(true, true);
        break;
      case 'clear-legacy':
        handleClearLegacy();
        break;
      case 'save-legacy':
        saveLegacyInvoice();
        break;
      case 'print-legacy':
        printLegacyRecord();
        break;
      case 'super-admin-edit':
        enableSuperAdminEdit();
        break;
      case 'close-invoice-modal':
        closeInvoiceDetailModal();
        break;
      case 'close-refund-modal':
        closeRefundModal();
        break;
      case 'payout':
        processPayout();
        break;
      case 'demo':
        auth.loginAsDemo(el.dataset.role);
        break;
      case 'logout':
        auth.logout();
        break;
      case 'open-legacy-file':
        document.getElementById('legReceiptFile')?.click();
        break;
      case 'ai':
        runAiAnalysis(el.dataset.ai);
        break;
      case 'print-confirmation-invoice':
        if (typeof printActiveInvoice === 'function') printActiveInvoice();
        else window.print();
        break;
      case 'view-return-report':
        if (typeof openServiceReport === 'function') {
          openServiceReport(el.dataset.invoiceNo || activeSelectedInvoice?.invoiceNo);
        }
        break;
      case 'close-service-report':
        if (typeof closeServiceReport === 'function') closeServiceReport();
        break;
      case 'print-service-report':
        if (typeof printServiceReport === 'function') printServiceReport();
        break;
      case 'edit-return-audit':
        if (typeof openReturnAudit === 'function') openReturnAudit();
        break;
      case 'edit-audit-from-review':
        if (typeof openReturnAuditFromReview === 'function') openReturnAuditFromReview();
        break;
      case 'close-return-audit':
        if (typeof closeReturnAudit === 'function') closeReturnAudit();
        break;
      case 'save-return-audit':
        if (typeof saveReturnAudit === 'function') saveReturnAudit();
        break;
      case 'open-return-review':
        if (typeof openReturnReview === 'function') {
          openReturnReview(el.dataset.invoiceNo || activeSelectedInvoice?.invoiceNo);
        }
        break;
      case 'review-return':
        if (typeof openServiceReport === 'function') openServiceReport(el.dataset.invoiceNo);
        if (typeof openReturnReview === 'function') {
          openReturnReview(el.dataset.invoiceNo || activeSelectedInvoice?.invoiceNo);
        }
        break;
      case 'close-return-review':
        if (typeof closeReturnReview === 'function') closeReturnReview();
        break;
      case 'approve-return':
        if (typeof approveReturnReview === 'function') approveReturnReview();
        break;
      case 'open-return-revoke':
        if (typeof openReturnRevoke === 'function') {
          openReturnRevoke(el.dataset.invoiceNo || activeSelectedInvoice?.invoiceNo);
        }
        break;
      case 'close-return-revoke':
        if (typeof closeReturnRevoke === 'function') closeReturnRevoke();
        break;
      case 'confirm-return-revoke':
        if (typeof revokeReturnApproval === 'function') revokeReturnApproval();
        break;
      case 'del-row':
        delRow(parseInt(el.dataset.rowId, 10));
        break;
      case 'select-customer':
        selectCustomer(
          parseInt(el.dataset.customerIdx, 10),
          el.dataset.customerContext || 'invoicing'
        );
        break;
      case 'select-catalog':
        selectCatalogItem(
          parseInt(el.dataset.catalogId, 10),
          el.dataset.catalogDesc,
          parseFloat(el.dataset.catalogPrice)
        );
        break;
      case 'view-invoice':
        openInvoiceDetailModal(el.dataset.invoiceNo);
        break;
      case 'edit-invoice':
        editInvoiceAsSuperAdmin(
          el.dataset.invoiceNo || (typeof activeSelectedInvoice !== 'undefined' && activeSelectedInvoice?.invoiceNo) || document.getElementById('fOrderNo')?.value
        );
        break;
      case 'open-refund-modal':
        openRefundModal(el.dataset.invoiceNo, el.dataset.customerName, parseFloat(el.dataset.refundAmount) || 0);
        break;
      case 'edit-refund-details':
        openRefundModal(
          el.dataset.invoiceNo,
          el.dataset.customerName,
          parseFloat(el.dataset.refundAmount) || 0,
          'edit'
        );
        break;
      case 'save-refund-details':
        saveRefundDetails();
        break;
      case 'close-payout':
        closePayoutTransaction(el.dataset.invoiceNo);
        break;
      case 'del-legacy-row':
        delLegacyRow(parseInt(el.dataset.legacyRowId, 10));
        break;
      case 'select-legacy-catalog':
        selectLegacyCatalogItem(
          parseInt(el.dataset.legacyCatalogId, 10),
          el.dataset.legacyCatalogDesc,
          parseFloat(el.dataset.legacyCatalogPrice)
        );
        break;
      case 'clear-legacy-file':
        clearLegacyFile();
        break;
      default:
        break;
    }
  });

  // ── Event Delegation: dynamic item rows & catalog search (replaces inline handlers) ──
  document.addEventListener('input', (e) => {
    const calcRowEl = e.target.closest('[data-calc-row]');
    if (calcRowEl) {
      calcRow(parseInt(calcRowEl.dataset.calcRow, 10));
      return;
    }
    const calcLegacyEl = e.target.closest('[data-calc-legacy-row]');
    if (calcLegacyEl) {
      calcLegacyRow(parseInt(calcLegacyEl.dataset.calcLegacyRow, 10));
      return;
    }
    const searchEl = e.target.closest('[data-search-catalog]');
    if (searchEl) {
      searchCatalog(searchEl, parseInt(searchEl.dataset.searchCatalog, 10));
      return;
    }
    const searchLegacyEl = e.target.closest('[data-search-legacy-catalog]');
    if (searchLegacyEl) {
      searchLegacyCatalog(searchLegacyEl, parseInt(searchLegacyEl.dataset.searchLegacyCatalog, 10));
      return;
    }
  });

  // ── Event Wiring: inputs & selects (replaces inline oninput/onchange) ──
  const fCustomerInput = document.getElementById('fCustomerName');
  fCustomerInput?.addEventListener('input', (e) => autocompleteCustomer(e.target.value, 'invoicing'));
  const legCustomerInput = document.getElementById('legCustomerName');
  legCustomerInput?.addEventListener('input', (e) => autocompleteCustomer(e.target.value, 'legacy'));

  const fStartDate = document.getElementById('fStartDate');
  fStartDate?.addEventListener('change', () => recalc());
  const fEndDate = document.getElementById('fEndDate');
  fEndDate?.addEventListener('change', () => recalc());
  const fCaution = document.getElementById('fCaution');
  fCaution?.addEventListener('input', () => recalc());
  const fTransport = document.getElementById('fTransport');
  fTransport?.addEventListener('input', () => recalc());

  const legDate = document.getElementById('legDate');
  legDate?.addEventListener('change', () => recalcLegacy());
  const legEndDate = document.getElementById('legEndDate');
  legEndDate?.addEventListener('change', () => recalcLegacy());
  const legCaution = document.getElementById('legCaution');
  legCaution?.addEventListener('input', () => recalcLegacy());
  const legTransport = document.getElementById('legTransport');
  legTransport?.addEventListener('input', () => recalcLegacy());

  const legReceiptFile = document.getElementById('legReceiptFile');
  legReceiptFile?.addEventListener('change', (e) => handleLegacyReceiptFile(e.target.files));

  const allInvoicesSearch = document.getElementById('allInvoicesSearchInput');
  allInvoicesSearch?.addEventListener('input', (e) => filterAllInvoicesTable(e.target.value));

  const invoiceStatusFilter = document.getElementById('invoiceStatusFilter');
  invoiceStatusFilter?.addEventListener('change', (e) => filterInvoiceByStatus(e.target.value));

  const legacySearch = document.getElementById('legacySearchInput');
  legacySearch?.addEventListener('input', (e) => filterLegacyLogsTable(e.target.value));

  const depositsSearch = document.getElementById('depositsSearchInput');
  depositsSearch?.addEventListener('input', (e) => renderDepositsTable());

  const modalStatusSelect = document.getElementById('modalInvoiceStatusSelect');
  modalStatusSelect?.addEventListener('change', (e) => updateInvoiceStatusFromModal(e.target.value));

  // Edit Transaction button is handled via document-level delegation ([data-action="edit-invoice"])

  // ── Bootstrap: local state → remote sync → render → project numbers ──
  // The number in the form is only a projection of the highest saved invoice; the
  // real number is allocated by the server when an invoice is saved, so a page
  // load or refresh never consumes one.
  loadMasterInvoices();
  renderAllInvoicesTable(MASTER_INVOICES);
  setInvoiceFormMode('unassigned');

  const remoteResult = await fetchInvoicesFromSupabase();
  await fetchCustomersFromSupabase();

  renderAllInvoicesTable(MASTER_INVOICES);
  renderDepositsTable();
  renderLegacyLogsTable();
  updateDashboardMetrics();

  // A QR code links back to ?invoice=INV-0001 — open that record once the
  // remote records (if any) have joined the local set.
  if (typeof handleInvoiceDeepLink === 'function') handleInvoiceDeepLink();
  initCharts();

  if (!remoteResult || !remoteResult.ok) {
    showToast('Could not reach the database, so invoices may be incomplete. The form stays locked until you reload.', 'error');
  }

  // Project the next numbers only now that the remote set is known.
  await createNewTransaction();
  await refreshLegacyNumber(false);
})();
