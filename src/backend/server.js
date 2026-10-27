import { pathToFileURL } from 'node:url';
import cors from 'cors';
import express from 'express';
import { assertProductionConfig, loadConfig } from './config.js';
import { HttpError } from './lib/errors.js';
import { createLogger } from './lib/logger.js';
import { createRequireUser } from './middleware/auth.js';
import { createBagsRouter } from './routes/bags.js';
import { createOrdersRouter } from './routes/orders.js';
import { createPaymentsRouter } from './routes/payments.js';
import { createWhatsAppRouter } from './routes/whatsapp.js';
import { createFlutterwaveClient, createSimulatedMobileMoney } from './services/flutterwave.js';
import { createEmbedder, createMessageInterpreter } from './services/gemini.js';
import { createMerchantAgent } from './services/merchantAgent.js';
import { createPaymentService } from './services/paymentService.js';
import { createWhatsAppClient } from './services/whatsappClient.js';
import { createStore } from './store/index.js';

function createPaymentProvider(config, logger) {
  if (config.flutterwave.enabled) {
    return createFlutterwaveClient({
      secretKey: config.flutterwave.secretKey,
      baseUrl: config.flutterwave.baseUrl,
      redirectUrl: config.flutterwave.redirectUrl,
      logger,
    });
  }
  if (!config.flutterwave.allowSimulated) {
    throw new Error('FLUTTERWAVE_SECRET_KEY is not set and ALLOW_SIMULATED_PAYMENTS is disabled');
  }
  logger.warn('FLUTTERWAVE_SECRET_KEY not set: Mobile Money payments are simulated');
  return createSimulatedMobileMoney({
    delayMs: config.flutterwave.simulatedDelayMs,
    secretHash: config.flutterwave.secretHash,
    logger,
  });
}

/**
 * Build the Express app. Every dependency can be injected so tests run the
 * real routes against the in-memory store and simulated provider.
 */
export function createApp(overrides = {}) {
  const config = overrides.config ?? loadConfig();
  const logger = overrides.logger ?? createLogger(config.logLevel);
  const store = overrides.store ?? createStore(config, logger);
  const provider = overrides.provider ?? createPaymentProvider(config, logger);
  const interpreter =
    overrides.interpreter ??
    createMessageInterpreter({ apiKey: config.gemini.apiKey, model: config.gemini.model, logger });
  const embedder =
    overrides.embedder !== undefined
      ? overrides.embedder
      : createEmbedder({ apiKey: config.gemini.apiKey, model: config.gemini.embeddingModel, logger });
  const whatsappClient = overrides.whatsappClient ?? createWhatsAppClient({ ...config.whatsapp, logger });

  const paymentService = createPaymentService({ store, provider, config, logger });
  const agent = createMerchantAgent({ store, interpreter, embedder, logger });
  const requireUser = createRequireUser({ store });

  provider.setWebhookDeliverer?.((delivery) => paymentService.handleWebhook(delivery));

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Chula-Demo-User', 'X-Chula-User-Name'],
      methods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  // Keep the exact bytes: webhook signatures are computed over the raw body.
  app.use(
    express.json({
      limit: '256kb',
      verify: (req, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'chula-api',
      modes: {
        data: store.kind,
        payments: provider.kind,
        ai: interpreter.source,
        whatsapp: whatsappClient.enabled ? 'live' : 'log-only',
      },
      whatsappSimulator: config.whatsapp.simulatorEnabled,
    });
  });

  app.use('/api/bags', createBagsRouter({ store }));
  app.use('/api/orders', createOrdersRouter({ store, requireUser }));
  app.use('/api/payments', createPaymentsRouter({ paymentService, requireUser, logger }));
  app.use('/api/whatsapp', createWhatsAppRouter({ agent, whatsappClient, config, logger, store }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, _next) => {
    if (error instanceof SyntaxError && error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body is not valid JSON' });
    }
    if (error instanceof HttpError) {
      if (error.status >= 500) logger.error(error.message, { path: req.path, details: error.details });
      return res.status(error.status).json({ error: error.message });
    }
    logger.error('Unhandled error', { path: req.path, error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return { app, config, logger, store, provider, paymentService, agent };
}

export function startServer(overrides = {}) {
  const context = createApp(overrides);
  const { app, config, logger, store } = context;

  const server = app.listen(config.port, config.host, () => {
    logger.info(`Chula API listening on http://${config.host}:${config.port}`, {
      data: store.kind,
      payments: context.provider.kind,
    });
  });

  const housekeeping = setInterval(async () => {
    try {
      const result = await store.runHousekeeping({ pendingTimeoutMinutes: config.pendingOrderTimeoutMinutes });
      if (result?.expired_bags || result?.cancelled_orders) logger.info('Housekeeping', result);
    } catch (error) {
      logger.error('Housekeeping failed', { error: error.message });
    }
  }, config.housekeepingIntervalMs);
  housekeeping.unref();

  const shutdown = (signal) => {
    logger.info(`Received ${signal}, shutting down`);
    clearInterval(housekeeping);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  return { ...context, server };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  try {
    assertProductionConfig(config);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  startServer({ config });
}
