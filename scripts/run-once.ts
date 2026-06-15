#!/usr/bin/env tsx
/**
 * CLI: run a single source once.
 *   tsx scripts/run-once.ts            # all enabled
 *   tsx scripts/run-once.ts daad       # one source
 *   tsx scripts/run-once.ts daad --no-submit
 */
import { ALL_SOURCES } from '../src/sources/index.js';
import { runSource } from '../src/runner.js';
import { report } from '../src/metrics.js';
import { getConfig } from '../src/config.js';
import { logger } from '../src/logger.js';

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  const noSubmit = args.includes('--no-submit');
  if (noSubmit) process.env.DRY_RUN = 'true';

  const cfg = getConfig();
  const enabled = target
    ? ALL_SOURCES.filter((m) => m.name === target)
    : ALL_SOURCES.filter((m) => cfg.SOURCES.includes(m.name));

  if (enabled.length === 0) {
    logger.error({ target, available: ALL_SOURCES.map((m) => m.name) }, 'no matching source');
    process.exit(1);
  }

  const results = await Promise.allSettled(enabled.map((m) => runSource(m)));

  for (const r of results) {
    if (r.status === 'rejected') {
      logger.error({ err: r.reason }, 'source run rejected');
    }
  }

  report();
  const snap = report();
  const totalErrors = snap.reduce((a, b) => a + b.errors, 0);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
