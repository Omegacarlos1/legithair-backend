ALTER TABLE seller_ledger_entries
  MODIFY COLUMN entry_type ENUM('earning_held', 'hold_released', 'refund_reversal', 'refund_recoverable', 'refund_recovery_settled', 'payout_reserved', 'payout_paid', 'payout_restored') NOT NULL;
