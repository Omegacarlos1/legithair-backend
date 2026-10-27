import { PaymentProviderError } from '../payments/provider.js';

export interface CreateRefundInput {
  transactionReference: string;
  amountMinor: number;
  currency: 'NGN';
  customerNote: string;
  merchantNote: string;
}

export interface ProviderRefund {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  transactionReference?: string;
  processedAt: Date | null;
}

export interface RefundProvider {
  create(input: CreateRefundInput): Promise<ProviderRefund>;
  fetch(providerRefundId: string): Promise<ProviderRefund>;
}

interface PaystackEnvelope<T> { status?: boolean; message?: string; data?: T }
interface RefundData {
  id?: unknown;
  status?: unknown;
  amount?: unknown;
  currency?: unknown;
  transaction?: unknown;
  transaction_reference?: unknown;
  refunded_at?: unknown;
}

export class PaystackRefundProvider implements RefundProvider {
  public constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.paystack.co',
    private readonly timeoutMs = 10_000,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  public async create(input: CreateRefundInput): Promise<ProviderRefund> {
    const envelope = await this.request<RefundData>('/refund', {
      method: 'POST',
      body: JSON.stringify({
        transaction: input.transactionReference,
        amount: input.amountMinor,
        currency: input.currency,
        customer_note: input.customerNote,
        merchant_note: input.merchantNote
      })
    });
    return parseRefund(envelope.data);
  }

  public async fetch(providerRefundId: string): Promise<ProviderRefund> {
    const envelope = await this.request<RefundData>(`/refund/${encodeURIComponent(providerRefundId)}`, { method: 'GET' });
    return parseRefund(envelope.data);
  }

  private async request<T>(path: string, init: RequestInit): Promise<PaystackEnvelope<T>> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new PaymentProviderError('PAYSTACK_UNAVAILABLE', error instanceof Error ? error.message : 'Paystack refund request failed', true);
    }
    let envelope: PaystackEnvelope<T>;
    try { envelope = await response.json() as PaystackEnvelope<T>; }
    catch { throw new PaymentProviderError('PAYSTACK_INVALID_RESPONSE', 'Paystack returned a non-JSON refund response', response.status >= 500); }
    if (!response.ok || envelope.status !== true) {
      throw new PaymentProviderError('PAYSTACK_REQUEST_FAILED', envelope.message ?? 'Paystack rejected the refund request', response.status >= 500 || response.status === 429);
    }
    return envelope;
  }
}

export class UnconfiguredRefundProvider implements RefundProvider {
  public async create(): Promise<ProviderRefund> { throw new PaymentProviderError('PAYSTACK_NOT_CONFIGURED', 'Paystack refunds are not configured', false); }
  public async fetch(): Promise<ProviderRefund> { throw new PaymentProviderError('PAYSTACK_NOT_CONFIGURED', 'Paystack refunds are not configured', false); }
}

function parseRefund(data: RefundData | undefined): ProviderRefund {
  if (!data || (typeof data.id !== 'number' && typeof data.id !== 'string') || typeof data.status !== 'string' || typeof data.amount !== 'number' || !Number.isSafeInteger(data.amount) || data.amount < 0 || typeof data.currency !== 'string') {
    throw new PaymentProviderError('PAYSTACK_INVALID_RESPONSE', 'Paystack returned an invalid refund response', false);
  }
  const processedAt = typeof data.refunded_at === 'string' && !Number.isNaN(Date.parse(data.refunded_at)) ? new Date(data.refunded_at) : null;
  let transactionReference: string | undefined;
  if (typeof data.transaction_reference === 'string') transactionReference = data.transaction_reference;
  else if (isRecord(data.transaction) && typeof data.transaction.reference === 'string') transactionReference = data.transaction.reference;
  return { id: String(data.id), status: data.status, amountMinor: data.amount, currency: data.currency, ...(transactionReference ? { transactionReference } : {}), processedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
