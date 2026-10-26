import { timingSafeEqual, createHmac } from 'node:crypto';

export interface InitializePaymentInput {
  email: string;
  amountMinor: number;
  currency: 'NGN';
  reference: string;
  callbackUrl?: string;
  metadata: { order_id: string; payment_id: string };
}

export interface InitializedPayment {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface VerifiedPayment {
  status: string;
  reference: string;
  amountMinor: number;
  currency: string;
  providerTransactionId: string;
  paidAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface PaymentProvider {
  initialize(input: InitializePaymentInput): Promise<InitializedPayment>;
  verify(reference: string): Promise<VerifiedPayment>;
}

export class PaymentProviderError extends Error {
  public constructor(public readonly code: string, message: string, public readonly transient: boolean) { super(message); }
}

interface PaystackEnvelope<T> { status?: boolean; message?: string; data?: T }
interface PaystackInitializeData { authorization_url?: unknown; access_code?: unknown; reference?: unknown }
interface PaystackVerifyData { status?: unknown; reference?: unknown; amount?: unknown; currency?: unknown; id?: unknown; paid_at?: unknown; paidAt?: unknown; metadata?: unknown }

export class PaystackHttpProvider implements PaymentProvider {
  public constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.paystack.co',
    private readonly timeoutMs = 10_000,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  public async initialize(input: InitializePaymentInput): Promise<InitializedPayment> {
    const body: Record<string, unknown> = {
      email: input.email,
      amount: String(input.amountMinor),
      currency: input.currency,
      reference: input.reference,
      metadata: input.metadata
    };
    if (input.callbackUrl) body.callback_url = input.callbackUrl;
    const envelope = await this.request<PaystackInitializeData>('/transaction/initialize', { method: 'POST', body: JSON.stringify(body) });
    const data = envelope.data;
    if (!data || typeof data.authorization_url !== 'string' || typeof data.access_code !== 'string' || typeof data.reference !== 'string') {
      throw new PaymentProviderError('PAYSTACK_INVALID_RESPONSE', 'Paystack returned an invalid initialization response', false);
    }
    return { authorizationUrl: data.authorization_url, accessCode: data.access_code, reference: data.reference };
  }

  public async verify(reference: string): Promise<VerifiedPayment> {
    const envelope = await this.request<PaystackVerifyData>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    const data = envelope.data;
    if (!data || typeof data.status !== 'string' || typeof data.reference !== 'string' || typeof data.amount !== 'number' || !Number.isSafeInteger(data.amount) || data.amount < 0 || typeof data.currency !== 'string' || (typeof data.id !== 'number' && typeof data.id !== 'string')) {
      throw new PaymentProviderError('PAYSTACK_INVALID_RESPONSE', 'Paystack returned an invalid verification response', false);
    }
    const paidValue = data.paid_at ?? data.paidAt;
    const paidAt = typeof paidValue === 'string' && !Number.isNaN(Date.parse(paidValue)) ? new Date(paidValue) : null;
    return {
      status: data.status,
      reference: data.reference,
      amountMinor: data.amount,
      currency: data.currency,
      providerTransactionId: String(data.id),
      paidAt,
      metadata: isRecord(data.metadata) ? data.metadata : {}
    };
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
      throw new PaymentProviderError('PAYSTACK_UNAVAILABLE', error instanceof Error ? error.message : 'Paystack request failed', true);
    }
    let envelope: PaystackEnvelope<T>;
    try { envelope = await response.json() as PaystackEnvelope<T>; }
    catch { throw new PaymentProviderError('PAYSTACK_INVALID_RESPONSE', 'Paystack returned a non-JSON response', response.status >= 500); }
    if (!response.ok || envelope.status !== true) {
      throw new PaymentProviderError('PAYSTACK_REQUEST_FAILED', envelope.message ?? 'Paystack rejected the request', response.status >= 500 || response.status === 429);
    }
    return envelope;
  }
}

export class UnconfiguredPaymentProvider implements PaymentProvider {
  public async initialize(): Promise<InitializedPayment> { throw new PaymentProviderError('PAYSTACK_NOT_CONFIGURED', 'Paystack is not configured', false); }
  public async verify(): Promise<VerifiedPayment> { throw new PaymentProviderError('PAYSTACK_NOT_CONFIGURED', 'Paystack is not configured', false); }
}

export function verifyPaystackSignature(rawBody: Buffer, signature: string | undefined, secret: string | undefined): boolean {
  if (!signature || !secret || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
