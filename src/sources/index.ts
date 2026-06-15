/**
 * Source registry.
 *
 * Active sources:
 *   - chevening     (synthetic — UK Government)
 *   - daad          (DAAD scholarship database, 164 programmes)
 *   - erasmus       (Erasmus Mundus catalogue, 220 programmes)
 *   - euraxess      (EURAXESS EU researcher jobs)
 *   - jobs-ac-uk    (UK academic jobs board, PhD/research)
 *   - reddit        (r/PhD, r/scholarships, etc — public JSON API + RSS)
 *   - facebook      (Graph API — needs FACEBOOK_ACCESS_TOKEN + FACEBOOK_GROUPS)
 *   - findaphd      (Cloudflare-protected, needs Playwright)
 */
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
  new CheveningSource(),
  new DAADSource(),
  new ErasmusSource(),
  new EuraxessSource(),
  new JobsAcUkSource(),
  new RedditSource(),
  new FacebookSource(),
  new FindaphdSource(),
];
