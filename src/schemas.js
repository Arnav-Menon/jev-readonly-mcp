import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const QUESTIONS = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'));
export const MODEL = 'jev-1.13.0';
export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const categories = Object.keys(QUESTIONS.primary_catalyst.criteria);
const probability = z.number().finite().min(0).max(1);
const evidence = z.object({
  source: z.string().trim().min(1).max(200),
  published: z.string().trim().min(1).max(100),
  headline: z.string().trim().min(1).max(1000),
  snippet: z.string().trim().min(1).max(6000),
  url: z.url().max(2048).optional(),
}).strict();

export const inputSchema = z.object({
  ticker: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9.\-^]{0,19}$/),
  company: z.string().trim().min(1).max(300),
  market_context: z.string().max(6000),
  sector_context: z.string().max(6000),
  evidence: z.array(evidence).max(10),
}).strict();

const choice = z.object({
  type: z.literal('choice'),
  choice: z.enum(categories),
  confidence: probability,
  probabilities: z.object(Object.fromEntries(categories.map(category => [category, probability]))).strict(),
});
const noul = z.object({ type: z.literal('noul'), noul: probability });
export const outputSchema = z.object({
  model: z.literal(MODEL),
  answers: z.object(Object.fromEntries(Object.entries(QUESTIONS).map(([name, question]) => [
    name, question.type === 'choice' ? choice : noul,
  ]))),
});
