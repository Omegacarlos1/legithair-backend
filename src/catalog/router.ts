import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type { Pool } from 'mysql2/promise';
import { z } from 'zod';
import { AuthService } from '../auth/service.js';
import { requireAuthentication, requireRole } from '../auth/middleware.js';
import { AppError } from '../http/errors.js';
import { LocalImageStorage } from './image-storage.js';
import { CatalogService } from './service.js';

const money = z.number().int().nonnegative().max(9_000_000_000_000);
const stock = z.number().int().nonnegative().max(2_000_000_000);
const optionalText = z.string().trim().min(1).max(100).nullable().optional();
const productSchema = z.object({
  categoryId: z.uuid(),
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().min(10).max(10_000),
  priceMinor: money,
  brand: optionalText,
  colour: optionalText,
  size: optionalText,
  lowStockThreshold: stock.optional(),
  initialStock: stock.optional()
}).strict();
const productUpdateSchema = productSchema.omit({ initialStock: true }).partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const publicationSchema = z.object({ status: z.enum(['published', 'unpublished']) }).strict();
const stockSchema = z.object({ delta: z.number().int().min(-2_000_000_000).max(2_000_000_000).refine((value) => value !== 0), reason: z.string().trim().min(3).max(500) }).strict();
const categorySchema = z.object({ name: z.string().trim().min(2).max(100) }).strict();
const categoryUpdateSchema = z.object({ name: z.string().trim().min(2).max(100).optional(), isActive: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(100).optional(),
  categoryId: z.uuid().optional(),
  minPriceMinor: z.coerce.number().int().nonnegative().max(9_000_000_000_000).optional(),
  maxPriceMinor: z.coerce.number().int().nonnegative().max(9_000_000_000_000).optional(),
  brand: z.string().trim().min(1).max(100).optional(),
  colour: z.string().trim().min(1).max(100).optional(),
  size: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'popularity']).default('newest')
}).strict();
const relatedSchema = z.object({ limit: z.coerce.number().int().min(1).max(20).default(8) }).strict();
const uploadFieldsSchema = z.object({ altText: z.string().trim().min(2).max(200), sortOrder: z.coerce.number().int().min(0).max(1000).default(0) }).strict();
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };

export function createCatalogRouter(pool: Pool, imageStorageRoot: string, imageMaxBytes: number): Router {
  const router = Router();
  const auth = new AuthService(pool);
  const catalog = new CatalogService(pool, new LocalImageStorage(imageStorageRoot));
  const authenticated = requireAuthentication(auth);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: imageMaxBytes, files: 1, fields: 5 },
    fileFilter: (_req, file, callback) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
        callback(new AppError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Only JPEG, PNG, and WebP images are allowed'));
        return;
      }
      callback(null, true);
    }
  });
  const receiveImage: RequestHandler = (req, res, next) => {
    upload.single('image')(req, res, (error: unknown) => {
      if (error instanceof AppError) { next(error); return; }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') { next(new AppError(413, 'IMAGE_TOO_LARGE', `Image must not exceed ${imageMaxBytes} bytes`)); return; }
      if (error) { next(new AppError(400, 'INVALID_UPLOAD', 'Image upload is invalid')); return; }
      next();
    });
  };

  router.get('/categories', asyncRoute(async (req, res) => {
    res.json({ success: true, data: { categories: await catalog.listCategories() }, meta: { requestId: req.id } });
  }));
  router.get('/products', asyncRoute(async (req, res) => {
    const result = await catalog.listProducts(listSchema.parse(req.query));
    res.json({ success: true, data: { products: result.products }, meta: { requestId: req.id, pagination: result.pagination } });
  }));
  router.get('/products/:productId/related', asyncRoute(async (req, res) => {
    const productId = z.uuid().parse(req.params.productId);
    const { limit } = relatedSchema.parse(req.query);
    res.json({ success: true, data: { products: await catalog.relatedProducts(productId, limit) }, meta: { requestId: req.id } });
  }));
  router.get('/products/:productId/images/:imageId', asyncRoute(async (req, res) => {
    const productId = z.uuid().parse(req.params.productId);
    const imageId = z.uuid().parse(req.params.imageId);
    const image = await catalog.getPublicImage(productId, imageId);
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(image.bytes);
  }));
  router.get('/products/:productId', asyncRoute(async (req, res) => {
    const productId = z.uuid().parse(req.params.productId);
    res.json({ success: true, data: { product: await catalog.getPublicProduct(productId) }, meta: { requestId: req.id } });
  }));

  router.post('/admin/categories', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const body = categorySchema.parse(req.body);
    res.status(201).json({ success: true, data: { category: await catalog.createCategory(req.authUser!.id, body.name) }, meta: { requestId: req.id } });
  }));
  router.patch('/admin/categories/:categoryId', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const categoryId = z.uuid().parse(req.params.categoryId);
    res.json({ success: true, data: { category: await catalog.updateCategory(categoryId, categoryUpdateSchema.parse(req.body)) }, meta: { requestId: req.id } });
  }));

  router.get('/seller/products', authenticated, requireRole('seller'), asyncRoute(async (req, res) => {
    res.json({ success: true, data: { products: await catalog.listOwnProducts(req.authUser!.id) }, meta: { requestId: req.id } });
  }));
  router.post('/seller/products', authenticated, requireRole('seller'), asyncRoute(async (req, res) => {
    const product = await catalog.createProduct(req.authUser!.id, productSchema.parse(req.body));
    res.status(201).json({ success: true, data: { product }, meta: { requestId: req.id } });
  }));
  router.patch('/seller/products/:productId', authenticated, requireRole('seller'), asyncRoute(async (req, res) => {
    const productId = z.uuid().parse(req.params.productId);
    res.json({ success: true, data: { product: await catalog.updateOwnProduct(req.authUser!.id, productId, productUpdateSchema.parse(req.body)) }, meta: { requestId: req.id } });
  }));
  router.patch('/seller/products/:productId/publication', authenticated, requireRole('seller'), asyncRoute(async (req, res) => {
    const productId = z.uuid().parse(req.params.productId);
    const body = publicationSchema.parse(req.body);
    res.json({ success: true, data: { product: await catalog.setOwnPublication(req.authUser!.id, productId, body.status) }, meta: { requestId: req.id } });
  }));
  router.patch('/seller/products/:productId/stock', authenticated, requireRole('seller'), asyncRoute(async (req, res) => {
    const productId = z.uuid().parse(req.params.productId);
    const body = stockSchema.parse(req.body);
    const key = idempotencyKey(req.header('idempotency-key'));
    res.json({ success: true, data: { adjustment: await catalog.adjustOwnStock(req.authUser!.id, productId, body.delta, body.reason, key) }, meta: { requestId: req.id } });
  }));
  router.post('/seller/products/:productId/images', authenticated, requireRole('seller'), receiveImage, asyncRoute(async (req, res) => {
    const productId = z.uuid().parse(req.params.productId);
    if (!req.file) throw new AppError(400, 'IMAGE_REQUIRED', 'Multipart field image is required');
    const fields = uploadFieldsSchema.parse(req.body);
    const image = await catalog.uploadOwnImage(req.authUser!.id, productId, req.file, fields.altText, fields.sortOrder);
    res.status(201).json({ success: true, data: { image }, meta: { requestId: req.id } });
  }));

  router.patch('/admin/products/:productId', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const productId = z.uuid().parse(req.params.productId);
    res.json({ success: true, data: { product: await catalog.updateAnyProduct(req.authUser!.id, productId, productUpdateSchema.parse(req.body)) }, meta: { requestId: req.id } });
  }));
  router.patch('/admin/products/:productId/publication', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const productId = z.uuid().parse(req.params.productId);
    const body = publicationSchema.parse(req.body);
    res.json({ success: true, data: { product: await catalog.setAnyPublication(req.authUser!.id, productId, body.status) }, meta: { requestId: req.id } });
  }));
  router.patch('/admin/products/:productId/stock', authenticated, requireRole('admin'), asyncRoute(async (req, res) => {
    const productId = z.uuid().parse(req.params.productId);
    const body = stockSchema.parse(req.body);
    const key = idempotencyKey(req.header('idempotency-key'));
    res.json({ success: true, data: { adjustment: await catalog.adjustAnyStock(req.authUser!.id, productId, body.delta, body.reason, key) }, meta: { requestId: req.id } });
  }));
  return router;
}

function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');
  return value;
}
