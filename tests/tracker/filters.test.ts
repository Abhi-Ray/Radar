/** /applications URL filters, board lanes and the mobile lane choice. */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_TRACKER_FILTERS,
  activeTrackerFilterCount,
  boardLanes,
  daysBetween,
  isTerminalLane,
  parseTrackerFilters,
  pickLane,
  trackerHref,
} from '../../src/components/tracker/filters';
import { BOARD_STAGES } from '../../src/lib/tracker/stages';

describe('tracker filters', () => {
  it('parses and normalises the URL', () => {
    const f = parseTrackerFilters({ q: '  initech ', country: ['de', 'none', 'xx1', 'DE'], source: 'LinkedIn', due: '1', open: 'yes', lane: 'technical' });
    expect(f).toEqual({ q: 'initech', country: ['DE', 'none'], source: ['linkedin'], due: true, open: false, lane: 'technical' });
    expect(parseTrackerFilters({ lane: 'bogus' }).lane).toBeNull();
    expect(activeTrackerFilterCount(f)).toBe(5);
    expect(activeTrackerFilterCount(EMPTY_TRACKER_FILTERS)).toBe(0);
  });

  it('builds hrefs that keep other filters', () => {
    const f = parseTrackerFilters({ country: 'DE', due: '1' });
    const href = trackerHref(f, { lane: 'offer' });
    expect(href.startsWith('/applications?')).toBe(true);
    const sp = new URLSearchParams(href.split('?')[1]);
    expect(sp.get('country')).toBe('DE');
    expect(sp.get('due')).toBe('1');
    expect(sp.get('lane')).toBe('offer');
    expect(trackerHref(EMPTY_TRACKER_FILTERS)).toBe('/applications');
  });

  it('lanes and mobile tab', () => {
    expect(boardLanes({ open: false })).toEqual([...BOARD_STAGES]);
    const open = boardLanes({ open: true });
    expect(open).not.toContain('accepted');
    expect(open.some(isTerminalLane)).toBe(false);
    expect(pickLane('rejected', BOARD_STAGES, {})).toBe('rejected');
    expect(pickLane('rejected', open, { technical: 2, rejected: 4 })).toBe('technical');
    expect(pickLane(null, BOARD_STAGES, { saved: 3 })).toBe('saved');
    expect(pickLane(null, BOARD_STAGES, {})).toBe('applied');
    expect(daysBetween(new Date('2026-09-01T10:00:00Z'), new Date('2026-09-30T09:00:00Z'))).toBe(28);
  });
});
