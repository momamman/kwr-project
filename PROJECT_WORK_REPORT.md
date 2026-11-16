# Kitchenware Rentals ERP — Project Work Report

| Field | Detail |
|---|---|
| **Project** | Kitchenware Rentals Ltd — ERP & Order Management System |
| **Workspace** | `/Users/a1/Documents/kwr-brewkeg` |
| **Report date** | 10 Nov 2026 |
| **Build version** | `?v=64` (asset cache-buster in `index.html`) |

---

## 1. Executive summary

This project added a **lightweight review gate for returned invoices** so that a caution-deposit payout can only be released after the returned-items audit has been reviewed and approved by a Super Admin. The work includes an approval state machine, an audit fingerprint that ties approval to the exact evidence reviewed, balance-due tracking, nil-refund support, a revoke workflow, and a full payout trail.

A second phase addressed defects reported during testing: transactions could still be edited and their status changed after the deposit had been paid out, and the review modal asked reviewers to tick a checklist before showing them the evidence. Both were fixed, and an in-modal **Edit audit** action was added so the reviewer can correct the audit and be returned to the review gate.

All state persists in `localStorage` (`kwr_saved_invoices`) via `persistMasterInvoices()`. **No Supabase schema change was introduced.** The report/print pipeline is unchanged apart from a status strip on the return report.

---

## 2. Original objective and requirements

**Objective:** Ensure deposit payouts for returned invoices are only initiated after the returned-items audit has been reviewed and approved by a Super Admin, with a complete audit trail.

**Requirements captured:**

1. Returned invoices must pass a review before a payout can be initiated.
2. The review checklist must be completed before approval.
3. Approval stores the approved refund amount, the auditor, and a timestamp.
4. The audit is locked from further edits after payout.
5. A balance-due flag is raised when return charges exceed the caution deposit.
6. Nil refunds can be recorded when the deposit is fully consumed.
7. Approval can be revoked with a reason, which re-locks the payout.
8. All changes persist in `localStorage`; no Supabase schema change.
9. The report and print pipeline remain unchanged except for a status strip.

---

## 3. Design decisions

| Decision | Rationale |
|---|---|
| **Lightweight gate (Option A)** | Reuses the existing service-report and audit modals; adds a checklist, approval state, and payout gating instead of building a separate workflow engine. |
| **Audit signature fingerprint** | `returnAuditSignature()` hashes the reviewed evidence (items, quantities, conditions, charges, notes, fees). Approval stores this signature; if the audit is edited the signature no longer matches and the approval is treated as stale. |
| **Balance derived from money** | `balance = returnCharges − depositApplied`. A positive result is payable by the customer; negative is refundable. |
| **Revoke resets approval** | Revoking deletes `returnReview` and `refundAmount`, appends to `reviewRevocations`, and re-locks payout until re-reviewed. |
| **No gateway integration** | “Execute API Payout” was relabelled **“Record payout”** to make clear it records a payout rather than moving money through a payment gateway. |
| **Lock at `RETURNED` + `REFUNDED`** | Once the deposit is paid out, the transaction is settled and must not be edited, re-statused, or re-audited. |

---

## 4. Phase 1 — Review gate implementation (earlier session)

The following was completed in the first phase (reconstructed from the session record):

- **Review checklist** with three confirmations (items, charges, refund) required before approval.
- **`returnReview` state machine:** `PENDING → APPROVED → PAID → CLOSED` (plus `LOCKED`/`MISSING` derived states).
- **Audit fingerprint (`auditSignature`)** tying an approval to the exact audit snapshot.
- **Approval invalidation** on audit edit or when the invoice status leaves `RETURNED`.
- **Revoke approval** workflow with a mandatory reason, recorded in `reviewRevocations`.
- **Balance-due tracking** via `returnBalanceDue()`, surfaced as `balanceFlag` in the deposits table and the All Invoices row.
- **Nil refund support** when the caution deposit is fully consumed by return charges.
- **Report status strip:** `⏳ Review pending` / `✓ Return approved` / `✅ Deposit refunded` / `⚠ Balance payable`.
- **Payout trail:** `payoutEditHistory` for post-payout corrections and `payoutAdjustment` (`approved`, `paid`, `reason`).
- **“Execute API Payout” → “Record payout”** label change.
- **Report strip payout amount** shows `refundPaidAmount`, bank, and refund date.
- **Post-payout audit lock:** “Edit audit” disabled and “Audit locked” label shown.
- **Cache-busters** raised to `?v=60`.
- Verified: pending blocks payout; incomplete checklist blocks approval; approval unlocks payout; a different payout amount requires a reason; nil refund records; audit edit resets approval; status change clears approval; paid-payout edits keep history; mobile has no overflow; report fits one A4 page.

---

## 5. Phase 2 — Prompt log, fixes, and enhancements

### Prompt 1 — “i am still able to edit a transaction after it has been returned and deposit paid, fix”

**Problem:** Super Admins could still open and save the transaction editor for an invoice already `RETURNED` with its deposit `REFUNDED`.

**Changes in `js/invoices.js`:**

1. **`editInvoiceAsSuperAdmin(invoiceNo)`** — added a guard before loading the form:

   ```js
   if (inv.status === 'RETURNED' && inv.depositStatus === 'REFUNDED') {
     showToast('This transaction has been returned and its deposit paid out — it is no longer editable', 'error');
     return;
   }
   ```

2. **`renderAllInvoicesTable()`** — the row “Edit” button is now conditional:

   ```js
   const canEditInvoice = isSuperAdmin &&
     !(inv.status === 'RETURNED' && inv.depositStatus === 'REFUNDED');
   ```

3. **`renderDepositsTable()`** — the “Edit refund details” pencil is hidden once refunded:

   ```js
   const canEditRefund = !isRefunded;
   ```

**Also checked:** `openRefundModal()` already blocks refunded deposits; the review modal already refuses `REFUNDED`; audit save is already locked after payout.

---

### Prompt 2 — “i can still change the status from returned to any other”

**Problem:** The status dropdown in the invoice detail modal could move a paid-out return back to `CONFIRMED` / `OUT_ON_HIRE` / etc.

**Change in `js/invoices.js` — `updateInvoiceStatusFromModal(newStatus)`:**

```js
// Block status changes from RETURNED when deposit has already been paid out.
if (activeSelectedInvoice.status === 'RETURNED' && activeSelectedInvoice.depositStatus === 'REFUNDED') {
  showToast('This transaction has been returned and its deposit paid out — the status cannot be changed', 'error');
  return;
}
```

This sits before any mutation, so the status select reverts to the stored value and the change is refused.

---

### Prompt 3 — “i think the review should come before the checklist — pls advice”

**Observation (with screenshot):** The Review modal showed the financial summary and then the checklist, but not the returned-items evidence the checklist asks the reviewer to confirm.

**Advice given:** Reorder so the reviewer sees evidence → financial summary → checklist. Recommended an inline read-only audit table, with internal scrolling to avoid an over-tall modal. Alternatives offered: a collapsible evidence panel or a two-step wizard. **User chose the inline audit table.**

**Implemented:**

- **`index.html`** — added `<div class="review-audit" id="returnReviewAudit"></div>` above the summary.
- **`js/report.js`** — new `returnReviewAuditMarkup(report)` renders a compact table: Item · Out · Returned · Condition · Cost, with remarks under the item, a shortfall display (`3 / 4`), condition pills, and an “N items · X flagged” counter. Injected by `openReturnReview()`.
- **`js/report.js`** — intro reworded to “Check the audit evidence … then confirm the checklist below.”
- **`css/main.css`** — `.review-audit*` styles, sticky table header, 200px internal scroll, wider `.review-modal` (560px → 640px).

**Verified:** desktop and 390px mobile screenshots via headless Chrome; correct order `review-audit → review-summary → review-checklist`; no horizontal overflow; audit panel scrolls internally.

---

### Prompt 4 — “include an edit button inside review return modal”

**Implemented:** an **✏️ Edit audit** button in the review modal footer.

- **`index.html`** — footer button `data-action="edit-audit-from-review"`; footer gets a `review-actions` class.
- **`js/app.js`** — new `edit-audit-from-review` action.
- **`js/report.js`:**
  - `openReturnAuditFromReview()` closes the review, then opens the audit editor for that invoice.
  - `openReturnAudit(invoiceNo)` now accepts an explicit invoice number.
  - `saveReturnAudit()` captures `returnAuditFromReview` before closing, then reopens the review modal with the updated evidence (checklist resets).
  - `closeReturnAudit()` resets the flow flag so cancelling does not bounce the user unexpectedly.
- **`css/main.css`** — `.review-edit-btn` left-aligned on desktop, full-width stacked on mobile.

**Verified:** Edit button present; click opens the audit editor for the correct invoice; changing a charge and saving reopens the review with updated evidence and recalculated refund; mobile has no overflow.

---

### Prompt 5 — “clicking on the edit button open the return edit modal of that transaction for editing”

**What was checked:** With two returned invoices (`#INV-9001` Alpha Cafe, `#INV-9002` Beta Events), the real deposits-table **Review return** button was clicked for `#INV-9002`, then **Edit audit**:

```
OPEN REVIEW #9002: reviewInvoice = #INV-9002
CLICK EDIT AUDIT : auditInvoiceNo = #INV-9002
                   subtitle = "#INV-9002 · Beta Events · record damages, shortages and extra costs"
```

The audit editor opened for the correct transaction with its fields populated. After changing a charge and saving, the review reopened for `#INV-9002` with the updated evidence.

**Cleanup applied:** `openReturnAuditFromReview()` now also calls `closeServiceReport()` so the service report no longer stays open behind the audit editor (which could be mistaken for the wrong modal opening). Cache-buster raised to `?v=64`.

---

## 6. Business rules and state machine

### Review status (derived, `returnReviewState`)

| Status | Meaning |
|---|---|
| `LOCKED` | Invoice is not `RETURNED`. |
| `PENDING` | Returned; audit needs a reviewer decision (or approval is stale). |
| `APPROVED` | Reviewer signed off on this exact audit snapshot. |
| `PAID` | Deposit payout already recorded. |
| `MISSING` | Invoice could not be found. |

### Payout lifecycle (`returnReview` + `depositStatus`)

```
PENDING --(checklist + approve)--> APPROVED --(record payout)--> PAID
   ^                                   |                            |
   |                                   |                            +--> payoutClosed (CLOSED)
   +----------- revoke (reason) -------+
```

### Permission matrix (current build)

| Invoice state | Deposit | Edit transaction | Change status | Review / approve | Edit audit | Payout |
|---|---|---|---|---|---|---|
| CONFIRMED / OUT_ON_HIRE / PENDING | HELD | ✅ | ✅ | — | — | 🔒 requires RETURNED |
| RETURNED | HELD (pending review) | ✅ | ✅ | ✅ | ✅ | 🔒 until approved |
| RETURNED | HELD (approved) | ✅ (editing invalidates approval via fingerprint) | ✅ | — | ✅ | ✅ |
| RETURNED | REFUNDED | ❌ hidden/blocked | ❌ blocked | ❌ | ❌ locked | ❌ already paid |
| Any | REFUNDED + payoutClosed | ❌ | ❌ | ❌ | ❌ | ❌ closed |

### Audit fingerprint behaviour

`returnAuditSignature()` hashes the reviewable evidence. `buildReturnReport()` recomputes it and only treats a saved approval as valid when the signatures match. Therefore any edit to quantities, conditions, charges, notes, or fees automatically invalidates a prior approval and returns the invoice to `PENDING`.

---

## 7. File-by-file change summary

| File | Changes |
|---|---|
| `index.html` | Review-audit container; “Edit audit” button in the review modal; `review-actions` footer class; cache-busters `?v=64`. |
| `js/invoices.js` | `editInvoiceAsSuperAdmin` block for `RETURNED`+`REFUNDED`; `canEditInvoice` in the All Invoices table; `canEditRefund` in the deposits table; `updateInvoiceStatusFromModal` status-change block. |
| `js/report.js` | `returnReviewAuditMarkup()`; injection in `openReturnReview()`; `openReturnAuditFromReview()`; `openReturnAudit(invoiceNo)`; reopen-review flow in `saveReturnAudit()`; `returnAuditFromReview` flag; window exports. |
| `js/app.js` | `edit-audit-from-review` action handler. |
| `css/main.css` | Review audit table, condition pills, shortfall/remarks styles, internal scroll, wider review modal, footer button alignment. |

**Storage:** `localStorage['kwr_saved_invoices']` via `loadMasterInvoices()` / `persistMasterInvoices()` (`js/state.js`).

---

## 8. Verification and testing performed

**Static checks**

- `node --check js/report.js`, `js/app.js`, `js/invoices.js` — all clean.
- String/guard presence checks for all four lock fixes.

**Browser checks (headless Chrome via CDP)**

| Test | Result |
|---|---|
| Review modal order: audit → summary → checklist | ✅ |
| Damaged/short item flagged (`3 / 4`, DAMAGED, cost, remark) | ✅ |
| Desktop 1440px layout | ✅ |
| Mobile 390px layout, no horizontal overflow, audit scrolls | ✅ |
| Edit audit opens audit editor for the reviewed invoice | ✅ (`#INV-9002` confirmed) |
| Save audit → review reopens with updated evidence | ✅ (₦8,000 → ₦12,500 reflected; totals recalculated) |
| Cancel/close audit → no stray modal / flag reset | ✅ |
| Service report closed when entering audit from review | ✅ |
| Edited transaction after RETURNED+REFUNDED blocked | ✅ guard + hidden buttons |
| Status change from RETURNED+REFUNDED blocked | ✅ guard |

**Environment**

- Dev server: `http://127.0.0.1:8000`
- Headless Chrome CDP: `127.0.0.1:9222`
- Node: v26.13.0 (global `WebSocket` used for CDP scripts)

---

## 9. Current status

- **All requested prompts completed.** No open blockers.
- The review gate, payout trail, balance-due tracking, revoke workflow, and post-payout locks are implemented and verified.
- The document/print pipeline is unchanged and still fits one A4 page.
- Demo data shows `#INV-0003` / `#LEG-0001` as returned invoices for manual testing.

---

## 10. Notes, limitations, and recommendations

1. **Payment gateway not connected.** “Record payout” records the payout and reference; it does not call a payment API.
2. **Local-first persistence.** Review and payout data live on the invoice objects in `localStorage`; there is no Supabase schema for reviews. Clearing site data resets the workflow.
3. **Approved-then-edited returns.** Editing a transaction after approval is allowed, but the fingerprint makes the approval stale (back to `PENDING`) — by design.
4. **Settled returns are immutable.** `RETURNED` + `REFUNDED` invoices are locked from editing, status change, audit edits, and refund-detail edits. If a change is genuinely required, it should be handled as a new adjustment/exception rather than by unlocking the record.
5. **Recommended next steps (optional):**
   - Move review/payout records into Supabase tables for cross-device auditability.
   - Add a server-side action log (who approved/paid/revoked, when).
   - Wire a real payout provider behind “Record payout” with idempotency keys.
   - Add automated regression tests around the permission matrix.

---

## Appendix A — Prompt log (verbatim, Phase 2)

1. “i am still able to edit a transaction after it has been returned and deposit paid, fix”
2. “i can still change the status from returned to any other”
3. “i think the review should come before the checklist pls advice” *(with screenshot of the Review return modal)*
4. “include an edit button inside review return modal”
5. “clicking on the edit button open the return edit modal of that transaction for editing”

*(Phase 1 prompts were captured in the earlier session summary and are represented by the completed-work list in Section 4.)*

## Appendix B — Cache-buster history

| Version | Change |
|---|---|
| `v=60` | Review gate baseline (Phase 1). |
| `v=61` | Inline audit evidence table in the review modal. |
| `v=62` / `v=63` | “Edit audit” action and reopen-review flow. |
| `v=64` | Audit-from-review closes the service report; final Phase 2 build. |
