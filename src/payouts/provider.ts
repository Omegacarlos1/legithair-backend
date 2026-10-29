import { PaymentProviderError } from '../payments/provider.js';

export interface InitiateTransferInput {
  amountMinor: number;
  currency: 'NGN';
  recipientCode: string;
  reference: string;
  reason: string;
}

export interface ProviderTransfer {
  status: string;
  reference: string;
  amountMinor: number;
  currency: string;
  transferCode: string | null;
  transferId: string | null;
}

export interface TransferProvider {
  initiate(input: InitiateTransferInput): Promise<ProviderTransfer>;
  verify(reference: string): Promise<ProviderTransfer>;
}

interface Envelope<T> { status?: boolean; message?: string; data?: T }
interface TransferData { status?: unknown; reference?: unknown; amount?: unknown; currency?: unknown; transfer_code?: unknown; id?: unknown }

export class PaystackTransferProvider implements TransferProvider {
  public constructor(private readonly secretKey: string, private readonly baseUrl = 'https://api.paystack.co', private readonly timeoutMs = 10_000, private readonly fetcher: typeof fetch = fetch) {}

  public async initiate(input: InitiateTransferInput): Promise<ProviderTransfer> {
    const envelope = await this.request<TransferData>('/transfer', { method: 'POST', body: JSON.stringify({ source: 'balance', amount: input.amountMinor, recipient: input.recipientCode, reference: input.reference, reason: input.reason, currency: input.currency }) });
    return parseTransfer(envelope.data);
  }

  public async verify(reference: string): Promise<ProviderTransfer> {
    const envelope = await this.request<TransferData>(`/transfer/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    return parseTransfer(envelope.data);
  }

  private async request<T>(path: string, init: RequestInit): Promise<Envelope<T>> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new PaymentProviderError('PAYSTACK_UNAVAILABLE', error instanceof Error ? error.message : 'Paystack transfer request failed', true);
    }
    let envelope: Envelope<T>;
    try { envelope = await response.json() as Envelope<T>; }
    catch { throw new PaymentProviderError('PAYSTACK_INVALID_RESPONSE', 'Paystack returned a non-JSON transfer response', response.status >= 500); }
    if (!response.ok || envelope.status !== true) throw new PaymentProviderError('PAYSTACK_REQUEST_FAILED', envelope.message ?? 'Paystack rejected the transfer request', response.status >= 500 || response.status === 429);
    return envelope;
  }
}

export class UnconfiguredTransferProvider implements TransferProvider {
  public async initiate(): Promise<ProviderTransfer> { throw new PaymentProviderError('PAYSTACK_NOT_CONFIGURED', 'Paystack transfers are not configured', false); }
  public async verify(): Promise<ProviderTransfer> { throw new PaymentProviderError('PAYSTACK_NOT_CONFIGURED', 'Paystack transfers are not configured', false); }
}

function parseTransfer(data: TransferData | undefined): ProviderTransfer {
  if (!data || typeof data.status !== 'string' || typeof data.reference !== 'string' || typeof data.amount !== 'number' || !Number.isSafeInteger(data.amount) || data.amount < 0 || typeof data.currency !== 'string') throw new PaymentProviderError('PAYSTACK_INVALID_RESPONSE', 'Paystack returned an invalid transfer response', false);
  return { status: data.status, reference: data.reference, amountMinor: data.amount, currency: data.currency, transferCode: typeof data.transfer_code === 'string' ? data.transfer_code : null, transferId: typeof data.id === 'string' || typeof data.id === 'number' ? String(data.id) : null };
}
