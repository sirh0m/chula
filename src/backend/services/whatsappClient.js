import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify Meta's X-Hub-Signature-256 header ("sha256=<hex hmac of raw body>"). */
export function verifyMetaSignature({ rawBody, signatureHeader, appSecret }) {
  if (!appSecret || !rawBody || !signatureHeader?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const received = Buffer.from(signatureHeader.slice('sha256='.length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Flatten a WhatsApp Cloud API webhook payload into inbound text messages. */
export function extractInboundMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const message of value.messages ?? []) {
        let text = null;
        if (message.type === 'text') text = message.text?.body ?? null;
        else if (message.type === 'button') text = message.button?.text ?? null;
        else if (message.type === 'interactive') {
          text = message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? null;
        }
        messages.push({
          id: message.id,
          from: message.from,
          name: names.get(message.from) ?? null,
          type: message.type,
          text,
          timestamp: message.timestamp,
        });
      }
    }
  }
  return messages;
}

export function createWhatsAppClient({ token, phoneNumberId, graphVersion, enabled, logger, fetchImpl = fetch }) {
  return {
    enabled,

    async sendText(to, body) {
      if (!enabled) {
        logger.info('WhatsApp send skipped (WHATSAPP_TOKEN not configured)', { to, body });
        return { delivered: false };
      }
      const response = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        logger.error('WhatsApp send failed', { to, status: response.status, detail });
        return { delivered: false, status: response.status };
      }
      return { delivered: true };
    },

    async markRead(messageId) {
      if (!enabled || !messageId) return;
      await fetchImpl(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
        signal: AbortSignal.timeout(10_000),
      }).catch((error) => logger.warn('WhatsApp mark-read failed', { error: error.message }));
    },
  };
}
