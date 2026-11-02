/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, no-undef -- Postman simulation scripts run in a CommonJS sandbox with the pm global. */
const http = require('http');

const PORT = process.env.PORT || 4511;
const JSON_HEADERS = { 'content-type': 'application/json' };
const STATE_KEYS = {
  transactions: 'paystack-local.transactions',
  refunds: 'paystack-local.refunds',
  transfers: 'paystack-local.transfers',
};

const server = http.createServer(async (req, res) => {
  const bodyPromise = readJson(req);
  const url = new URL(req.url, 'http://paystack.local');
  const path = url.pathname;

  if (req.method === 'POST' && path === '/__reset') {
    await Promise.all(Object.values(STATE_KEYS).map((key) => pm.state.set(key, {})));
    return send(res, 200, { status: true, message: 'Local Paystack state reset' });
  }

  if (!/^Bearer sk_test_[A-Za-z0-9]+$/.test(req.headers.authorization || '')) {
    return send(res, 401, { status: false, message: 'A synthetic test bearer key is required' });
  }

  if (req.method === 'POST' && path === '/transaction/initialize') {
    const body = await bodyPromise;
    const amount = Number(body.amount);
    if (!body.reference || !Number.isSafeInteger(amount) || amount < 0) {
      return send(res, 400, { status: false, message: 'Invalid synthetic transaction' });
    }
    const transactions = (await pm.state.get(STATE_KEYS.transactions)) || {};
    transactions[body.reference] = {
      reference: body.reference,
      amount,
      currency: body.currency || 'NGN',
      metadata: body.metadata || {},
    };
    await pm.state.set(STATE_KEYS.transactions, transactions);
    return send(res, 200, {
      status: true,
      message: 'Authorization URL created',
      data: {
        authorization_url: `https://checkout.example.test/${body.reference}`,
        access_code: `access_${body.reference}`,
        reference: body.reference,
      },
    });
  }

  if (req.method === 'GET' && path.startsWith('/transaction/verify/')) {
    const reference = decodeURIComponent(path.slice('/transaction/verify/'.length));
    const transactions = (await pm.state.get(STATE_KEYS.transactions)) || {};
    const transaction = transactions[reference];
    if (!transaction) {
      return send(res, 404, { status: false, message: 'Synthetic transaction not found' });
    }
    return send(res, 200, {
      status: true,
      message: 'Verification successful',
      data: {
        status: 'success',
        reference,
        amount: transaction.amount,
        currency: transaction.currency,
        id: `txn_${reference}`,
        paid_at: '2026-11-02T10:00:00.000Z',
        metadata: transaction.metadata,
      },
    });
  }

  if (req.method === 'POST' && path === '/refund') {
    const body = await bodyPromise;
    const refunds = (await pm.state.get(STATE_KEYS.refunds)) || {};
    const id = `refund_${Object.keys(refunds).length + 1}`;
    refunds[id] = {
      id,
      status: 'pending',
      amount: Number(body.amount),
      currency: body.currency || 'NGN',
      transaction_reference: body.transaction,
    };
    await pm.state.set(STATE_KEYS.refunds, refunds);
    return send(res, 200, { status: true, message: 'Refund queued', data: refunds[id] });
  }

  if (req.method === 'GET' && path.startsWith('/refund/')) {
    const id = decodeURIComponent(path.slice('/refund/'.length));
    const refunds = (await pm.state.get(STATE_KEYS.refunds)) || {};
    const refund = refunds[id];
    if (!refund) {
      return send(res, 404, { status: false, message: 'Synthetic refund not found' });
    }
    refund.status = 'processed';
    refund.refunded_at = '2026-11-02T10:05:00.000Z';
    await pm.state.set(STATE_KEYS.refunds, refunds);
    return send(res, 200, { status: true, message: 'Refund processed', data: refund });
  }

  if (req.method === 'POST' && path === '/transfer') {
    const body = await bodyPromise;
    const transfers = (await pm.state.get(STATE_KEYS.transfers)) || {};
    transfers[body.reference] = {
      status: 'success',
      reference: body.reference,
      amount: Number(body.amount),
      currency: body.currency || 'NGN',
      transfer_code: `TRF_${Object.keys(transfers).length + 1}`,
      id: `transfer_${Object.keys(transfers).length + 1}`,
    };
    await pm.state.set(STATE_KEYS.transfers, transfers);
    return send(res, 200, { status: true, message: 'Transfer queued', data: transfers[body.reference] });
  }

  if (req.method === 'GET' && path.startsWith('/transfer/verify/')) {
    const reference = decodeURIComponent(path.slice('/transfer/verify/'.length));
    const transfers = (await pm.state.get(STATE_KEYS.transfers)) || {};
    const transfer = transfers[reference];
    if (!transfer) {
      return send(res, 404, { status: false, message: 'Synthetic transfer not found' });
    }
    return send(res, 200, { status: true, message: 'Transfer verified', data: transfer });
  }

  return send(res, 501, {
    status: false,
    message: `Endpoint not modelled by the local Paystack stand-in: ${req.method} ${path}`,
  });
});

function send(res, statusCode, body) {
  res.writeHead(statusCode, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        const value = raw ? JSON.parse(raw) : {};
        resolve(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
      } catch {
        resolve({});
      }
    });
  });
}

server.listen(PORT);
