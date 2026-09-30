/** Pure link-check rules: probe classification, gone redirects, failure streaks, host pacing. */
import { describe, expect, it } from 'vitest';
import { classifyProbe, failureStreak, goneRedirect, HostPacer, isConclusiveFailure, linkCheckStatus } from '../../src/lib/linkcheck';

const URL_A = 'https://boards.greenhouse.io/acme/jobs/123';

describe('goneRedirect', () => {
  it('same page (trailing slash / case) is not a redirect', () => {
    expect(goneRedirect(URL_A, `${URL_A}/`)).toBeNull();
    expect(goneRedirect(URL_A, 'https://boards.greenhouse.io/ACME/jobs/123?gh_src=x')).toBeNull();
  });

  it('home page, parent page, listing page and error=true pages mean the posting is gone', () => {
    expect(goneRedirect(URL_A, 'https://boards.greenhouse.io/')).toMatch(/^gone: redirected to the home page/);
    expect(goneRedirect(URL_A, 'https://boards.greenhouse.io/acme')).toMatch(/parent page \/acme$/);
    expect(goneRedirect('https://acme.com/careers/security-engineer', 'https://acme.com/careers')).toMatch(/^gone:/);
    expect(goneRedirect('https://jobs.lever.co/acme/abc', 'https://jobs.lever.co/acme?error=true')).toMatch(/error page/);
    expect(goneRedirect('https://a.example/p/1', 'https://b.example/jobs')).toMatch(/listing b\.example\/jobs/);
  });

  it('a redirect to another detail page is fine; malformed URLs are ignored', () => {
    expect(goneRedirect('https://acme.com/j/1', 'https://acme.wd3.myworkdayjobs.com/en-US/External/job/Berlin/Engineer_R123')).toBeNull();
    expect(goneRedirect('not a url', 'https://x.example/')).toBeNull();
  });
});

describe('classifyProbe', () => {
  it('2xx → ok; 2xx after a gone redirect → redirected (conclusive failure)', () => {
    expect(classifyProbe(URL_A, { status: 200, finalUrl: URL_A, errorCode: null })).toEqual({ linkStatus: 'ok', ok: true, conclusive: true, reason: null });
    expect(classifyProbe(URL_A, { status: 200, finalUrl: 'https://boards.greenhouse.io/acme', errorCode: null })).toMatchObject({ linkStatus: 'redirected', ok: false, conclusive: true });
  });

  it('404 / 410 are conclusive; 403, 429, 5xx and network errors are not', () => {
    expect(classifyProbe(URL_A, { status: 404, finalUrl: URL_A, errorCode: null })).toMatchObject({ linkStatus: 'dead', conclusive: true, reason: 'HTTP 404' });
    expect(classifyProbe(URL_A, { status: 410, finalUrl: URL_A, errorCode: null }).conclusive).toBe(true);
    for (const s of [403, 429, 500, 503]) expect(classifyProbe(URL_A, { status: s, finalUrl: URL_A, errorCode: null })).toMatchObject({ linkStatus: 'unknown', conclusive: false });
    expect(classifyProbe(URL_A, { status: null, finalUrl: null, errorCode: 'timeout' })).toMatchObject({ linkStatus: 'unknown', conclusive: false, reason: 'timeout' });
    expect(classifyProbe(URL_A, { status: null, finalUrl: null, errorCode: 'blocked_ip' }).conclusive).toBe(false);
  });
});

describe('failure streak (dead after 2 consecutive conclusive failures)', () => {
  const ok = { ok: true, statusCode: 200, error: null };
  const nf = { ok: false, statusCode: 404, error: 'HTTP 404' };
  const gone = { ok: false, statusCode: 200, error: 'gone: redirected to the home page (x)' };
  const flaky = { ok: false, statusCode: 503, error: 'HTTP 503' };

  it('counts conclusive failures newest-first, skips inconclusive ones, stops at an ok check', () => {
    expect(isConclusiveFailure(nf)).toBe(true);
    expect(isConclusiveFailure(gone)).toBe(true);
    expect(isConclusiveFailure(flaky)).toBe(false);
    expect(failureStreak([])).toBe(0);
    expect(failureStreak([nf, flaky, gone, ok, nf])).toBe(2);
    expect(failureStreak([flaky, flaky])).toBe(0);
    expect(failureStreak([ok, nf, nf])).toBe(0);
  });
});

describe('HostPacer', () => {
  it('spaces requests to the same host and never delays other hosts', async () => {
    let t = 1000;
    const sleeps: number[] = [];
    const pacer = new HostPacer(1000, () => t, async (ms) => {
      sleeps.push(ms);
    });
    await pacer.wait('a.example');
    await pacer.wait('a.example');
    await pacer.wait('b.example');
    await pacer.wait('a.example');
    expect(sleeps).toEqual([1000, 2000]);
    t = 10_000;
    await pacer.wait('a.example');
    expect(sleeps).toEqual([1000, 2000]);
  });
});

describe('linkCheckStatus', () => {
  it('ok / partial / failed', () => {
    expect(linkCheckStatus({ probes: 10, inconclusive: 2, writeErrors: 0 }, false)).toBe('ok');
    expect(linkCheckStatus({ probes: 10, inconclusive: 10, writeErrors: 0 }, false)).toBe('partial');
    expect(linkCheckStatus({ probes: 3, inconclusive: 3, writeErrors: 0 }, false)).toBe('ok');
    expect(linkCheckStatus({ probes: 10, inconclusive: 0, writeErrors: 1 }, false)).toBe('partial');
    expect(linkCheckStatus({ probes: 2, inconclusive: 0, writeErrors: 2 }, false)).toBe('failed');
    expect(linkCheckStatus({ probes: 0, inconclusive: 0, writeErrors: 0 }, true)).toBe('failed');
  });
});
