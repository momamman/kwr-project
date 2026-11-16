/* ==============================================================================
   Kitchenware Rentals Ltd — ERP & Order Management System
   MODULE: PALETTE — command palette (Ctrl/Cmd+K quick jump)
   ============================================================================== */

const PALETTE_TABS = [
  { tab: 'invoicing', label: 'Invoicing & Transactions', icon: '🧾', meta: 'Create orders', keywords: 'invoice order hire new save create' },
  { tab: 'all-invoices', label: 'All Invoices', icon: '📋', meta: 'Master directory', keywords: 'list directory invoices history edit admin' },
  { tab: 'data-entry', label: 'Data Entry (Legacy)', icon: '📝', meta: 'Paper records', keywords: 'legacy paper receipt ingest old' },
  { tab: 'analysis', label: 'Analysis & AI Insights', icon: '📊', meta: 'Dashboard', keywords: 'reports charts analytics kpi revenue ai' },
  { tab: 'deposits', label: 'Refundable Deposits', icon: '💳', meta: 'Payouts', keywords: 'deposit refund payout caution admin' }
];

const PALETTE_DEMO_ROLES = [
  { role: 'super_admin', label: 'Switch demo: Super Admin', icon: '👑' },
  { role: 'invoicing', label: 'Switch demo: Invoicing', icon: '🧾' },
  { role: 'data_entry', label: 'Switch demo: Data Entry', icon: '📝' },
  { role: 'analyst', label: 'Switch demo: Analyst', icon: '📊' }
];

let paletteItems = [];
let paletteIndex = 0;
let paletteReturnFocus = null;

function paletteCanUseTab(tab) {
  if (typeof auth === 'undefined' || typeof currentRole === 'undefined') return true;
  return auth.canAccessTab(currentRole, tab.replace('-', '_'))
    || currentRole === 'super_admin'
    || currentRole === 'admin';
}

function paletteActionCommands() {
  const isAdmin = currentRole === 'super_admin' || currentRole === 'admin';
  const commands = [
    { id: 'new-invoice', tab: 'invoicing', group: 'Actions', icon: '➕', label: 'New transaction', meta: 'Clear the form', keywords: 'create invoice new order reset', run: () => { switchTab('invoicing'); createNewTransaction(); } },
    { id: 'add-row', tab: 'invoicing', group: 'Actions', icon: '🧮', label: 'Add item row', meta: 'Invoicing', keywords: 'line item row add hire', run: () => { switchTab('invoicing'); addRow(); } },
    { id: 'save-invoice', tab: 'invoicing', group: 'Actions', icon: '💾', label: 'Save & fulfill invoice', meta: 'Invoicing', keywords: 'save submit fulfil confirm order', run: () => { switchTab('invoicing'); saveInvoice('fulfilled'); } },
    { id: 'print-invoice', tab: 'invoicing', group: 'Actions', icon: '🖨️', label: 'Print invoice', meta: 'Invoicing', keywords: 'print pdf paper', run: () => { switchTab('invoicing'); printInvoice(); } },
    { id: 'print-archive', tab: 'all-invoices', group: 'Actions', icon: '🗃️', label: 'Print archive', meta: 'Reprint saved documents', keywords: 'archive print reprint download history saved', run: () => { if (typeof openPrintArchive === 'function') openPrintArchive(); } },
    { id: 'clear-invoicing', tab: 'invoicing', group: 'Actions', icon: '🗑️', label: 'Clear invoice form', meta: 'Invoicing', keywords: 'reset clear empty discard', run: () => { switchTab('invoicing'); handleClearInvoicing(); } },
    { id: 'new-legacy', tab: 'data-entry', group: 'Actions', icon: '📥', label: 'Start a legacy entry', meta: 'Data Entry', keywords: 'legacy paper receipt ingest old record', run: () => { switchTab('data-entry'); createNewLegacyEntry(); } },
    { id: 'add-legacy-row', tab: 'data-entry', group: 'Actions', icon: '🧾', label: 'Add legacy item row', meta: 'Data Entry', keywords: 'legacy line item row add', run: () => { switchTab('data-entry'); addLegacyRow(); } }
  ].filter(cmd => paletteCanUseTab(cmd.tab));

  if (isAdmin) {
    commands.push({
      id: 'manage-users', group: 'Actions', icon: '⚙️', label: 'Manage users', meta: 'Admin',
      keywords: 'admin users accounts roles permissions',
      run: () => { window.location.href = 'admin-users.html'; }
    });
  }

  PALETTE_DEMO_ROLES.forEach(({ role, label, icon }) => {
    if (role === currentRole) return;
    commands.push({
      id: `demo-${role}`, group: 'Actions', icon, label, meta: 'Demo',
      keywords: `demo role switch ${role.replace('_', ' ')}`,
      run: () => auth.loginAsDemo(role)
    });
  });

  commands.push({
    id: 'logout', group: 'Actions', icon: '🚪', label: 'Log out', meta: 'Session',
    keywords: 'logout sign out exit leave',
    run: () => auth.logout()
  });

  return commands;
}

function paletteInvoiceCommands() {
  if (!Array.isArray(MASTER_INVOICES)) return [];
  return MASTER_INVOICES.slice(0, 200).map(inv => ({
    id: `invoice-${inv.invoiceNo}`,
    group: 'Invoices',
    icon: inv.isLegacy ? '📜' : '🧾',
    label: `${inv.invoiceNo} · ${inv.customerName || 'Unnamed customer'}`,
    meta: `₦ ${fmt(inv.totalCost || 0)}`,
    keywords: `${inv.customerName || ''} ${inv.address || ''} ${inv.invoiceNo}`.toLowerCase(),
    run: () => { switchTab('all-invoices'); openInvoiceDetailModal(inv.invoiceNo); }
  }));
}

function paletteBuildCommands(query) {
  const q = (query || '').trim().toLowerCase();
  const groups = [];

  const tabs = PALETTE_TABS
    .filter(item => paletteCanUseTab(item.tab))
    .map(item => ({
      id: `tab-${item.tab}`,
      group: 'Go to',
      icon: item.icon,
      label: item.label,
      meta: item.meta,
      keywords: item.keywords,
      run: () => switchTab(item.tab)
    }));

  groups.push({ name: 'Go to', items: paletteRank(tabs, q) });
  groups.push({ name: 'Actions', items: paletteRank(paletteActionCommands(), q) });

  if (paletteCanUseTab('all-invoices')) {
    groups.push({ name: 'Invoices', items: paletteRank(paletteInvoiceCommands(), q).slice(0, 8) });
  }

  return groups.filter(group => group.items.length > 0);
}

function paletteScore(item, q) {
  if (!q) return 1;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 100;
  if (label.includes(q)) return 70;
  if ((item.keywords || '').includes(q)) return 40;
  if (item.meta && item.meta.toLowerCase().includes(q)) return 20;
  return 0;
}

function paletteRank(items, q) {
  if (!q) return items;
  return items
    .map(item => ({ item, score: paletteScore(item, q) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .map(entry => entry.item);
}

function paletteRender(query) {
  const results = document.getElementById('paletteResults');
  if (!results) return;

  const groups = paletteBuildCommands(query);
  paletteItems = [];
  paletteIndex = 0;
  results.innerHTML = '';

  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.textContent = 'No matching pages, actions or invoices.';
    results.appendChild(empty);
    return;
  }

  groups.forEach(group => {
    const heading = document.createElement('div');
    heading.className = 'palette-group-label';
    heading.textContent = group.name;
    results.appendChild(heading);

    group.items.forEach(item => {
      const position = paletteItems.length;
      paletteItems.push(item);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'palette-item';
      btn.id = `palette-item-${position}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', 'false');
      btn.innerHTML = `
        <span class="palette-item-icon" aria-hidden="true">${item.icon}</span>
        <span class="palette-item-label">${escapeHtml(item.label)}</span>
        <span class="palette-item-meta">${escapeHtml(item.meta || '')}</span>
      `;
      btn.addEventListener('click', () => paletteRun(position));
      results.appendChild(btn);
    });
  });

  paletteHighlight(0);
}

function paletteHighlight(nextIndex) {
  if (paletteItems.length === 0) return;
  const clamped = Math.max(0, Math.min(nextIndex, paletteItems.length - 1));
  paletteIndex = clamped;

  document.querySelectorAll('.palette-item').forEach(el => el.setAttribute('aria-selected', 'false'));
  const active = document.getElementById(`palette-item-${clamped}`);
  if (active) {
    active.setAttribute('aria-selected', 'true');
    active.scrollIntoView({ block: 'nearest' });
    const input = document.getElementById('paletteInput');
    if (input) input.setAttribute('aria-activedescendant', active.id);
  }
}

function paletteRun(index) {
  const item = paletteItems[index];
  if (!item) return;
  paletteClose();
  try {
    item.run();
  } catch (err) {
    console.error('Palette command failed:', err);
    showToast('That action could not be completed', 'error');
  }
}

function paletteIsOpen() {
  const overlay = document.getElementById('commandPalette');
  return Boolean(overlay) && !overlay.hidden;
}

function paletteOpen() {
  const overlay = document.getElementById('commandPalette');
  const input = document.getElementById('paletteInput');
  if (!overlay || !input) return;

  paletteReturnFocus = document.activeElement;
  overlay.hidden = false;
  document.body.classList.add('palette-open');
  input.value = '';
  paletteRender('');
  requestAnimationFrame(() => input.focus());
}

function paletteClose() {
  const overlay = document.getElementById('commandPalette');
  const input = document.getElementById('paletteInput');
  if (!overlay || overlay.hidden) return;

  overlay.hidden = true;
  document.body.classList.remove('palette-open');
  if (input) input.removeAttribute('aria-activedescendant');
  if (paletteReturnFocus && typeof paletteReturnFocus.focus === 'function') {
    paletteReturnFocus.focus({ preventScroll: true });
  }
  paletteReturnFocus = null;
}

function initCommandPalette() {
  const overlay = document.getElementById('commandPalette');
  const input = document.getElementById('paletteInput');
  if (!overlay || !input) return;

  input.addEventListener('input', () => paletteRender(input.value));

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) paletteClose();
  });

  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const shortcut = (e.metaKey || e.ctrlKey) && !e.altKey && key === 'k';

    if (shortcut) {
      e.preventDefault();
      paletteIsOpen() ? paletteClose() : paletteOpen();
      return;
    }

    if (!paletteIsOpen()) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      paletteClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      paletteHighlight(paletteIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      paletteHighlight(paletteIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      paletteRun(paletteIndex);
    } else if (e.key === 'Tab') {
      // Keep focus inside the dialog
      e.preventDefault();
    }
  });
}

window.initCommandPalette = initCommandPalette;
window.openCommandPalette = paletteOpen;
window.closeCommandPalette = paletteClose;
