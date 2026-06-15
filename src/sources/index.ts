/**
 * Source registry.
 *
 * Active sources:
 *   - curated        (verified global scholarships, PhD, fellowships)
 *   - scholars4dev   (scholarships for developing countries)
 *   - opportunitydesk (global scholarships via RSS)
 *   - chevening      (synthetic — UK Government)
 *   - daad           (DAAD scholarship database)
 *   - erasmus        (Erasmus Mundus catalogue)
 *   - euraxess       (EURAXESS EU researcher jobs)
 *   - jobs-ac-uk     (UK academic jobs board)
 *   - reddit         (r/PhD, r/scholarships)
 *   - facebook       (Graph API — needs env)
 *   - findaphd       (Playwright-based)
 */
import { CuratedSource } from './curated.js';
import { Scholars4DevSource } from './scholars4dev.js';
import { OpportunityDeskSource } from './opportunitydesk.js';
import { CheveningSource } from './chevening.js';
import { DAADSource } from './daad.js';
import { ErasmusSource } from './erasmus.js';
import { EuraxessSource } from './euraxess.js';
import { JobsAcUkSource } from './jobs-ac-uk.js';
import { RedditSource } from './reddit.js';
import { FacebookSource } from './facebook.js';
import { FindaphdSource } from './findaphd.js';
import type { BaseSource } from './base.js';

export { BaseSource };

export const ALL_SOURCES: BaseSource[] = [
  new CuratedSource(),
  new Scholars4DevSource(),
  new OpportunityDeskSource(),
  new CheveningSource(),
  new DAADSource(),
  new ErasmusSource(),
  new EuraxessSource(),
  new JobsAcUkSource(),
  new RedditSource(),
  new FacebookSource(),
  new FindaphdSource(),
];
