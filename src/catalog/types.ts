export type PublicationStatus = 'draft' | 'published' | 'unpublished';
export type ProductSort = 'newest' | 'price_asc' | 'price_desc' | 'popularity';

export interface ProductInput {
  categoryId: string;
  name: string;
  description: string;
  priceMinor: number;
  brand?: string | null;
  colour?: string | null;
  size?: string | null;
  lowStockThreshold?: number;
  initialStock?: number;
}

export interface ProductUpdateInput {
  categoryId?: string;
  name?: string;
  description?: string;
  priceMinor?: number;
  brand?: string | null;
  colour?: string | null;
  size?: string | null;
  lowStockThreshold?: number;
}

export interface ProductListQuery {
  page: number;
  limit: number;
  q?: string;
  categoryId?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  brand?: string;
  colour?: string;
  size?: string;
  sort: ProductSort;
}

export interface ProductImage {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  altText: string;
  sortOrder: number;
}

export interface ProductView {
  id: string;
  seller: { id: string; businessName: string };
  category: { id: string; name: string; slug: string };
  name: string;
  slug: string;
  description: string;
  priceMinor: number;
  brand: string | null;
  colour: string | null;
  size: string | null;
  publicationStatus: PublicationStatus;
  stockQuantity: number;
  stockAvailable: boolean;
  lowStockThreshold: number;
  isLowStock: boolean;
  paidUnitsSold: number;
  images: ProductImage[];
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}
