import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createOpaqueToken, hashToken } from '../auth/token.js';
import { AppError } from '../http/errors.js';
import { addMoney, convertNgnToUsdMinor, moneyValue, multiplyMoney } from './money.js';
import type { BasketOwner, GuestAddress, QuoteInput } from './types.js';

type Queryable = Pool | PoolConnection;
interface BasketRow extends RowDataPacket { id: string; user_id: string | null; guest_token_hash: string | null; status: 'active' | 'merged'; expires_at: Date | null; merged_into_basket_id: string | null; created_at: Date; updated_at: Date }
interface BasketItemRow extends RowDataPacket { basket_id: string; product_id: string; quantity: number; observed_price_minor: number | string; name: string; seller_id: string; seller_name: string; current_price_minor: number | string; publication_status: string; stock_quantity: number; category_active: number; identity_status: string; approval_status: string }
interface ProductRow extends RowDataPacket { id: string; seller_id: string; name: string; price_minor: number | string; publication_status: string; stock_quantity: number; category_active: number; identity_status: string; approval_status: string }
interface ZoneRow extends RowDataPacket { id: string; code: string; name: string; coverage: string | string[]; fee_minor: number | string; min_business_days: number; max_business_days: number; is_active: number; created_at: Date; updated_at: Date }
interface PickupRow extends RowDataPacket { id: string; name: string; address_line: string; city: string; state: string; fee_minor: number | string; min_business_days: number; max_business_days: number; is_active: number; is_synthetic: number; created_at: Date; updated_at: Date }
interface AddressRow extends RowDataPacket { id: string; user_id: string; recipient_name: string; phone: string; line1: string; line2: string | null; city: string; state: string; country_code: string }
interface RateRow extends RowDataPacket { currency: string; ngn_minor_per_currency_minor: number | string; updated_at: Date }
interface QuoteRow extends RowDataPacket { id: string; basket_id: string; idempotency_key: string; request_hash: string; delivery_method: 'delivery' | 'pickup'; delivery_zone_id: string | null; pickup_location_id: string | null; destination_snapshot: string | object | null; items_subtotal_minor: number | string; delivery_total_minor: number | string; grand_total_minor: number | string; usd_rate_minor: number | string | null; usd_grand_total_minor: number | string | null; usd_rate_updated_at: Date | null; expires_at: Date; created_at: Date }
interface QuoteItemRow extends RowDataPacket { product_id: string; seller_id: string; product_name: string; quantity: number; unit_price_minor: number | string; line_total_minor: number | string }
interface AllocationRow extends RowDataPacket { seller_id: string; fee_minor: number | string }

const MAX_ITEMS = 50;
const MAX_QUANTITY = 20;

export class BasketService {
  public constructor(private readonly pool: Pool, private readonly guestTtlDays: number, private readonly quoteTtlSeconds: number) {}

  public async createGuestBasket(): Promise<object> {
    const credential = createOpaqueToken();
    await this.pool.query("INSERT INTO baskets (id, guest_token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL ? DAY))", [credential.id, credential.hash, this.guestTtlDays]);
    return { basketId: credential.id, guestBasketToken: credential.raw, expiresInDays: this.guestTtlDays };
  }

  public async getBasket(owner: BasketOwner): Promise<object> {
    const basket = await this.resolveBasket(this.pool, owner, false, owner.kind === 'customer');
    return this.basketView(basket);
  }

  public async setItem(owner: BasketOwner, productId: string, quantity: number): Promise<object> {
    const connection = await this.pool.getConnection();
    let basketId: string;
    try {
      await connection.beginTransaction();
      const basket = await this.resolveBasket(connection, owner, true, owner.kind === 'customer');
      basketId = basket.id;
      const product = await this.lockProduct(connection, productId);
      this.requireAvailable(product, quantity);
      const [existing] = await connection.query<RowDataPacket[]>('SELECT product_id FROM basket_items WHERE basket_id = ? AND product_id = ?', [basket.id, productId]);
      if (!existing[0]) {
        const [counts] = await connection.query<Array<RowDataPacket & { count: number | string }>>('SELECT COUNT(*) AS count FROM basket_items WHERE basket_id = ?', [basket.id]);
        if (Number(counts[0]!.count) >= MAX_ITEMS) throw new AppError(409, 'BASKET_ITEM_LIMIT', `A basket can contain at most ${MAX_ITEMS} distinct products`);
      }
      await connection.query(`INSERT INTO basket_items (basket_id, product_id, quantity, observed_price_minor) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), observed_price_minor = VALUES(observed_price_minor)`, [basket.id, productId, quantity, product.price_minor]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.basketViewById(basketId);
  }

  public async removeItem(owner: BasketOwner, productId: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const basket = await this.resolveBasket(connection, owner, true, false);
      const [result] = await connection.query<ResultSetHeader>('DELETE FROM basket_items WHERE basket_id = ? AND product_id = ?', [basket.id, productId]);
      if (result.affectedRows === 0) throw new AppError(404, 'BASKET_ITEM_NOT_FOUND', 'Basket item not found');
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  public async refreshPrices(owner: BasketOwner): Promise<object> {
    const connection = await this.pool.getConnection();
    let basketId: string;
    try {
      await connection.beginTransaction();
      const basket = await this.resolveBasket(connection, owner, true, false);
      basketId = basket.id;
      const [items] = await connection.query<BasketItemRow[]>(`${BASKET_ITEMS_SELECT} WHERE bi.basket_id = ? ORDER BY p.id FOR UPDATE`, [basket.id]);
      const unavailable = items.filter((item) => !isAvailable(item, item.quantity)).map((item) => item.product_id);
      if (unavailable.length) throw new AppError(409, 'BASKET_ITEM_UNAVAILABLE', 'One or more basket items are unavailable', { productIds: unavailable });
      for (const item of items) await connection.query('UPDATE basket_items SET observed_price_minor = ? WHERE basket_id = ? AND product_id = ?', [item.current_price_minor, basket.id, item.product_id]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.basketViewById(basketId);
  }

  public async mergeGuestBasket(userId: string, guestToken: string): Promise<object> {
    const connection = await this.pool.getConnection();
    let targetId: string;
    try {
      await connection.beginTransaction();
      const [guests] = await connection.query<BasketRow[]>('SELECT * FROM baskets WHERE guest_token_hash = ? FOR UPDATE', [hashToken(guestToken)]);
      const guest = guests[0];
      if (!guest || (guest.expires_at && guest.expires_at.getTime() <= Date.now())) throw new AppError(401, 'INVALID_GUEST_BASKET', 'Guest basket credential is invalid or expired');
      if (guest.status === 'merged') {
        const [targets] = await connection.query<BasketRow[]>('SELECT * FROM baskets WHERE id = ? AND user_id = ?', [guest.merged_into_basket_id, userId]);
        if (!targets[0]) throw new AppError(409, 'GUEST_BASKET_ALREADY_MERGED', 'Guest basket has already been merged into another account');
        targetId = targets[0].id;
        await connection.commit();
        return this.basketViewById(targetId);
      }
      const customer = await this.resolveBasket(connection, { kind: 'customer', userId }, true, true);
      targetId = customer.id;
      const [customerItems] = await connection.query<Array<RowDataPacket & { product_id: string; quantity: number }>>('SELECT product_id, quantity FROM basket_items WHERE basket_id = ? ORDER BY product_id FOR UPDATE', [customer.id]);
      const [guestItems] = await connection.query<Array<RowDataPacket & { product_id: string; quantity: number }>>('SELECT product_id, quantity FROM basket_items WHERE basket_id = ? ORDER BY product_id FOR UPDATE', [guest.id]);
      const quantities = new Map<string, number>();
      for (const item of customerItems) quantities.set(item.product_id, item.quantity);
      for (const item of guestItems) quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + item.quantity);
      if (quantities.size > MAX_ITEMS) throw new AppError(409, 'BASKET_ITEM_LIMIT', `Merged basket would exceed ${MAX_ITEMS} distinct products`);
      for (const [productId, quantity] of quantities) {
        if (quantity > MAX_QUANTITY) throw new AppError(409, 'BASKET_QUANTITY_LIMIT', `Merged quantity for product ${productId} exceeds ${MAX_QUANTITY}`);
        const product = await this.lockProduct(connection, productId);
        this.requireAvailable(product, quantity);
        await connection.query(`INSERT INTO basket_items (basket_id, product_id, quantity, observed_price_minor) VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), observed_price_minor = VALUES(observed_price_minor)`, [customer.id, productId, quantity, product.price_minor]);
      }
      await connection.query('DELETE FROM basket_items WHERE basket_id = ?', [guest.id]);
      await connection.query("UPDATE baskets SET status = 'merged', merged_into_basket_id = ? WHERE id = ?", [customer.id, guest.id]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.basketViewById(targetId);
  }

  public async listDeliveryOptions(): Promise<object> {
    const [zones] = await this.pool.query<ZoneRow[]>('SELECT * FROM delivery_zones WHERE is_active = TRUE ORDER BY fee_minor, name');
    const [pickups] = await this.pool.query<PickupRow[]>('SELECT * FROM pickup_locations WHERE is_active = TRUE ORDER BY name');
    return { zones: zones.map(zoneView), pickupLocations: pickups.map(pickupView) };
  }

  public async updateZone(actorUserId: string, zoneId: string, input: { name?: string; coverage?: string[]; feeMinor?: number; minBusinessDays?: number; maxBusinessDays?: number; isActive?: boolean }): Promise<object> {
    const [rows] = await this.pool.query<ZoneRow[]>('SELECT * FROM delivery_zones WHERE id = ?', [zoneId]);
    if (!rows[0]) throw new AppError(404, 'DELIVERY_ZONE_NOT_FOUND', 'Delivery zone not found');
    const min = input.minBusinessDays ?? rows[0].min_business_days;
    const max = input.maxBusinessDays ?? rows[0].max_business_days;
    if (min > max) throw new AppError(400, 'INVALID_DELIVERY_ESTIMATE', 'Minimum business days cannot exceed maximum business days');
    const sets: string[] = []; const values: unknown[] = [];
    addUpdate(sets, values, 'name', input.name?.trim()); addUpdate(sets, values, 'coverage', input.coverage ? JSON.stringify(input.coverage.map(normalizeLocation)) : undefined);
    addUpdate(sets, values, 'fee_minor', input.feeMinor); addUpdate(sets, values, 'min_business_days', input.minBusinessDays); addUpdate(sets, values, 'max_business_days', input.maxBusinessDays); addUpdate(sets, values, 'is_active', input.isActive);
    await this.pool.query(`UPDATE delivery_zones SET ${sets.join(', ')} WHERE id = ?`, [...values, zoneId]);
    const [updated] = await this.pool.query<ZoneRow[]>('SELECT * FROM delivery_zones WHERE id = ?', [zoneId]);
    await this.auditDeliveryConfig(actorUserId, 'delivery_zone', zoneId, 'updated', zoneView(rows[0]), zoneView(updated[0]!));
    return zoneView(updated[0]!);
  }

  public async createZone(actorUserId: string, input: { code: string; name: string; coverage: string[]; feeMinor: number; minBusinessDays: number; maxBusinessDays: number; isActive: boolean }): Promise<object> {
    if (input.minBusinessDays > input.maxBusinessDays) throw new AppError(400, 'INVALID_DELIVERY_ESTIMATE', 'Minimum business days cannot exceed maximum business days');
    const id = randomUUID();
    try {
      await this.pool.query('INSERT INTO delivery_zones (id, code, name, coverage, fee_minor, min_business_days, max_business_days, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, input.code, input.name.trim(), JSON.stringify(input.coverage.map(normalizeLocation)), input.feeMinor, input.minBusinessDays, input.maxBusinessDays, input.isActive, actorUserId]);
    } catch (error) {
      if (isDuplicate(error)) throw new AppError(409, 'DELIVERY_ZONE_EXISTS', 'A delivery zone with this code already exists');
      throw error;
    }
    const [rows] = await this.pool.query<ZoneRow[]>('SELECT * FROM delivery_zones WHERE id = ?', [id]);
    await this.auditDeliveryConfig(actorUserId, 'delivery_zone', id, 'created', null, zoneView(rows[0]!));
    return zoneView(rows[0]!);
  }

  public async createPickup(actorUserId: string, input: { name: string; addressLine: string; city: string; state: string; feeMinor: number; minBusinessDays: number; maxBusinessDays: number; isActive: boolean }): Promise<object> {
    if (input.minBusinessDays > input.maxBusinessDays) throw new AppError(400, 'INVALID_DELIVERY_ESTIMATE', 'Minimum business days cannot exceed maximum business days');
    if (normalizeLocation(input.state) !== 'lagos') throw new AppError(400, 'INVALID_PICKUP_STATE', 'Pickup locations must be in Lagos State');
    const id = randomUUID();
    await this.pool.query('INSERT INTO pickup_locations (id, name, address_line, city, state, fee_minor, min_business_days, max_business_days, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, input.name.trim(), input.addressLine.trim(), input.city.trim(), input.state.trim(), input.feeMinor, input.minBusinessDays, input.maxBusinessDays, input.isActive, actorUserId]);
    const [rows] = await this.pool.query<PickupRow[]>('SELECT * FROM pickup_locations WHERE id = ?', [id]);
    await this.auditDeliveryConfig(actorUserId, 'pickup_location', id, 'created', null, pickupView(rows[0]!));
    return pickupView(rows[0]!);
  }

  public async updatePickup(actorUserId: string, pickupId: string, input: { name?: string; addressLine?: string; city?: string; state?: string; feeMinor?: number; minBusinessDays?: number; maxBusinessDays?: number; isActive?: boolean }): Promise<object> {
    const [rows] = await this.pool.query<PickupRow[]>('SELECT * FROM pickup_locations WHERE id = ?', [pickupId]);
    const current = rows[0];
    if (!current) throw new AppError(404, 'PICKUP_LOCATION_NOT_FOUND', 'Pickup location not found');
    const state = input.state ?? current.state;
    const min = input.minBusinessDays ?? current.min_business_days;
    const max = input.maxBusinessDays ?? current.max_business_days;
    if (normalizeLocation(state) !== 'lagos') throw new AppError(400, 'INVALID_PICKUP_STATE', 'Pickup locations must be in Lagos State');
    if (min > max) throw new AppError(400, 'INVALID_DELIVERY_ESTIMATE', 'Minimum business days cannot exceed maximum business days');
    const sets: string[] = []; const values: unknown[] = [];
    addUpdate(sets, values, 'name', input.name?.trim()); addUpdate(sets, values, 'address_line', input.addressLine?.trim()); addUpdate(sets, values, 'city', input.city?.trim()); addUpdate(sets, values, 'state', input.state?.trim()); addUpdate(sets, values, 'fee_minor', input.feeMinor); addUpdate(sets, values, 'min_business_days', input.minBusinessDays); addUpdate(sets, values, 'max_business_days', input.maxBusinessDays); addUpdate(sets, values, 'is_active', input.isActive);
    await this.pool.query(`UPDATE pickup_locations SET ${sets.join(', ')} WHERE id = ?`, [...values, pickupId]);
    const [updated] = await this.pool.query<PickupRow[]>('SELECT * FROM pickup_locations WHERE id = ?', [pickupId]);
    await this.auditDeliveryConfig(actorUserId, 'pickup_location', pickupId, 'updated', pickupView(current), pickupView(updated[0]!));
    return pickupView(updated[0]!);
  }

  public async setUsdRate(actorUserId: string, rate: number): Promise<object> {
    const [previous] = await this.pool.query<RateRow[]>("SELECT * FROM indicative_exchange_rates WHERE currency = 'USD'");
    await this.pool.query(`INSERT INTO indicative_exchange_rates (currency, ngn_minor_per_currency_minor, updated_by) VALUES ('USD', ?, ?)
      ON DUPLICATE KEY UPDATE ngn_minor_per_currency_minor = VALUES(ngn_minor_per_currency_minor), updated_by = VALUES(updated_by), updated_at = NOW(3)`, [rate, actorUserId]);
    const [rows] = await this.pool.query<RateRow[]>("SELECT * FROM indicative_exchange_rates WHERE currency = 'USD'");
    await this.auditDeliveryConfig(actorUserId, 'exchange_rate', 'USD', previous[0] ? 'updated' : 'created', previous[0] ? rateView(previous[0]) : null, rateView(rows[0]!));
    return rateView(rows[0]!);
  }

  public async createQuote(owner: BasketOwner, input: QuoteInput, idempotencyKey: string): Promise<{ quote: object; idempotentReplay: boolean }> {
    const connection = await this.pool.getConnection();
    let quoteId: string;
    let replay = false;
    try {
      await connection.beginTransaction();
      const basket = await this.resolveBasket(connection, owner, true, false);
      const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const [existing] = await connection.query<QuoteRow[]>('SELECT * FROM checkout_quotes WHERE basket_id = ? AND idempotency_key = ? FOR UPDATE', [basket.id, idempotencyKey]);
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used with different quote input');
        if (existing[0].expires_at.getTime() <= Date.now()) throw new AppError(410, 'QUOTE_EXPIRED', 'Checkout quote has expired');
        quoteId = existing[0].id; replay = true;
        await connection.commit();
      } else {
      const [items] = await connection.query<BasketItemRow[]>(`${BASKET_ITEMS_SELECT} WHERE bi.basket_id = ? ORDER BY p.id FOR UPDATE`, [basket.id]);
      if (!items.length) throw new AppError(409, 'BASKET_EMPTY', 'Cannot quote an empty basket');
      const unavailable = items.filter((item) => !isAvailable(item, item.quantity)).map((item) => item.product_id);
      if (unavailable.length) throw new AppError(409, 'BASKET_ITEM_UNAVAILABLE', 'One or more basket items are unavailable or out of stock', { productIds: unavailable });
      const stale = items.filter((item) => moneyValue(item.observed_price_minor) !== moneyValue(item.current_price_minor)).map((item) => ({ productId: item.product_id, observedPriceMinor: moneyValue(item.observed_price_minor), currentPriceMinor: moneyValue(item.current_price_minor) }));
      if (stale.length) throw new AppError(409, 'STALE_BASKET_PRICE', 'Basket prices changed; refresh the basket before requesting a quote', { items: stale });

      const destination = await this.resolveDestination(connection, owner, input);
      const lineTotals = items.map((item) => multiplyMoney(item.current_price_minor, item.quantity));
      const subtotal = addMoney(lineTotals);
      const sellerIds = [...new Set(items.map((item) => item.seller_id))].sort();
      const feePerSeller = destination.feeMinor;
      const deliveryTotal = multiplyMoney(feePerSeller, sellerIds.length);
      const grandTotal = addMoney([subtotal, deliveryTotal]);
      const [rates] = await connection.query<RateRow[]>("SELECT * FROM indicative_exchange_rates WHERE currency = 'USD'");
      const rate = rates[0];
      const usdRate = rate ? moneyValue(rate.ngn_minor_per_currency_minor) : null;
      const usdTotal = usdRate ? convertNgnToUsdMinor(grandTotal, usdRate) : null;
      quoteId = randomUUID();
      await connection.query(`INSERT INTO checkout_quotes
        (id, basket_id, idempotency_key, request_hash, delivery_method, delivery_zone_id, pickup_location_id, destination_snapshot, items_subtotal_minor, delivery_total_minor, grand_total_minor, usd_rate_minor, usd_grand_total_minor, usd_rate_updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))`, [quoteId, basket.id, idempotencyKey, requestHash, input.deliveryMethod, destination.zoneId, destination.pickupId, JSON.stringify(destination.snapshot), subtotal, deliveryTotal, grandTotal, usdRate, usdTotal, rate?.updated_at ?? null, this.quoteTtlSeconds]);
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        await connection.query('INSERT INTO checkout_quote_items (quote_id, product_id, seller_id, product_name, quantity, unit_price_minor, line_total_minor) VALUES (?, ?, ?, ?, ?, ?, ?)', [quoteId, item.product_id, item.seller_id, item.name, item.quantity, item.current_price_minor, lineTotals[index]]);
      }
      for (const sellerId of sellerIds) await connection.query('INSERT INTO checkout_quote_delivery_allocations (quote_id, seller_id, fee_minor) VALUES (?, ?, ?)', [quoteId, sellerId, feePerSeller]);
      await connection.commit();
      }
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return { quote: await this.quoteView(quoteId), idempotentReplay: replay };
  }

  public async getQuote(owner: BasketOwner, quoteId: string): Promise<object> {
    const basket = await this.resolveBasket(this.pool, owner, false, false);
    const [rows] = await this.pool.query<QuoteRow[]>('SELECT * FROM checkout_quotes WHERE id = ? AND basket_id = ?', [quoteId, basket.id]);
    if (!rows[0]) throw new AppError(404, 'QUOTE_NOT_FOUND', 'Checkout quote not found');
    if (rows[0].expires_at.getTime() <= Date.now()) throw new AppError(410, 'QUOTE_EXPIRED', 'Checkout quote has expired');
    return this.quoteView(quoteId);
  }

  private async resolveDestination(connection: PoolConnection, owner: BasketOwner, input: QuoteInput): Promise<{ zoneId: string | null; pickupId: string | null; feeMinor: number; snapshot: object }> {
    if (input.deliveryMethod === 'pickup') {
      const [rows] = await connection.query<PickupRow[]>('SELECT * FROM pickup_locations WHERE id = ? AND is_active = TRUE', [input.pickupLocationId]);
      const pickup = rows[0];
      if (!pickup) throw new AppError(409, 'PICKUP_LOCATION_UNAVAILABLE', 'Pickup location is unavailable');
      return { zoneId: null, pickupId: pickup.id, feeMinor: moneyValue(pickup.fee_minor), snapshot: { method: 'pickup', name: pickup.name, addressLine: pickup.address_line, city: pickup.city, state: pickup.state, estimate: { minBusinessDays: pickup.min_business_days, maxBusinessDays: pickup.max_business_days } } };
    }
    const [zones] = await connection.query<ZoneRow[]>('SELECT * FROM delivery_zones WHERE id = ? AND is_active = TRUE', [input.zoneId]);
    const zone = zones[0];
    if (!zone) throw new AppError(409, 'DELIVERY_ZONE_UNAVAILABLE', 'Delivery zone is unavailable');
    let address: GuestAddress;
    if (owner.kind === 'customer') {
      if (!input.addressId || input.address) throw new AppError(400, 'ADDRESS_ID_REQUIRED', 'Authenticated customers must select one of their saved addresses');
      const [addresses] = await connection.query<AddressRow[]>('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [input.addressId, owner.userId]);
      const saved = addresses[0];
      if (!saved) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
      address = { recipientName: saved.recipient_name, phone: saved.phone, line1: saved.line1, ...(saved.line2 ? { line2: saved.line2 } : {}), city: saved.city, state: saved.state, countryCode: saved.country_code };
    } else {
      if (!input.address || input.addressId) throw new AppError(400, 'GUEST_ADDRESS_REQUIRED', 'Guest checkout requires a delivery address');
      address = input.address;
    }
    if (normalizeLocation(address.state) !== 'lagos' || address.countryCode.toUpperCase() !== 'NG') throw new AppError(409, 'DELIVERY_ADDRESS_UNSUPPORTED', 'Delivery is limited to supported Lagos addresses');
    const coverage = jsonArray(zone.coverage).map(normalizeLocation);
    if (!coverage.includes(normalizeLocation(address.city))) throw new AppError(409, 'DELIVERY_ZONE_MISMATCH', 'Selected delivery zone does not cover the address city or area');
    return { zoneId: zone.id, pickupId: null, feeMinor: moneyValue(zone.fee_minor), snapshot: { method: 'delivery', zone: zoneView(zone), address } };
  }

  private async resolveBasket(queryable: Queryable, owner: BasketOwner, lock: boolean, createCustomer: boolean): Promise<BasketRow> {
    if (owner.kind === 'guest') {
      const [rows] = await queryable.query<BasketRow[]>(`SELECT * FROM baskets WHERE guest_token_hash = ?${lock ? ' FOR UPDATE' : ''}`, [hashToken(owner.token)]);
      const basket = rows[0];
      if (!basket || basket.status !== 'active' || !basket.expires_at || basket.expires_at.getTime() <= Date.now()) throw new AppError(401, 'INVALID_GUEST_BASKET', 'Guest basket credential is invalid or expired');
      return basket;
    }
    const [rows] = await queryable.query<BasketRow[]>(`SELECT * FROM baskets WHERE user_id = ?${lock ? ' FOR UPDATE' : ''}`, [owner.userId]);
    if (rows[0]) return rows[0];
    if (!createCustomer) throw new AppError(404, 'BASKET_NOT_FOUND', 'Basket not found');
    const id = randomUUID();
    try { await queryable.query('INSERT INTO baskets (id, user_id) VALUES (?, ?)', [id, owner.userId]); }
    catch (error) {
      if (!isDuplicate(error)) throw error;
      const [raced] = await queryable.query<BasketRow[]>(`SELECT * FROM baskets WHERE user_id = ?${lock ? ' FOR UPDATE' : ''}`, [owner.userId]);
      if (raced[0]) return raced[0];
      throw error;
    }
    const [created] = await queryable.query<BasketRow[]>(`SELECT * FROM baskets WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
    return created[0]!;
  }

  private async lockProduct(connection: PoolConnection, productId: string): Promise<ProductRow> {
    const [rows] = await connection.query<ProductRow[]>(`${PRODUCT_SELECT} WHERE p.id = ? FOR UPDATE`, [productId]);
    if (!rows[0]) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    return rows[0];
  }

  private requireAvailable(product: ProductRow, quantity: number): void {
    if (!isAvailable(product, quantity)) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'Product is unpublished, unavailable, or has insufficient stock');
  }

  private async basketView(basket: BasketRow): Promise<object> { return this.basketViewById(basket.id); }
  private async basketViewById(basketId: string): Promise<object> {
    const [baskets] = await this.pool.query<BasketRow[]>('SELECT * FROM baskets WHERE id = ?', [basketId]);
    const basket = baskets[0];
    if (!basket) throw new AppError(404, 'BASKET_NOT_FOUND', 'Basket not found');
    const [items] = await this.pool.query<BasketItemRow[]>(`${BASKET_ITEMS_SELECT} WHERE bi.basket_id = ? ORDER BY bi.created_at, bi.product_id`, [basketId]);
    const views = items.map((item) => {
      const observed = moneyValue(item.observed_price_minor); const current = moneyValue(item.current_price_minor);
      return { productId: item.product_id, name: item.name, seller: { id: item.seller_id, businessName: item.seller_name }, quantity: item.quantity, observedPriceMinor: observed, currentPriceMinor: current, lineTotalMinor: multiplyMoney(observed, item.quantity), priceChanged: observed !== current, available: isAvailable(item, item.quantity), stockQuantity: item.stock_quantity };
    });
    return { id: basket.id, ownerType: basket.user_id ? 'customer' : 'guest', status: basket.status, expiresAt: basket.expires_at, items: views, totals: { currency: 'NGN', itemsSubtotalMinor: addMoney(views.map((item) => item.lineTotalMinor)) }, createdAt: basket.created_at, updatedAt: basket.updated_at };
  }

  private async quoteView(quoteId: string): Promise<object> {
    const [quotes] = await this.pool.query<QuoteRow[]>('SELECT * FROM checkout_quotes WHERE id = ?', [quoteId]);
    const quote = quotes[0];
    if (!quote) throw new AppError(404, 'QUOTE_NOT_FOUND', 'Checkout quote not found');
    const [items] = await this.pool.query<QuoteItemRow[]>('SELECT * FROM checkout_quote_items WHERE quote_id = ? ORDER BY product_id', [quoteId]);
    const [allocations] = await this.pool.query<AllocationRow[]>('SELECT * FROM checkout_quote_delivery_allocations WHERE quote_id = ? ORDER BY seller_id', [quoteId]);
    return { id: quote.id, basketId: quote.basket_id, deliveryMethod: quote.delivery_method, destination: jsonObject(quote.destination_snapshot), currency: 'NGN', items: items.map((item) => ({ productId: item.product_id, sellerId: item.seller_id, productName: item.product_name, quantity: item.quantity, unitPriceMinor: moneyValue(item.unit_price_minor), lineTotalMinor: moneyValue(item.line_total_minor) })), deliveryAllocations: allocations.map((item) => ({ sellerId: item.seller_id, feeMinor: moneyValue(item.fee_minor) })), totals: { itemsSubtotalMinor: moneyValue(quote.items_subtotal_minor), deliveryTotalMinor: moneyValue(quote.delivery_total_minor), grandTotalMinor: moneyValue(quote.grand_total_minor) }, usdIndicative: quote.usd_rate_minor === null ? null : { currency: 'USD', grandTotalMinor: moneyValue(quote.usd_grand_total_minor!), ngnMinorPerUsdMinor: moneyValue(quote.usd_rate_minor), rateUpdatedAt: quote.usd_rate_updated_at, settlementCurrency: 'NGN' }, expiresAt: quote.expires_at, createdAt: quote.created_at };
  }

  private async auditDeliveryConfig(actorUserId: string, entityType: 'delivery_zone' | 'pickup_location' | 'exchange_rate', entityId: string, action: string, previousValue: object | null, newValue: object): Promise<void> {
    await this.pool.query('INSERT INTO delivery_config_audit_events (actor_user_id, entity_type, entity_id, action, previous_value, new_value) VALUES (?, ?, ?, ?, ?, ?)', [actorUserId, entityType, entityId, action, previousValue ? JSON.stringify(previousValue) : null, JSON.stringify(newValue)]);
  }
}

const PRODUCT_SELECT = `SELECT p.id, p.seller_id, p.name, p.price_minor, p.publication_status, p.stock_quantity,
  c.is_active AS category_active, s.identity_status, s.approval_status
  FROM products p JOIN categories c ON c.id = p.category_id JOIN sellers s ON s.id = p.seller_id`;
const BASKET_ITEMS_SELECT = `SELECT bi.*, p.name, p.seller_id, s.business_name AS seller_name, p.price_minor AS current_price_minor,
  p.publication_status, p.stock_quantity, c.is_active AS category_active, s.identity_status, s.approval_status
  FROM basket_items bi JOIN products p ON p.id = bi.product_id JOIN categories c ON c.id = p.category_id JOIN sellers s ON s.id = p.seller_id`;

function isAvailable(product: Pick<ProductRow, 'publication_status' | 'stock_quantity' | 'category_active' | 'identity_status' | 'approval_status'>, quantity: number): boolean {
  return product.publication_status === 'published' && Boolean(product.category_active) && product.identity_status === 'verified' && product.approval_status === 'approved' && product.stock_quantity >= quantity;
}
function normalizeLocation(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, ' '); }
function jsonArray(value: string | string[]): string[] { return typeof value === 'string' ? JSON.parse(value) as string[] : value; }
function jsonObject(value: string | object | null): object | null { return typeof value === 'string' ? JSON.parse(value) as object : value; }
function zoneView(row: ZoneRow): object { return { id: row.id, code: row.code, name: row.name, coverage: jsonArray(row.coverage), feeMinor: moneyValue(row.fee_minor), estimate: { minBusinessDays: row.min_business_days, maxBusinessDays: row.max_business_days }, isActive: Boolean(row.is_active), updatedAt: row.updated_at }; }
function pickupView(row: PickupRow): object { return { id: row.id, name: row.name, addressLine: row.address_line, city: row.city, state: row.state, feeMinor: moneyValue(row.fee_minor), estimate: { minBusinessDays: row.min_business_days, maxBusinessDays: row.max_business_days }, isActive: Boolean(row.is_active), updatedAt: row.updated_at }; }
function rateView(row: RateRow): object { return { currency: row.currency, ngnMinorPerUsdMinor: moneyValue(row.ngn_minor_per_currency_minor), updatedAt: row.updated_at, settlementCurrency: 'NGN' }; }
function addUpdate(sets: string[], values: unknown[], column: string, value: unknown): void { if (value !== undefined) { sets.push(`${column} = ?`); values.push(value); } }
function isDuplicate(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'; }
