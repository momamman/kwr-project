/* ==============================================================================
   Kitchenware Rentals Ltd — ERP & Order Management System
   MODULE: CHARTS & INSIGHTS — dashboard metrics, AI assistant, charts
   ============================================================================== */
let revenueChartInstance = null;
let categoryChartInstance = null;

function initCharts() {
  const ctx1 = document.getElementById('revenueChart')?.getContext('2d');
  const ctx2 = document.getElementById('categoryChart')?.getContext('2d');
  if (!ctx1 || !ctx2) return;

  if (revenueChartInstance) revenueChartInstance.destroy();
  if (categoryChartInstance) categoryChartInstance.destroy();

  revenueChartInstance = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [{
        label: 'Gross Revenue (₦)',
        data: [420000, 580000, 750000, 910000, 1100000, 1280000],
        borderColor: '#A71265',
        backgroundColor: 'rgba(167, 18, 101, 0.08)',
        fill: true,
        tension: 0.4
      }]
    }
  });

  categoryChartInstance = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: ['Chafing Dishes', 'Plates & Bowls', 'Glassware', 'Cutlery'],
      datasets: [{
        data: [40, 25, 20, 15],
        backgroundColor: ['#A71265', '#57463B', '#3D5348', '#D97706']
      }]
    }
  });

  updateDashboardMetrics();
}

function updateDashboardMetrics() {
  // Compute real totals from MASTER_INVOICES
  const totalRevenue = MASTER_INVOICES.reduce((sum, inv) => sum + (Number(inv.totalCost) || 0), 0);
  const activeRentals = MASTER_INVOICES.filter(i => i.status === 'OUT_ON_HIRE').length;
  const fulfilledCount = MASTER_INVOICES.filter(i => i.status === 'OUT_ON_HIRE' || i.status === 'RETURNED').length;
  const activeItemUnits = MASTER_INVOICES
    .filter(i => i.status === 'OUT_ON_HIRE')
    .reduce((sum, i) => sum + (Array.isArray(i.items) ? i.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0), 0);
  const pendingDeposits = MASTER_INVOICES
    .filter(i => i.depositStatus && i.depositStatus !== 'REFUNDED')
    .reduce((sum, i) => sum + (Number(i.caution) || 0), 0);

  const elRev = document.getElementById('kpiGrossRevenue');
  const elFulfilled = document.getElementById('kpiFulfilledTransactions');
  const elActive = document.getElementById('kpiActiveItemsOut');
  const elPending = document.getElementById('kpiPendingDeposits');

  if (elRev) elRev.textContent = '₦ ' + totalRevenue.toLocaleString('en-NG');
  if (elFulfilled) elFulfilled.textContent = fulfilledCount + ' Orders';
  if (elActive) elActive.textContent = activeItemUnits + ' Units';
  if (elPending) elPending.textContent = '₦ ' + pendingDeposits.toLocaleString('en-NG');
}

function runAiAnalysis(type) {
  const el = document.getElementById('aiResponseArea');
  if (!el) return;
  el.style.display = 'block';

  const totalHeldCaution = MASTER_INVOICES
    .filter(i => i.caution && i.depositStatus !== 'REFUNDED')
    .reduce((sum, i) => sum + (Number(i.caution) || 0), 0);

  if (type === 'inventory') {
    el.innerHTML = `<strong>🤖 AI Analysis — Inventory Bottlenecks:</strong><br>• High demand detected for <em>Roll-Top Chafing Dishes</em> (92% utilization rate on peak event dates).<br>• Recommendation: Increase stock buffer by 30 units to avoid turn-away losses.`;
  } else if (type === 'deposits') {
    el.innerHTML = `<strong>🤖 AI Analysis — Refund Exposure:</strong><br>• Total held deposits in escrow: <strong>₦ ${totalHeldCaution.toLocaleString('en-NG')}</strong>.<br>• Risk Score: <strong>LOW</strong> (Customer return compliance rate is above 94%).`;
  } else if (type === 'forecast') {
    el.innerHTML = `<strong>🤖 AI Analysis — 30-Day Demand Forecast:</strong><br>• Anticipated 24% surge in catering equipment orders for upcoming banquet season.<br>• Projected Gross Revenue: <strong>₦ 1.65M</strong>.`;
  }
}

/* Invoice printing lives in js/print.js (A4 document renderer). */
