import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../http/errors.js';
import { PaymentProviderError } from '../payments/provider.js';
import type { ProviderTransfer, TransferProvider } from './provider.js';
import type { EarningsBalance, EarningsPolicy } from './types.js';

interface SellerRow extends RowDataPacket { id: string }
interface MoneyRow extends RowDataPacket { held: string | number | null; available: string | number | null; reserved: string | number | null; paid: string | number | null; recoverable: string | number | null }
interface RecipientRow extends RowDataPacket { id: string; provider_recipient_code: string; account_name: string; bank_name: string; account_last4: string }
interface PayoutRow extends RowDataPacket { id: string; seller_id: string; payout_recipient_id: string; requested_by: string; idempotency_key: string; request_hash: string; provider_reference: string; provider_transfer_code: string | null; provider_transfer_id: string | null; amount_minor: string | number; currency: string; status: string; last_error: string | null; created_at: Date; updated_at: Date }
interface SuborderRow extends RowDataPacket { id: string; seller_id: string; seller_net_minor: string | number; fulfilled_at: Date }
interface AdjustmentRow extends RowDataPacket { id: string; seller_id: string; suborder_id: string; seller_reversal_minor: string | number }
interface EarningLotRow extends RowDataPacket { id: string; held_remaining_minor: string | number; available_remaining_minor: string | number; reserved_remaining_minor: string | number; paid_minor: string | number }
interface AllocationRow extends RowDataPacket { earning_lot_id: string; amount_minor: string | number; suborder_id: string }
interface AmountRow extends RowDataPacket { amount: string | number | null }

export class EarningsPayoutService {
  public constructor(private readonly pool: Pool, private readonly provider: TransferProvider, private readonly policy: EarningsPolicy) {}

  public async getSellerEarnings(userId: string): Promise<EarningsBalance> {
    const sellerId = await this.sellerIdForUser(userId);
    if (this.policy.holdDays !== undefined) await this.syncSeller(sellerId);
    return this.balance(sellerId);
  }

  public async configureRecipient(actorUserId: string, sellerId: string, input: { providerRecipientCode: string; accountName: string; bankName: string; accountLast4: string }): Promise<object> {
    const [seller] = await this.pool.query<SellerRow[]>('SELECT id FROM sellers WHERE id = ?', [sellerId]);
    if (!seller[0]) throw new AppError(404, 'SELLER_NOT_FOUND', 'Seller not found');
    await this.pool.query(`INSERT INTO seller_payout_recipients (id, seller_id, provider_recipient_code, account_name, bank_name, account_last4, configured_by)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE provider_recipient_code = VALUES(provider_recipient_code), account_name = VALUES(account_name), bank_name = VALUES(bank_name), account_last4 = VALUES(account_last4), configured_by = VALUES(configured_by)`,
    [randomUUID(), sellerId, input.providerRecipientCode, input.accountName, input.bankName, input.accountLast4, actorUserId]);
    return { sellerId, accountName: input.accountName, bankName: input.bankName, accountLast4: input.accountLast4, currency: 'NGN' };
  }

  public async createPayout(actorUserId: string, sellerId: string, amountMinor: number, idempotencyKey: string): Promise<{ payout: object; idempotentReplay: boolean }> {
    if (!this.policy.payoutsEnabled) throw new AppError(503, 'PAYOUTS_DISABLED', 'Payout initiation is disabled until production policy and provider approval are configured');
    if (this.policy.holdDays === undefined) throw new AppError(503, 'EARNINGS_POLICY_NOT_CONFIGURED', 'Earnings hold duration is not configured');
    await this.syncSeller(sellerId);
    const requestHash = createHash('sha256').update(JSON.stringify({ sellerId, amountMinor })).digest('hex');
    const connection = await this.pool.getConnection();
    let payout: PayoutRow;
    let replay = false;
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query<PayoutRow[]>('SELECT * FROM payouts WHERE requested_by = ? AND idempotency_key = ? FOR UPDATE', [actorUserId, idempotencyKey]);
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used with a different payout request');
        payout = existing[0]; replay = true;
      } else {
        const [recipients] = await connection.query<RecipientRow[]>('SELECT * FROM seller_payout_recipients WHERE seller_id = ? FOR UPDATE', [sellerId]);
        const recipient = recipients[0];
        if (!recipient) throw new AppError(409, 'PAYOUT_RECIPIENT_NOT_CONFIGURED', 'Seller payout recipient is not configured');
        const balance = await this.balance(sellerId, connection, true);
        if (amountMinor > balance.availableMinor) throw new AppError(409, 'INSUFFICIENT_AVAILABLE_EARNINGS', 'Payout amount exceeds available earnings');
        const id = randomUUID();
        const reference = `lh_payout_${id.replaceAll('-', '')}`;
        await connection.query(`INSERT INTO payouts (id, seller_id, payout_recipient_id, requested_by, idempotency_key, request_hash, provider_reference, amount_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, sellerId, recipient.id, actorUserId, idempotencyKey, requestHash, reference, amountMinor]);
        const [lots] = await connection.query<EarningLotRow[]>('SELECT * FROM seller_earning_lots WHERE seller_id = ? AND available_remaining_minor > 0 ORDER BY available_at, id FOR UPDATE', [sellerId]);
        let toAllocate = amountMinor;
        for (const lot of lots) {
          const allocated = Math.min(toAllocate, Number(lot.available_remaining_minor));
          if (!allocated) continue;
          await connection.query('UPDATE seller_earning_lots SET available_remaining_minor = available_remaining_minor - ?, reserved_remaining_minor = reserved_remaining_minor + ? WHERE id = ?', [allocated, allocated, lot.id]);
          await connection.query('INSERT INTO payout_allocations (payout_id, earning_lot_id, amount_minor) VALUES (?, ?, ?)', [id, lot.id, allocated]);
          toAllocate -= allocated;
          if (!toAllocate) break;
        }
        if (toAllocate) throw new AppError(409, 'EARNINGS_ALLOCATION_CONFLICT', 'Available earnings could not be allocated');
        await this.ledger(connection, sellerId, `payout:${id}:available:reserved`, 'payout_reserved', 'available', 'debit', amountMinor, 'Earnings reserved for payout', { payoutId: id });
        await this.ledger(connection, sellerId, `payout:${id}:reserved:credit`, 'payout_reserved', 'reserved', 'credit', amountMinor, 'Earnings reserved for payout', { payoutId: id });
        const [created] = await connection.query<PayoutRow[]>('SELECT * FROM payouts WHERE id = ?', [id]); payout = created[0]!;
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    if (replay || payout.status !== 'initiation_pending') return { payout: this.serializePayout(payout), idempotentReplay: replay };
    const [recipientRows] = await this.pool.query<RecipientRow[]>('SELECT * FROM seller_payout_recipients WHERE id = ?', [payout.payout_recipient_id]);
    try {
      const transfer = await this.provider.initiate({ amountMinor, currency: 'NGN', recipientCode: recipientRows[0]!.provider_recipient_code, reference: payout.provider_reference, reason: `Legit Hair seller payout ${payout.id}` });
      await this.applyProviderResult(payout.id, transfer);
    } catch (error) {
      const transient = error instanceof PaymentProviderError && error.transient;
      if (transient) await this.pool.query("UPDATE payouts SET status = 'initiation_uncertain', last_error = ? WHERE id = ? AND status = 'initiation_pending'", [error instanceof Error ? error.message.slice(0, 1000) : 'Transfer initiation failed', payout.id]);
      else await this.conclude(payout.id, 'failed');
    }
    return { payout: await this.getPayout(payout.id), idempotentReplay: false };
  }

  public async getPayout(payoutId: string): Promise<object> {
    const [rows] = await this.pool.query<PayoutRow[]>('SELECT * FROM payouts WHERE id = ?', [payoutId]);
    if (!rows[0]) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout not found');
    return this.serializePayout(rows[0]);
  }

  public async reconcilePayout(payoutId: string): Promise<object> {
    const [rows] = await this.pool.query<PayoutRow[]>('SELECT * FROM payouts WHERE id = ?', [payoutId]);
    const payout = rows[0];
    if (!payout) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout not found');
    if (['failed', 'reversed'].includes(payout.status)) return this.serializePayout(payout);
    const transfer = await this.provider.verify(payout.provider_reference);
    await this.applyProviderResult(payout.id, transfer);
    return this.getPayout(payout.id);
  }

  public async reconcilePending(limit = 100): Promise<number> {
    const [rows] = await this.pool.query<PayoutRow[]>(`SELECT * FROM payouts WHERE status IN ('initiation_pending','initiation_uncertain','pending') ORDER BY updated_at LIMIT ?`, [limit]);
    let count = 0;
    for (const row of rows) { try { await this.reconcilePayout(row.id); count += 1; } catch { /* retained for the next reconciliation pass */ } }
    return count;
  }

  public async handleWebhook(event: { event: string; data: Record<string, unknown> }, rawBody: Buffer): Promise<object> {
    const reference = typeof event.data.reference === 'string' ? event.data.reference : undefined;
    if (!reference) throw new AppError(400, 'INVALID_TRANSFER_WEBHOOK', 'Transfer reference is required');
    const [rows] = await this.pool.query<PayoutRow[]>('SELECT * FROM payouts WHERE provider_reference = ?', [reference]);
    const payout = rows[0];
    const providerId = typeof event.data.id === 'string' || typeof event.data.id === 'number' ? String(event.data.id) : 'unknown';
    const eventKey = `${event.event}:${reference}:${providerId}`;
    await this.pool.query(`INSERT IGNORE INTO payout_webhook_events (event_key, event_type, payout_id, payload_sha256) VALUES (?, ?, ?, ?)`, [eventKey, event.event, payout?.id ?? null, createHash('sha256').update(rawBody).digest('hex')]);
    if (!payout) return { accepted: true, result: 'unknown_reference' };
    const status = event.event === 'transfer.success' ? 'success' : event.event === 'transfer.failed' ? 'failed' : event.event === 'transfer.reversed' ? 'reversed' : null;
    if (!status) return { accepted: true, result: 'ignored_event' };
    const transfer: ProviderTransfer = { status, reference, amountMinor: Number(event.data.amount), currency: String(event.data.currency), transferCode: typeof event.data.transfer_code === 'string' ? event.data.transfer_code : null, transferId: providerId === 'unknown' ? null : providerId };
    await this.applyProviderResult(payout.id, transfer);
    await this.pool.query("UPDATE payout_webhook_events SET status = 'processed', result_code = ?, processed_at = NOW(3) WHERE event_key = ?", [status, eventKey]);
    return { accepted: true, result: status };
  }

  public async syncAll(limit = 500): Promise<number> {
    if (this.policy.holdDays === undefined) throw new AppError(503, 'EARNINGS_POLICY_NOT_CONFIGURED', 'Earnings hold duration is not configured');
    const [rows] = await this.pool.query<SellerRow[]>('SELECT id FROM sellers ORDER BY id LIMIT ?', [limit]);
    for (const row of rows) await this.syncSeller(row.id);
    return rows.length;
  }

  private async syncSeller(sellerId: string): Promise<void> {
    const holdDays = this.policy.holdDays!;
    const [suborders] = await this.pool.query<SuborderRow[]>(`SELECT so.id, so.seller_id, so.seller_net_minor, so.fulfilled_at
      FROM seller_suborders so JOIN orders o ON o.id = so.order_id
      LEFT JOIN payments p ON p.order_id = o.id AND p.status = 'succeeded'
      LEFT JOIN cod_collections cc ON cc.order_id = o.id AND cc.status = 'confirmed'
      WHERE so.seller_id = ? AND so.status IN ('delivered','picked_up','returned','refunded') AND so.fulfilled_at IS NOT NULL
        AND ((o.payment_method = 'paystack' AND p.id IS NOT NULL) OR (o.payment_method = 'cod' AND cc.id IS NOT NULL))`, [sellerId]);
    for (const suborder of suborders) {
      const amount = Number(suborder.seller_net_minor);
      const connection = await this.pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query(`INSERT IGNORE INTO seller_earning_lots (id, seller_id, suborder_id, original_amount_minor, held_remaining_minor, available_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL ? DAY))`, [randomUUID(), sellerId, suborder.id, amount, amount, suborder.fulfilled_at, holdDays]);
        await this.ledger(connection, sellerId, `earning:${suborder.id}:held`, 'earning_held', 'held', 'credit', amount, 'Seller net earning held after fulfilment', { suborderId: suborder.id });
        if (suborder.fulfilled_at.getTime() + holdDays * 86_400_000 <= Date.now()) {
          const [lots] = await connection.query<EarningLotRow[]>('SELECT * FROM seller_earning_lots WHERE suborder_id = ? FOR UPDATE', [suborder.id]);
          const releasable = Number(lots[0]?.held_remaining_minor ?? 0);
          if (releasable) {
            await connection.query('UPDATE seller_earning_lots SET held_remaining_minor = 0, available_remaining_minor = available_remaining_minor + ? WHERE id = ?', [releasable, lots[0]!.id]);
            await this.ledger(connection, sellerId, `earning:${suborder.id}:held:release`, 'hold_released', 'held', 'debit', releasable, 'Earning hold released', { suborderId: suborder.id });
            await this.ledger(connection, sellerId, `earning:${suborder.id}:available:release`, 'hold_released', 'available', 'credit', releasable, 'Earning available for payout', { suborderId: suborder.id });
          }
        }
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }
    await this.classifyRefunds(sellerId);
  }

  private async classifyRefunds(sellerId: string): Promise<void> {
    const [adjustments] = await this.pool.query<AdjustmentRow[]>(`SELECT a.id, a.seller_id, a.suborder_id, a.seller_reversal_minor FROM seller_refund_adjustments a JOIN refunds r ON r.id = a.refund_id WHERE a.seller_id = ? AND a.classification = 'pending_b09_classification' AND r.status = 'processed' ORDER BY a.created_at`, [sellerId]);
    for (const adjustment of adjustments) {
      const connection = await this.pool.getConnection();
      try {
        await connection.beginTransaction();
        const [locked] = await connection.query<AdjustmentRow[]>('SELECT * FROM seller_refund_adjustments WHERE id = ? AND classification = \'pending_b09_classification\' FOR UPDATE', [adjustment.id]);
        if (!locked[0]) { await connection.commit(); continue; }
        await this.balance(sellerId, connection, true);
        const [lots] = await connection.query<EarningLotRow[]>('SELECT * FROM seller_earning_lots WHERE suborder_id = ? FOR UPDATE', [adjustment.suborder_id]);
        const lot = lots[0];
        let remaining = Number(adjustment.seller_reversal_minor);
        const held = Math.min(remaining, Number(lot?.held_remaining_minor ?? 0)); remaining -= held;
        const available = Math.min(remaining, Number(lot?.available_remaining_minor ?? 0)); remaining -= available;
        if (lot) await connection.query('UPDATE seller_earning_lots SET held_remaining_minor = held_remaining_minor - ?, available_remaining_minor = available_remaining_minor - ? WHERE id = ?', [held, available, lot.id]);
        if (held) await this.ledger(connection, sellerId, `refund:${adjustment.id}:held`, 'refund_reversal', 'held', 'debit', held, 'Refund reversed held earnings', { suborderId: adjustment.suborder_id, refundAdjustmentId: adjustment.id });
        if (available) await this.ledger(connection, sellerId, `refund:${adjustment.id}:available`, 'refund_reversal', 'available', 'debit', available, 'Refund reversed available earnings', { suborderId: adjustment.suborder_id, refundAdjustmentId: adjustment.id });
        if (remaining) await this.ledger(connection, sellerId, `refund:${adjustment.id}:recoverable`, 'refund_recoverable', 'recoverable', 'credit', remaining, 'Refund created a finance recovery balance', { suborderId: adjustment.suborder_id, refundAdjustmentId: adjustment.id });
        await connection.query("UPDATE seller_refund_adjustments SET classification = ?, classified_at = NOW(3) WHERE id = ?", [remaining ? 'recoverable_balance' : 'earnings_reversal', adjustment.id]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }
  }

  private async applyProviderResult(payoutId: string, transfer: ProviderTransfer): Promise<void> {
    const [rows] = await this.pool.query<PayoutRow[]>('SELECT * FROM payouts WHERE id = ?', [payoutId]);
    const payout = rows[0]; if (!payout) return;
    if (transfer.reference !== payout.provider_reference || transfer.amountMinor !== Number(payout.amount_minor) || transfer.currency !== payout.currency) {
      await this.pool.query("UPDATE payouts SET status = 'initiation_uncertain', last_error = 'Provider transfer identity mismatch' WHERE id = ?", [payoutId]); return;
    }
    if (['success', 'failed', 'reversed'].includes(transfer.status)) await this.conclude(payoutId, transfer.status as 'success' | 'failed' | 'reversed', transfer);
    else await this.pool.query("UPDATE payouts SET status = 'pending', provider_transfer_code = COALESCE(?, provider_transfer_code), provider_transfer_id = COALESCE(?, provider_transfer_id), initiated_at = COALESCE(initiated_at, NOW(3)), last_error = NULL WHERE id = ? AND status NOT IN ('success','failed','reversed')", [transfer.transferCode, transfer.transferId, payoutId]);
  }

  private async conclude(payoutId: string, outcome: 'success' | 'failed' | 'reversed', transfer?: ProviderTransfer): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<PayoutRow[]>('SELECT * FROM payouts WHERE id = ? FOR UPDATE', [payoutId]); const payout = rows[0]; if (!payout) { await connection.commit(); return; }
      if (payout.status === outcome || ['failed', 'reversed'].includes(payout.status) || (payout.status === 'success' && outcome !== 'reversed')) { await connection.commit(); return; }
      const amount = Number(payout.amount_minor);
      const [allocations] = await connection.query<AllocationRow[]>('SELECT pa.earning_lot_id, pa.amount_minor, lot.suborder_id FROM payout_allocations pa JOIN seller_earning_lots lot ON lot.id = pa.earning_lot_id WHERE pa.payout_id = ? FOR UPDATE', [payoutId]);
      if (outcome === 'success') {
        for (const allocation of allocations) await connection.query('UPDATE seller_earning_lots SET reserved_remaining_minor = reserved_remaining_minor - ?, paid_minor = paid_minor + ? WHERE id = ?', [allocation.amount_minor, allocation.amount_minor, allocation.earning_lot_id]);
        await this.ledger(connection, payout.seller_id, `payout:${payout.id}:reserved:paid`, 'payout_paid', 'reserved', 'debit', amount, 'Reserved payout completed', { payoutId });
        await this.ledger(connection, payout.seller_id, `payout:${payout.id}:paid:credit`, 'payout_paid', 'paid', 'credit', amount, 'Seller payout completed', { payoutId });
      } else if (payout.status === 'success') {
        const restored = await this.restoreAllocations(connection, payout, allocations, 'paid_minor');
        await this.ledger(connection, payout.seller_id, `payout:${payout.id}:paid:reversed`, 'payout_restored', 'paid', 'debit', amount, 'Completed payout reversed by provider', { payoutId });
        if (restored) await this.ledger(connection, payout.seller_id, `payout:${payout.id}:available:reversed`, 'payout_restored', 'available', 'credit', restored, 'Reversed payout restored to available earnings', { payoutId });
      } else {
        const restored = await this.restoreAllocations(connection, payout, allocations, 'reserved_remaining_minor');
        await this.ledger(connection, payout.seller_id, `payout:${payout.id}:reserved:restored`, 'payout_restored', 'reserved', 'debit', amount, 'Rejected payout reservation released', { payoutId });
        if (restored) await this.ledger(connection, payout.seller_id, `payout:${payout.id}:available:restored`, 'payout_restored', 'available', 'credit', restored, 'Rejected payout restored to available earnings', { payoutId });
      }
      await connection.query('UPDATE payouts SET status = ?, provider_transfer_code = COALESCE(?, provider_transfer_code), provider_transfer_id = COALESCE(?, provider_transfer_id), initiated_at = COALESCE(initiated_at, NOW(3)), concluded_at = NOW(3), last_error = NULL WHERE id = ?', [outcome, transfer?.transferCode ?? null, transfer?.transferId ?? null, payoutId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  private async restoreAllocations(connection: PoolConnection, payout: PayoutRow, allocations: AllocationRow[], sourceColumn: 'paid_minor' | 'reserved_remaining_minor'): Promise<number> {
    let restoredTotal = 0;
    for (const allocation of allocations) {
      const amount = Number(allocation.amount_minor);
      const [recoveries] = await connection.query<AmountRow[]>(`SELECT SUM(IF(direction='credit', amount_minor, -amount_minor)) amount FROM seller_ledger_entries WHERE seller_id = ? AND suborder_id = ? AND bucket = 'recoverable'`, [payout.seller_id, allocation.suborder_id]);
      const settled = Math.min(amount, Number(recoveries[0]?.amount ?? 0));
      const restored = amount - settled;
      await connection.query(`UPDATE seller_earning_lots SET ${sourceColumn} = ${sourceColumn} - ?, available_remaining_minor = available_remaining_minor + ? WHERE id = ?`, [amount, restored, allocation.earning_lot_id]);
      if (settled) await this.ledger(connection, payout.seller_id, `payout:${payout.id}:recovery:${allocation.earning_lot_id}`, 'refund_recovery_settled', 'recoverable', 'debit', settled, 'Returned provider funds settled refund recovery', { suborderId: allocation.suborder_id, payoutId: payout.id });
      restoredTotal += restored;
    }
    return restoredTotal;
  }

  private async sellerIdForUser(userId: string): Promise<string> {
    const [rows] = await this.pool.query<SellerRow[]>('SELECT id FROM sellers WHERE user_id = ?', [userId]);
    if (!rows[0]) throw new AppError(404, 'SELLER_NOT_FOUND', 'Seller profile not found'); return rows[0].id;
  }

  private async balance(sellerId: string, connection: Pool | PoolConnection = this.pool, lock = false): Promise<EarningsBalance> {
    if (lock) await connection.query('SELECT id FROM sellers WHERE id = ? FOR UPDATE', [sellerId]);
    const [rows] = await connection.query<MoneyRow[]>(`SELECT
      SUM(CASE WHEN bucket='held' THEN IF(direction='credit', amount_minor, -amount_minor) ELSE 0 END) held,
      SUM(CASE WHEN bucket='available' THEN IF(direction='credit', amount_minor, -amount_minor) ELSE 0 END) available,
      SUM(CASE WHEN bucket='reserved' THEN IF(direction='credit', amount_minor, -amount_minor) ELSE 0 END) reserved,
      SUM(CASE WHEN bucket='paid' THEN IF(direction='credit', amount_minor, -amount_minor) ELSE 0 END) paid,
      SUM(CASE WHEN bucket='recoverable' THEN IF(direction='credit', amount_minor, -amount_minor) ELSE 0 END) recoverable
      FROM seller_ledger_entries WHERE seller_id = ?`, [sellerId]);
    const row = rows[0]!;
    return { sellerId, currency: 'NGN', heldMinor: Number(row.held ?? 0), availableMinor: Number(row.available ?? 0), reservedMinor: Number(row.reserved ?? 0), paidMinor: Number(row.paid ?? 0), recoverableMinor: Number(row.recoverable ?? 0), holdDays: this.policy.holdDays ?? null, policyConfigured: this.policy.holdDays !== undefined };
  }

  private async ledger(connection: PoolConnection, sellerId: string, logicalKey: string, entryType: string, bucket: string, direction: string, amount: number, description: string, refs: { suborderId?: string; refundAdjustmentId?: string; payoutId?: string }): Promise<void> {
    await connection.query(`INSERT IGNORE INTO seller_ledger_entries (id, seller_id, suborder_id, refund_adjustment_id, payout_id, logical_key, entry_type, bucket, direction, amount_minor, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), sellerId, refs.suborderId ?? null, refs.refundAdjustmentId ?? null, refs.payoutId ?? null, logicalKey, entryType, bucket, direction, amount, description]);
  }

  private serializePayout(row: PayoutRow): object { return { id: row.id, sellerId: row.seller_id, amountMinor: Number(row.amount_minor), currency: row.currency, status: row.status, providerReference: row.provider_reference, providerTransferCode: row.provider_transfer_code, lastError: row.last_error, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }; }
}
