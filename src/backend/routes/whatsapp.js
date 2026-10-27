import { Router } from 'express';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { normalizeUgandanPhone } from '../lib/phone.js';
import { extractInboundMessages, verifyMetaSignature } from '../services/whatsappClient.js';

const SEEN_TTL_MS = 60 * 60 * 1000;
const SEEN_MAX = 5000;

/**
 * WhatsApp Cloud API webhook for merchant staff. Each inbound text is
 * interpreted by Gemini (see services/gemini.js) into a command:
 *   "Listed 5 bags today at 7000 UGX" -> upsert today's surplus_bags row
 *   "Token 482910"                    -> verify and mark the order collected
 * and the agent's reply is sent back over WhatsApp.
 */
export function createWhatsAppRouter({ agent, whatsappClient, config, logger, store }) {
  const router = Router();
  const seen = new Map();

  const alreadySeen = (id) => {
    if (!id) return false;
    const cutoff = Date.now() - SEEN_TTL_MS;
    for (const [key, at] of seen) {
      if (at < cutoff || seen.size > SEEN_MAX) seen.delete(key);
      else break;
    }
    if (seen.has(id)) return true;
    seen.set(id, Date.now());
    return false;
  };

  // Meta's one-time subscription handshake.
  router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
      return res.status(200).type('text/plain').send(String(challenge ?? ''));
    }
    return res.sendStatus(403);
  });

  router.post('/webhook', (req, res) => {
    if (config.whatsapp.appSecret) {
      const valid = verifyMetaSignature({
        rawBody: req.rawBody,
        signatureHeader: req.get('x-hub-signature-256'),
        appSecret: config.whatsapp.appSecret,
      });
      if (!valid) {
        logger.warn('Rejected WhatsApp webhook with bad signature');
        return res.sendStatus(401);
      }
    } else if (config.isProduction) {
      logger.error('WHATSAPP_APP_SECRET is not set; refusing unsigned webhook in production');
      return res.sendStatus(401);
    }

    // Acknowledge immediately; Meta retries if we take too long.
    res.sendStatus(200);

    const messages = extractInboundMessages(req.body).filter((m) => m.text && !alreadySeen(m.id));
    for (const message of messages) {
      (async () => {
        await whatsappClient.markRead(message.id);
        const { reply } = await agent.handleMessage({ from: message.from, text: message.text });
        if (reply) await whatsappClient.sendText(message.from, reply);
      })().catch((error) => logger.error('WhatsApp message handling failed', { from: message.from, error: error.message }));
    }
  });

  if (config.whatsapp.simulatorEnabled) {
    // Local stand-in for a merchant's WhatsApp chat: same agent, reply returned inline.
    router.post(
      '/simulate',
      asyncHandler(async (req, res) => {
        const { from, text } = req.body ?? {};
        if (!normalizeUgandanPhone(from)) throw badRequest('from must be a Ugandan phone number');
        if (!text || typeof text !== 'string' || text.length > 1000) throw badRequest('text is required (max 1000 chars)');
        const result = await agent.handleMessage({ from, text });
        res.json(result);
      }),
    );

    router.get(
      '/simulator/merchants',
      asyncHandler(async (_req, res) => {
        res.json({ merchants: await store.listMerchantContacts() });
      }),
    );
  } else {
    router.all(['/simulate', '/simulator/merchants'], () => {
      throw notFound();
    });
  }

  return router;
}
