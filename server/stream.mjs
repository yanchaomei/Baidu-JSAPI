import { once } from "node:events";
import { setImmediate, setTimeout } from "node:timers/promises";
import { GENERATION_LIMITS } from "../src/data/protocol.ts";
import { generateFrames } from "./generator.mjs";

export const DEFAULT_STREAM_OPTIONS = Object.freeze({
  count: 100_000,
  seed: 42,
  batch: 4096,
  delay: 8,
  lines: 89,
  areas: 40,
});

function parseOptions(searchParams) {
  const options = { ...DEFAULT_STREAM_OPTIONS };
  const seen = new Set();
  for (const [name, text] of searchParams) {
    if (!Object.hasOwn(GENERATION_LIMITS, name) || seen.has(name))
      throw new Error(`Unknown or duplicate parameter: ${name}`);
    seen.add(name);
    if (!/^\d+$/.test(text)) throw new Error(`${name} must be an integer`);
    const value = Number(text);
    const [minimum, maximum] = GENERATION_LIMITS[name];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new Error(`${name} must be between ${minimum} and ${maximum}`);
    options[name] = value;
  }
  return options;
}

/** One stream producer serves both Vite development and the production server. */
export async function streamMiddleware(req, res, next) {
  let url;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid request URL" }));
    return;
  }
  if (url.pathname !== "/api/stream") {
    if (next) next();
    else {
      res.statusCode = 404;
      res.end("Not found");
    }
    return;
  }
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method not allowed");
    return;
  }
  let options;
  try {
    options = parseOptions(url.searchParams);
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error.message }));
    return;
  }
  if (req.aborted || res.destroyed) return;
  const cancellation = new AbortController();
  const abort = () => cancellation.abort();
  res.once("close", abort);
  res.once("error", abort);
  req.once("aborted", abort);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Accel-Buffering", "no");
  try {
    for (const frame of generateFrames(options)) {
      if (cancellation.signal.aborted || res.destroyed) break;
      if (!res.write(frame))
        await once(res, "drain", { signal: cancellation.signal });
      if (cancellation.signal.aborted || res.destroyed) break;
      // Even delay=0 gives close/drain events a chance before generating a batch.
      if (options.delay === 0)
        await setImmediate(undefined, { signal: cancellation.signal });
      else
        await setTimeout(options.delay, undefined, {
          signal: cancellation.signal,
        });
    }
    if (!cancellation.signal.aborted && !res.destroyed && !res.writableEnded)
      res.end();
  } catch (error) {
    if (!cancellation.signal.aborted && !res.destroyed) res.destroy(error);
  } finally {
    req.off("aborted", abort);
    res.off("close", abort);
    res.off("error", abort);
  }
}
