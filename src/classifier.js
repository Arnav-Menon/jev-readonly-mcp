import { ENDPOINT, MODEL, QUESTIONS, inputSchema, outputSchema } from './schemas.js';

export class SafeError extends Error {}

export function createClassifier({ apiKey, fetchImpl = fetch, timeoutMs = 20000, maxCalls = 60, now = Date.now }) {
  let active = 0;
  let calls = [];
  return async function classify(input) {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new SafeError('Invalid evidence packet. Check the tool input schema.');
    if (!apiKey) throw new SafeError('Classification is unavailable: server secret is not configured.');
    if (JSON.stringify(parsed.data).includes(apiKey)) throw new SafeError('Invalid evidence packet.');
    const currentTime = now();
    calls = calls.filter(timestamp => timestamp > currentTime - 3600000);
    if (calls.length >= maxCalls) throw new SafeError('Hourly classification limit reached. Try again later.');
    if (active >= 2) throw new SafeError('Classifier is busy. Try again shortly.');
    calls.push(currentTime);
    active += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model: MODEL, state: parsed.data, questions: QUESTIONS }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429 || response.status === 529) {
          throw new SafeError('TypeSafe is rate limited or busy. Try again later.');
        }
        throw new SafeError('TypeSafe could not complete the classification.');
      }
      let length = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 65536) throw new SafeError('TypeSafe returned an invalid response.');
        chunks.push(chunk);
      }
      const result = outputSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!result.success) throw new SafeError('TypeSafe returned an invalid response.');
      const primary = result.data.answers.primary_catalyst;
      const values = Object.values(primary.probabilities);
      if (Math.abs(values.reduce((total, value) => total + value, 0) - 1) > 0.02 ||
          primary.probabilities[primary.choice] < Math.max(...values)) {
        throw new SafeError('TypeSafe returned an invalid response.');
      }
      if (JSON.stringify(result.data).includes(apiKey)) throw new SafeError('TypeSafe returned an invalid response.');
      return result.data;
    } catch (error) {
      if (error instanceof SafeError) throw error;
      throw new SafeError(controller.signal.aborted ? 'TypeSafe request timed out.' : 'TypeSafe returned no usable classification.');
    } finally {
      clearTimeout(timer);
      active -= 1;
    }
  };
}
