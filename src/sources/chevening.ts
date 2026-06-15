/**
 * Chevening Scholarships programmes page.
 *
 * Source: https://www.chevening.org/scholarships/
 *
 * The list of partner universities is dynamic but the scholarship itself
 * has a stable page. We hardcode the canonical Chevening scholarship for
 * now; expand when Chevening publishes a machine-readable list.
 */
import { BaseSource } from './base.js';
import { get as httpGet } from '../http.js';
import type { RawListing } from '../types.js';

const CHEVENING_URL = 'https://www.chevening.org/scholarships/';

export class CheveningSource extends BaseSource {
  readonly name = 'chevening';
  readonly displayName = 'Chevening';
  readonly schedule = '0 0 * * *';
  readonly origin = 'https://www.chevening.org';

  async fetch(): Promise<RawListing[]> {
    // Verify the page still exists (don't 404 silently)
    await httpGet(CHEVENING_URL, { skipThrottle: true });

    // The scholarship is one program with one annual deadline (typically Oct/Nov).
    // We synthesize a single canonical record. When Chevening exposes a per-country
    // breakdown, replace this with a real fetch loop.
    return [
      {
        externalId: 'chevening-uk-masters',
        url: 'https://www.chevening.org/scholarships/',
        title: 'Chevening Scholarship',
        provider: 'UK Foreign, Commonwealth & Development Office',
        description:
          'Fully funded master\'s degree in any subject at any UK university. Covers tuition, living, and travel. Open to applicants from Chevening-eligible countries.',
        rawFields: ['all'],
        rawCountries: ['GB'],
        rawDegreeLevels: ['master'],
        rawFundingKind: 'full',
        rawIeltsRequired: true,
        rawFundingCovers: ['tuition', 'living', 'travel', 'insurance'],
      },
    ];
  }
}
