/**
 * Entrypoint.
 *
 *   • Loads config
 *   • Verifies the API is reachable
 *   • Runs all enabled sources once (if RUN_ON_START)
 *   • Starts the cron scheduler
 *   • On SIGINT/SIGTERM, stops the scheduler and exits cleanly
 */
import { getConfig } from './config.js';
import { logger } from './logger.js';
import { startScheduler, stopAll, listSchedules } from './scheduler.js';
import { runSource } from './runner.js';
import { ALL_SOURCES } from './sources/index.js';
import { api } from './api.js';
import { report as reportMetrics } from './metrics.js';

const cfg = getConfig();

async function main() {
  logger.info(
    {
      nodeEnv: cfg.NODE_ENV,
      dryRun: cfg.DRY_RUN,
      sources: cfg.SOURCES,
      parallelism: cfg.SOURCES_PARALLELISM,
    },
    'fundmystudy-bot starting',
  );

  // Verify DB connection
  try {
    const { db } = await import('./db.js');
    const ok = await db.ping();
    if (!ok) throw new Error('ping returned false');
    logger.info('turso reachable');
  } catch (e) {
    logger.error(
      { err: (e as Error).message, tursoUrl: cfg.TURSO_URL?.slice(0, 40) },
      'turso unreachable — check TURSO_AUTH_TOKEN and TURSO_URL',
    );
    if (cfg.NODE_ENV === 'production') process.exit(1);
    logger.warn('continuing in dev despite DB error');
  }

  // Initial run
  if (cfg.RUN_ON_START) {
    logger.info('running sources once on start');
    const enabled = ALL_SOURCES.filter((m) => cfg.SOURCES.includes(m.name));
    for (let i = 0; i < enabled.length; i += cfg.SOURCES_PARALLELISM) {
      const batch = enabled.slice(i, i + cfg.SOURCES_PARALLELISM);
      await Promise.allSettled(batch.map((m) => runSource(m)));
    }
    reportMetrics();
  }

  // Schedule
  if (cfg.NODE_ENV !== 'test') {
    startScheduler(cfg.SOURCES);
    logger.info({ schedules: listSchedules() }, 'scheduler running');
  }

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopAll();
    reportMetrics();
    setTimeout(() => process.exit(0), 250).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  logger.error({ err: e.message, stack: e.stack }, 'fatal');
  process.exit(1);
});
