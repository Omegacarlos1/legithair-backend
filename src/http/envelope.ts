export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: { requestId: string };
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
  meta: { requestId: string };
}
