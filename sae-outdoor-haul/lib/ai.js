'use strict';
/**
 * Optional AI review + summary (Claude). Turned on when ANTHROPIC_API_KEY is set.
 *
 * The AI never sets prices. The code computes every number from the rates table first.
 * The AI only (1) flags answers that are too unclear to price and (2) writes a short,
 * plain-English summary. Any dollar amount in its summary that is not in the computed
 * estimate causes the summary to be thrown away and replaced by a template.
 * If the AI is off, slow, or fails, the site still works with the template summary.
 */
const { allowedAmounts } = require('./pricing');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

const SYSTEM = `You review online quote requests for a small local service business (junk removal, lawn mowing, Christmas tree delivery/installation) in Dallas-Fort Worth.
You receive the customer's answers and an estimate that was already calculated by code from the owner's rates table.

Rules:
- Never create, change, or guess any price. Only mention dollar amounts that appear in the estimate JSON, exactly as given, or mention none.
- "questions": list a question ONLY when an answer is missing or so unclear that the crew could not tell what the job is (for example, the "what needs to go" text is gibberish or contradicts the chosen load). Do not ask about things the form already captured. Most requests need no questions; return an empty list then.
- "summary": 2 to 3 short, friendly sentences for the customer that describe the job they asked for and state the total range. Do not promise availability or a final price. Plain text, no markdown.`;

const SCHEMA = {
  type: 'object',
  properties: {
    questions: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['questions', 'summary'],
  additionalProperties: false,
};

function amountsIn(text) {
  return [...String(text).matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

function createAi({ apiKey, client } = {}) {
  if (!client && !apiKey) return null;
  let anthropic = client;
  if (!anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    const Ctor = Anthropic.default || Anthropic;
    anthropic = new Ctor({ apiKey, timeout: 25000, maxRetries: 1 });
  }

  return {
    async review({ data, estimate }) {
      const payload = { service: data.service, answers: { ...data, contact: undefined }, estimate };
      const response = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      });
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      let parsed;
      try { parsed = JSON.parse(text); } catch { return null; }
      if (!parsed || !Array.isArray(parsed.questions) || typeof parsed.summary !== 'string') return null;

      const allowed = allowedAmounts(estimate);
      const summaryOk = amountsIn(parsed.summary).every((n) => allowed.has(n));
      return {
        questions: parsed.questions.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3).map((q) => q.slice(0, 300)),
        summary: summaryOk ? parsed.summary.slice(0, 800) : null,
      };
    },
  };
}

module.exports = { createAi, amountsIn };
