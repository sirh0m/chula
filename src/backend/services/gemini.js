import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { INTENTS, extractToken, parseMerchantMessage } from './messageParser.js';
import { kampalaParts } from '../lib/time.js';

const SYSTEM_INSTRUCTION = `You are the WhatsApp assistant for Chula, a food surplus marketplace in Kampala, Uganda.
Merchant staff (bakeries, cafés, restaurants, supermarkets) text you to manage today's "surplus bags"
and to confirm customer pickups. Messages may mix English, Luganda and Ugandan shorthand
(e.g. "7k" = 7000 UGX, "shs", "/=", "6-8" = 6pm to 8pm).

Classify the message into exactly one intent and extract fields:
- list_bags: the merchant is listing or updating surplus bags. Extract quantity (whole number of bags),
  discount_price (the price customers pay per bag, whole UGX), original_price (the normal retail value
  per bag if stated, whole UGX), title (short product name such as "Bakery Bag" if stated, otherwise null),
  pickup_start and pickup_end as 24h "HH:MM" Kampala time if stated, otherwise null.
- redeem_token: a customer is collecting; extract the 6-digit pickup token exactly as digits.
- mark_sold_out: the merchant says everything is sold out / finished / stop listing.
- status: the merchant asks for today's orders, sales or listing summary.
- help: greetings or questions about how to use the service.
- unknown: anything else.

Never invent numbers that are not in the message. Use null for anything not stated.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    intent: { type: Type.STRING, enum: INTENTS },
    quantity: { type: Type.INTEGER, nullable: true },
    discount_price: { type: Type.INTEGER, nullable: true },
    original_price: { type: Type.INTEGER, nullable: true },
    title: { type: Type.STRING, nullable: true },
    pickup_start: { type: Type.STRING, nullable: true },
    pickup_end: { type: Type.STRING, nullable: true },
    token: { type: Type.STRING, nullable: true },
  },
  required: ['intent'],
  propertyOrdering: ['intent', 'quantity', 'discount_price', 'original_price', 'title', 'pickup_start', 'pickup_end', 'token'],
};

const HHMM = z
  .string()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
  .nullable()
  .optional()
  .catch(null);

const ParsedMessage = z.object({
  intent: z.enum(INTENTS).catch('unknown'),
  quantity: z.number().int().min(0).max(500).nullable().optional().catch(null),
  discount_price: z.number().int().min(100).max(5_000_000).nullable().optional().catch(null),
  original_price: z.number().int().min(100).max(10_000_000).nullable().optional().catch(null),
  title: z.string().trim().min(2).max(80).nullable().optional().catch(null),
  pickup_start: HHMM,
  pickup_end: HHMM,
  token: z.string().regex(/^\d{6}$/).nullable().optional().catch(null),
});

function normalize(parsed) {
  return {
    intent: parsed.intent,
    quantity: parsed.quantity ?? null,
    discount_price: parsed.discount_price ?? null,
    original_price: parsed.original_price ?? null,
    title: parsed.title ?? null,
    pickup_start: parsed.pickup_start ?? null,
    pickup_end: parsed.pickup_end ?? null,
    token: parsed.token ?? null,
  };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Gemini timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Turns merchant WhatsApp text into a structured command.
 * Pure token messages skip the model entirely; everything else goes to
 * Gemini with a JSON response schema, falling back to the rule parser.
 */
export function createMessageInterpreter({ apiKey, model, logger, timeoutMs = 8000, client }) {
  const ai = client ?? (apiKey ? new GoogleGenAI({ apiKey }) : null);

  async function askGemini(text, { merchantName, now = new Date() }) {
    const { hour, minute } = kampalaParts(now);
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Merchant: ${merchantName}\nCurrent Kampala time: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}\nMessage: """${text}"""`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
          maxOutputTokens: 256,
        },
      }),
      timeoutMs,
    );
    const parsed = normalize(ParsedMessage.parse(JSON.parse(response.text)));

    // Guard against hallucinated tokens: the digits must appear in the message.
    if (parsed.intent === 'redeem_token') {
      const digits = text.replace(/\D/g, '');
      if (!parsed.token || !digits.includes(parsed.token)) parsed.token = extractToken(text);
    }
    return parsed;
  }

  return {
    source: ai ? 'gemini' : 'rules',

    async interpret(text, context = {}) {
      const fastToken = extractToken(text);
      if (fastToken && text.replace(/\D/g, '').length === 6 && text.length <= 40) {
        return { ...parseMerchantMessage(text), source: 'rules' };
      }
      if (ai) {
        try {
          return { ...(await askGemini(text, context)), source: 'gemini' };
        } catch (error) {
          logger.warn('Gemini interpretation failed; using rule parser', { error: error.message });
        }
      }
      return { ...parseMerchantMessage(text), source: 'rules' };
    },
  };
}

export function createEmbedder({ apiKey, model, logger, client }) {
  const ai = client ?? (apiKey ? new GoogleGenAI({ apiKey }) : null);
  if (!ai) return null;
  return {
    async embed(text) {
      try {
        const response = await withTimeout(
          ai.models.embedContent({
            model,
            contents: text,
            config: { outputDimensionality: 768, taskType: 'RETRIEVAL_DOCUMENT' },
          }),
          8000,
        );
        const values = response.embeddings?.[0]?.values;
        return Array.isArray(values) && values.length === 768 ? values : null;
      } catch (error) {
        logger.warn('Embedding failed; saving bag without embedding', { error: error.message });
        return null;
      }
    },
  };
}
