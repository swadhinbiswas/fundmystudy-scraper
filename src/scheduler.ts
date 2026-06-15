/**
 * Cron scheduler. One entry per source.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { ALL_SOURCES } from './sources/index.js';
import type { BaseSource } from './sources/base.js';
import { getConfig } from './config.js';
import { runSource } from './runner.js';
import { logger } from './logger.js';

interface ScheduleHandle {
  source: BaseSource;
  task: ScheduledTask;
}

const handles: ScheduleHandle[] = [];

export function startScheduler(enabledNames: string[]): ScheduleHandle[] {
  const enabled = new Set(enabledNames);
  for (const source of ALL_SOURCES) {
    if (!enabled.has(source.name)) {
      logger.info({ source: source.name }, 'source disabled (not in SOURCES env)');
      continue;
    }
    if (!cron.validate(source.schedule)) {
      logger.error(
        { source: source.name, schedule: source.schedule },
        'invalid cron expression, skipping',
      );
      continue;
    }
    const task = cron.schedule(
      source.schedule,
      () => {
        runSource(source).catch((e) =>
          logger.error({ err: e.message }, 'uncaught runSource error'),
        );
      },
      { timezone: 'Etc/UTC' },
    );
    handles.push({ source, task });
    logger.info({ source: source.name, schedule: source.schedule }, 'scheduled');
  }
  return handles;
}

export function stopAll() {
  for (const h of handles) h.task.stop();
  handles.length = 0;
  logger.info('all schedulers stopped');
}

export function listSchedules() {
  return handles.map((h) => ({ name: h.source.name, schedule: h.source.schedule }));
}
