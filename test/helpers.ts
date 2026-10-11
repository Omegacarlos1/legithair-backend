import pino from 'pino';
import type { Pool } from 'mysql2/promise';
import { createApp } from '../src/app.js';
import type express from 'express';

export function stubPool(query: Pool['query']): Pool { return { query } as Pool; }
export function testApp(pool: Pool): express.Express { return createApp({ pool, logger: pino({ level: 'silent' }), readinessTimeoutMs: 100 }); }
