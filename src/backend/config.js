import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(here, '.env'), quiet: true });

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const supabaseUrl = env.SUPABASE_URL || '';
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const flutterwaveSecretKey = env.FLUTTERWAVE_SECRET_KEY || '';

  return {
    nodeEnv,
    isProduction,
    port: int(env.PORT, 4310),
    host: env.HOST || '0.0.0.0',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5317,http://127.0.0.1:5317')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    logLevel: env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),

    supabase: {
      url: supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      enabled: Boolean(supabaseUrl && supabaseServiceRoleKey),
      allowInMemory: bool(env.ALLOW_IN_MEMORY_STORE, !isProduction),
    },

    flutterwave: {
      secretKey: flutterwaveSecretKey,
      // The "Secret hash" configured under Settings > Webhooks in the Flutterwave dashboard.
      secretHash: env.FLUTTERWAVE_SECRET_HASH || (flutterwaveSecretKey ? '' : 'chula-local-webhook-hash'),
      baseUrl: env.FLUTTERWAVE_BASE_URL || 'https://api.flutterwave.com/v3',
      enabled: Boolean(flutterwaveSecretKey),
      allowSimulated: bool(env.ALLOW_SIMULATED_PAYMENTS, !isProduction),
      simulatedDelayMs: int(env.SIMULATED_PAYMENT_DELAY_MS, 4000),
      redirectUrl: env.PAYMENT_REDIRECT_URL || '',
    },

    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      model: env.GEMINI_MODEL || 'gemini-1.5-flash',
      embeddingModel: env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
      enabled: Boolean(env.GEMINI_API_KEY),
    },

    whatsapp: {
      token: env.WHATSAPP_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || 'chula-local-verify-token',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      graphVersion: env.WHATSAPP_GRAPH_VERSION || 'v21.0',
      enabled: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
      simulatorEnabled: bool(env.ENABLE_WHATSAPP_SIMULATOR, !isProduction),
    },

    housekeepingIntervalMs: int(env.HOUSEKEEPING_INTERVAL_MS, 5 * 60 * 1000),
    pendingOrderTimeoutMinutes: int(env.PENDING_ORDER_TIMEOUT_MINUTES, 30),
  };
}

export function assertProductionConfig(config) {
  if (!config.isProduction) return;
  const problems = [];
  if (!config.supabase.enabled && !config.supabase.allowInMemory) {
    problems.push('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or set ALLOW_IN_MEMORY_STORE=true)');
  }
  if (!config.flutterwave.enabled && !config.flutterwave.allowSimulated) {
    problems.push('FLUTTERWAVE_SECRET_KEY is required (or set ALLOW_SIMULATED_PAYMENTS=true)');
  }
  if (config.flutterwave.enabled && !config.flutterwave.secretHash) {
    problems.push('FLUTTERWAVE_SECRET_HASH is required to verify payment webhooks');
  }
  if (config.whatsapp.enabled && !config.whatsapp.appSecret) {
    problems.push('WHATSAPP_APP_SECRET is required to verify WhatsApp webhooks');
  }
  if (problems.length) {
    throw new Error(`Invalid production configuration:\n - ${problems.join('\n - ')}`);
  }
}
