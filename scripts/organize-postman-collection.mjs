/* eslint-disable @typescript-eslint/explicit-function-return-type -- This is a standalone JavaScript maintenance utility. */
import console from 'node:console';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URLSearchParams } from 'node:url';

const collectionPath = path.resolve(
  process.cwd(),
  'postman/Legit_Hair_Backend.postman_collection.json',
);
const frontendHandoverSourcePath = path.resolve(
  process.cwd(),
  'postman/B12_Smoke.postman_collection.json',
);
const fullRegressionOrderPath = path.resolve(
  process.cwd(),
  'postman/Full_Regression_Order.json',
);
const frontendHandoverPrefix = 'Handover - ';
const fullRegressionPrefix = 'Regression - ';
const manualRegressionPrefix = 'Manual - ';

const topLevelOrder = [
  'auth',
  'seller',
  'admin',
  'products',
  'delivery',
  'payment',
  'finance',
  'full-regression',
  'manual-regression',
  'frontend-handover',
];

const subfolderOrder = {
  auth: ['health', 'registration', 'password-recovery', 'sessions', 'account'],
  seller: ['onboarding', 'catalog', 'fulfilment', 'earnings'],
  admin: [
    'seller-management',
    'catalog-management',
    'fulfilment',
    'reviews-and-merchandising',
    'support-and-marketing',
  ],
  products: ['catalog', 'baskets', 'reviews', 'discovery'],
  delivery: ['quotes', 'orders', 'fulfilment', 'returns-and-cod'],
  payment: [
    'checkout',
    'verification-and-webhooks',
    'receipts',
    'refunds',
  ],
  finance: ['payouts', 'reports'],
  'full-regression': [
    'b01-foundation',
    'b02-authentication',
    'b03-seller-onboarding',
    'b04-catalogue-and-stock',
    'b05-baskets-and-delivery',
    'b06-orders',
    'b07-payments',
    'b08-fulfilment-and-refunds',
    'b09-earnings-and-payouts',
    'b10-reviews-and-reporting',
    'b11-support-and-notifications',
    'b12-release-hardening',
  ],
  'manual-regression': ['controlled-environment'],
  'frontend-handover': [
    'health-and-security',
    'customer',
    'public-catalogue-and-delivery',
    'seller',
    'admin',
    'finance',
    'support',
  ],
};

const regressionMilestones = [
  ['B01', 'b01-foundation'],
  ['B02', 'b02-authentication'],
  ['B03', 'b03-seller-onboarding'],
  ['B04', 'b04-catalogue-and-stock'],
  ['B05', 'b05-baskets-and-delivery'],
  ['B06', 'b06-orders'],
  ['B07', 'b07-payments'],
  ['B08', 'b08-fulfilment-and-refunds'],
  ['B09', 'b09-earnings-and-payouts'],
  ['B10', 'b10-reviews-and-reporting'],
  ['B11', 'b11-support-and-notifications'],
  ['B12', 'b12-release-hardening'],
];

const rules = [
  {
    route: ['auth', 'health'],
    matches: (name) =>
      /^(Health|Ready|B12 Health|B12 Ready|B12 Disallowed browser origin)/.test(
        name,
      ),
  },
  {
    route: ['auth', 'registration'],
    matches: (name) =>
      /^B02 (Register|Resend verification|Verify email token)/.test(name),
  },
  {
    route: ['auth', 'password-recovery'],
    matches: (name) =>
      /^B02 (Forgot password|Reset password|Password reset login confirmation)/.test(
        name,
      ),
  },
  {
    route: ['auth', 'sessions'],
    matches: (name) =>
      /^B(?:02|03|04|05) Login/.test(name) ||
      /^B09 Finance login$|^B10 Support login$/.test(name),
  },
  {
    route: ['auth', 'account'],
    matches: (name) =>
      /^B02 (Me|Other customer's addresses)/.test(name) ||
      /^B11 Customer marketing opt-(in|out)$/.test(name),
  },
  {
    route: ['seller', 'onboarding'],
    matches: (name) =>
      /^B03 (Create seller|Get own seller|Verification|Suspended seller verification)/.test(
        name,
      ),
  },
  {
    route: ['seller', 'catalog'],
    matches: (name) =>
      /^B04 (Create draft product|Upload product image|Upload missing image|Publish product|Adjust stock|Replay stock adjustment|Other seller stock)/.test(
        name,
      ),
  },
  {
    route: ['seller', 'fulfilment'],
    matches: (name) =>
      /^B08 (Seller delivery jump|First seller|Other seller|COD seller)/.test(name),
  },
  {
    route: ['seller', 'earnings'],
    matches: (name) => /^B09 Seller earnings$/.test(name),
  },
  {
    route: ['admin', 'seller-management'],
    matches: (name) => /^B03 (Approve seller|Suspend seller)/.test(name),
  },
  {
    route: ['admin', 'catalog-management'],
    matches: (name) => /^B04 Create category/.test(name),
  },
  {
    route: ['admin', 'fulfilment'],
    matches: (name) => /^B08 Admin delivers/.test(name),
  },
  {
    route: ['admin', 'reviews-and-merchandising'],
    matches: (name) =>
      /^B10 (Publish review|Reject published review|Create active banner)/.test(name),
  },
  {
    route: ['admin', 'support-and-marketing'],
    matches: (name) =>
      /^B11 (Create support thread|Read support history fallback|Cross-thread access|Support HTTP reply|Create marketing campaign|Support campaign creation)/.test(
        name,
      ),
  },
  {
    route: ['products', 'catalog'],
    matches: (name) =>
      /^B04 (Draft product hidden|Browse filtered products)/.test(name),
  },
  {
    route: ['products', 'baskets'],
    matches: (name) =>
      /^B05 (Create guest basket|Guest set|Customer set existing product|Merge guest basket)/.test(
        name,
      ) || /^B06 (Create guest basket for COD|Add guest COD item)/.test(name),
  },
  {
    route: ['products', 'reviews'],
    matches: (name) =>
      /^B10 (Submit purchased-product review|Other customer review|Read published product reviews|Rejected review hidden)/.test(
        name,
      ),
  },
  {
    route: ['products', 'discovery'],
    matches: (name) => /^B10 (Category related products|Read active banners)/.test(name),
  },
  {
    route: ['delivery', 'quotes'],
    matches: (name) =>
      /^B05 (Delivery options|Guest quote|Customer quote)/.test(name) ||
      /^B06 Create guest COD quote$/.test(name),
  },
  {
    route: ['delivery', 'orders'],
    matches: (name) =>
      /^B06 (Create Paystack order|Reuse order key|Get customer order|Get order without credential|Create guest COD order|Guest order with wrong tracking credential|Track guest order)/.test(
        name,
      ),
  },
  {
    route: ['delivery', 'fulfilment'],
    matches: (name) =>
      /^B08 (Read customer fulfilment|Guest reads reconciled COD fulfilment)/.test(
        name,
      ),
  },
  {
    route: ['delivery', 'returns-and-cod'],
    matches: (name) =>
      /^B08 (Submit partial return|Replay partial return|Cross-customer returns access|Record exact COD collection|Confirm COD collection)/.test(
        name,
      ),
  },
  {
    route: ['payment', 'checkout'],
    matches: (name) => /^B07 Initialize/.test(name),
  },
  {
    route: ['payment', 'verification-and-webhooks'],
    matches: (name) =>
      /^B07 (Verify callback tampering|Verify persisted Paystack reference|Forged Paystack webhook)/.test(
        name,
      ) || /^B08 Forged refund webhook/.test(name),
  },
  {
    route: ['payment', 'receipts'],
    matches: (name) => /^B07 Download paid receipt/.test(name),
  },
  {
    route: ['payment', 'refunds'],
    matches: (name) =>
      /^B08 (Admin approves Paystack test refund|Reconcile delayed Paystack refund)/.test(
        name,
      ),
  },
  {
    route: ['finance', 'payouts'],
    matches: (name) =>
      /^B09 (Seller payout approval|Configure verified Paystack recipient|Finance creates payout|Finance reads payout)/.test(
        name,
      ),
  },
  {
    route: ['finance', 'reports'],
    matches: (name) =>
      /^B10 (Finance |Support financial report|Products CSV export)/.test(name),
  },
  {
    route: ['frontend-handover', 'health-and-security'],
    matches: (name) =>
      /^Handover - (Health and security headers|Database readiness|Disallowed browser origin)$/.test(
        name,
      ),
  },
  {
    route: ['frontend-handover', 'customer'],
    matches: (name) =>
      /^Handover - (Login customer fixture|Read current customer)$/.test(name),
  },
  {
    route: ['frontend-handover', 'public-catalogue-and-delivery'],
    matches: (name) =>
      /^Handover - (Browse published catalogue|Read delivery options)$/.test(name),
  },
  {
    route: ['frontend-handover', 'seller'],
    matches: (name) =>
      /^Handover - (Login seller fixture|Read seller catalogue)$/.test(name),
  },
  {
    route: ['frontend-handover', 'admin'],
    matches: (name) =>
      /^Handover - (Login admin fixture|Read moderation queue)$/.test(name),
  },
  {
    route: ['frontend-handover', 'finance'],
    matches: (name) =>
      /^Handover - (Login finance fixture|Read sales reconciliation report)$/.test(
        name,
      ),
  },
  {
    route: ['frontend-handover', 'support'],
    matches: (name) =>
      /^Handover - (Login support fixture|Read support queue)$/.test(name),
  },
];

rules.push(
  ...regressionMilestones.map(([milestone, subfolder]) => ({
    route: ['full-regression', subfolder],
    matches: (name) => {
      if (!name.startsWith(fullRegressionPrefix)) return false;
      const originalName = name.slice(fullRegressionPrefix.length);
      return milestone === 'B01'
        ? !/^B\d{2} /.test(originalName)
        : originalName.startsWith(`${milestone} `);
    },
  })),
);

rules.push({
  route: ['manual-regression', 'controlled-environment'],
  matches: (name) => name.startsWith(manualRegressionPrefix),
});

const source = JSON.parse(await readFile(collectionPath, 'utf8'));
const frontendHandoverSource = JSON.parse(
  await readFile(frontendHandoverSourcePath, 'utf8'),
);
const fullRegressionOrderSource = JSON.parse(
  await readFile(fullRegressionOrderPath, 'utf8'),
);

const flattenRequests = (items) =>
  items.flatMap((entry) => {
    if (Array.isArray(entry.item)) {
      return flattenRequests(entry.item);
    }
    if (entry.request) {
      return [entry];
    }
    throw new Error(`Collection entry "${entry.name}" is neither a folder nor a request.`);
  });

if (!Array.isArray(source.item)) {
  throw new Error('Expected the maintained collection to contain an item array.');
}
if (!Array.isArray(frontendHandoverSource.item)) {
  throw new Error('Expected the frontend handover source to contain an item array.');
}
if (!Array.isArray(fullRegressionOrderSource.requests)) {
  throw new Error('Expected the full regression order source to contain a requests array.');
}
if (!Array.isArray(fullRegressionOrderSource.manualRequests)) {
  throw new Error('Expected the full regression order source to contain a manualRequests array.');
}

const frontendHandoverRequests = flattenRequests(frontendHandoverSource.item).map(
  (request) => {
    const clonedRequest = JSON.parse(JSON.stringify(request));
    clonedRequest.name = `${frontendHandoverPrefix}${request.name}`;
    return clonedRequest;
  },
);
const baseRequests = flattenRequests(source.item).filter(
  (request) =>
    !request.name.startsWith(frontendHandoverPrefix) &&
    !request.name.startsWith(fullRegressionPrefix) &&
    !request.name.startsWith(manualRegressionPrefix),
);
const baseRequestsByName = new Map(
  baseRequests.map((request) => [request.name, request]),
);
const orderedNames = fullRegressionOrderSource.requests;
const manualNames = fullRegressionOrderSource.manualRequests;
const allRegressionNames = [...orderedNames, ...manualNames];
const orderedNameSet = new Set(allRegressionNames);
const missingFromCollection = allRegressionNames.filter(
  (name) => !baseRequestsByName.has(name),
);
const missingFromOrder = baseRequests
  .map((request) => request.name)
  .filter((name) => !orderedNameSet.has(name));
if (
  orderedNameSet.size !== allRegressionNames.length ||
  missingFromCollection.length > 0 ||
  missingFromOrder.length > 0
) {
  throw new Error(
    JSON.stringify(
      {
        message: 'The full regression order must cover every maintained domain request exactly once.',
        duplicateOrderNames: allRegressionNames.length - orderedNameSet.size,
        missingFromCollection,
        missingFromOrder,
      },
      null,
      2,
    ),
  );
}
const fullRegressionRequests = orderedNames.map((name) => {
  const clonedRequest = JSON.parse(JSON.stringify(baseRequestsByName.get(name)));
  clonedRequest.name = `${fullRegressionPrefix}${name}`;
  return clonedRequest;
});
const manualRegressionRequests = manualNames.map((name) => {
  const clonedRequest = JSON.parse(JSON.stringify(baseRequestsByName.get(name)));
  clonedRequest.name = `${manualRegressionPrefix}${name}`;
  return clonedRequest;
});
const sourceRequests = [
  ...baseRequests,
  ...frontendHandoverRequests,
  ...fullRegressionRequests,
  ...manualRegressionRequests,
];

for (const request of sourceRequests) {
  const url = request.request?.url;
  const rawUrl = typeof url === 'string' ? url : url?.raw;
  if (typeof rawUrl !== 'string' || !rawUrl.includes('?')) {
    continue;
  }

  const baseUrl = rawUrl.slice(0, rawUrl.indexOf('?'));
  const queryString = rawUrl.slice(rawUrl.indexOf('?') + 1);
  const queryParams = new URLSearchParams(queryString);
  const normalizedQuery = queryParams.toString().replaceAll('+', ' ');
  const variableHostMatch = baseUrl.match(/^(\{\{[^}]+\}\})(?:\/(.*))?$/);
  if (!variableHostMatch) {
    throw new Error(`Query URL must use a Postman variable host: ${rawUrl}`);
  }
  request.request.url = {
    raw: `${baseUrl}?${normalizedQuery}`,
    host: [variableHostMatch[1]],
    path: variableHostMatch[2]?.split('/').filter(Boolean) ?? [],
    query: [...queryParams].map(([key, value]) => ({
      key,
      value,
    })),
  };
}

const routed = new Map();
for (const topLevel of topLevelOrder) {
  for (const subfolder of subfolderOrder[topLevel]) {
    routed.set(`${topLevel}/${subfolder}`, []);
  }
}

const unmatched = [];
const ambiguous = [];
for (const request of sourceRequests) {
  const matchingRules = rules.filter((rule) => rule.matches(request.name));
  if (matchingRules.length === 0) {
    unmatched.push(request.name);
    continue;
  }
  if (matchingRules.length > 1) {
    ambiguous.push({
      name: request.name,
      routes: matchingRules.map((rule) => rule.route.join('/')),
    });
    continue;
  }

  const routeKey = matchingRules[0].route.join('/');
  routed.get(routeKey).push(request);
}

if (unmatched.length > 0 || ambiguous.length > 0) {
  throw new Error(
    JSON.stringify(
      {
        message: 'Every request must have exactly one destination folder.',
        unmatched,
        ambiguous,
      },
      null,
      2,
    ),
  );
}

const organizedItems = topLevelOrder.map((topLevel) => ({
  name: topLevel,
  item: subfolderOrder[topLevel]
    .map((subfolder) => ({
      name: subfolder,
      item: routed.get(`${topLevel}/${subfolder}`),
    }))
    .filter((folder) => folder.item.length > 0),
}));

const organizedCount = organizedItems.reduce(
  (topTotal, topFolder) =>
    topTotal +
    topFolder.item.reduce(
      (subTotal, subfolder) => subTotal + subfolder.item.length,
      0,
    ),
  0,
);

if (organizedCount !== sourceRequests.length) {
  throw new Error(
    `Request count changed during organization: ${sourceRequests.length} -> ${organizedCount}.`,
  );
}

source.info.name = 'legit-hair';
source.info.description = [
  'Maintained Legit Hair backend samples for milestones B01-B12.',
  '',
  'Folders are organized by API domain. Request names retain their milestone labels for traceability.',
  'The full-regression folder duplicates every maintained domain request in B01-B12 dependency order so logins and generated test values are available before use.',
  'The manual-regression folder contains controlled checks that require MariaDB to be stopped or a token captured from the fake email job; it is intentionally excluded from the ordinary full-regression run.',
  'The frontend-handover folder contains the provider-safe role-login smoke that frontend can rerun without persisting tokens.',
  'Select the Local environment and run `npm run seed:test` before workflows that require synthetic fixture IDs.',
  'Provider and money-movement requests require separate test-mode authorization; this collection does not authorize live money movement.',
].join('\n');
source.item = organizedItems;
source.variable = [
  {
    key: 'baseUrl',
    value: 'http://127.0.0.1:3000',
    type: 'string',
    description: 'Local fallback. An active Postman environment can override this value.',
  },
  ...['customerToken', 'sellerToken', 'adminToken', 'financeToken', 'supportToken'].map(
    (key) => ({
      key,
      value: '',
      type: 'string',
      description: 'Runtime-only frontend handover token. Do not persist a real token here.',
    }),
  ),
];

await writeFile(collectionPath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      collection: source.info.name,
      requests: organizedCount,
      topLevelFolders: organizedItems.map((folder) => folder.name),
      subfolders: Object.fromEntries(
        organizedItems.map((folder) => [
          folder.name,
          folder.item.map((subfolder) => ({
            name: subfolder.name,
            requests: subfolder.item.length,
          })),
        ]),
      ),
    },
    null,
    2,
  ),
);
