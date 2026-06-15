#!/usr/bin/env tsx
/**
 * CLI: fetch + normalize a single source, print the first 3 results as JSON.
 *   tsx scripts/test-source.ts daad
 */
import { ALL_SOURCES } from '../src/sources/index.js';
import { normalize } from '../src/normalizer.js';
import { logger } from '../src/logger.js';

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: tsx scripts/test-source.ts <source-name>');
    console.error('Available:', ALL_SOURCES.map((m) => m.name).join(', '));
    process.exit(1);
  }
  const meta = ALL_SOURCES.find((m) => m.name === target);
  if (!meta) {
    console.error(`Unknown source: ${target}`);
    process.exit(1);
  }

  const source = meta;
  logger.info({ source: source.name, origin: source.origin }, 'fetching');
  const raw = await source.fetch();
  logger.info({ fetched: raw.length }, 'fetched');

  const now = Date.now();
  const normalized = raw.slice(0, 3).map((r) => {
    const err = source.validate(r);
    if (err) return { _invalid: err, raw: r };
    return normalize(r, { source: source.name, now });
  });

  console.log(JSON.stringify(normalized, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
