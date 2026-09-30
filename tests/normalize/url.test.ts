import { describe, expect, it } from 'vitest';
import { URL_LOGIC_VERSION, cleanUrl, isTrackingParam, sameLink, urlHost } from '@/lib/normalize/url';

describe('cleanUrl', () => {
  const CASES: [string, string][] = [
    // tracking parameters
    ['https://boards.greenhouse.io/acme/jobs/123?utm_source=linkedin&utm_medium=social', 'https://boards.greenhouse.io/acme/jobs/123'],
    ['https://boards.greenhouse.io/acme/jobs/123?gh_src=abc123&gh_jid=123', 'https://boards.greenhouse.io/acme/jobs/123?gh_jid=123'],
    ['https://acme.com/careers?gh_jid=4567&gh_src=x', 'https://acme.com/careers?gh_jid=4567'],
    ['https://jobs.lever.co/acme/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab?lever-source=LinkedIn&lever-origin=applied', 'https://jobs.lever.co/acme/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab'],
    ['https://jobs.lever.co/acme/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab/apply?lever-source[]=x', 'https://jobs.lever.co/acme/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab'],
    ['https://jobs.ashbyhq.com/acme/9a8b7c6d-0000-1111-2222-333344445555/application?utm_source=x', 'https://jobs.ashbyhq.com/acme/9a8b7c6d-0000-1111-2222-333344445555'],
    ['https://jobs.ashbyhq.com/acme?ashby_jid=9a8b&utm_campaign=q3', 'https://jobs.ashbyhq.com/acme?ashby_jid=9a8b'],
    ['https://apply.workable.com/acme/j/ABC123DEF/apply/', 'https://apply.workable.com/acme/j/ABC123DEF'],
    ['https://job-boards.greenhouse.io/acme/jobs/123', 'https://boards.greenhouse.io/acme/jobs/123'],
    ['https://example.com/job/1?gclid=abc&fbclid=def&msclkid=ghi&dclid=j&yclid=k', 'https://example.com/job/1'],
    ['https://example.com/job/1?mc_cid=1&mc_eid=2&mc_tc=3', 'https://example.com/job/1'],
    ['https://example.com/job/1?_hsenc=a&_hsmi=b&__hstc=c&hsa_acc=1', 'https://example.com/job/1'],
    ['https://example.com/job/1?pk_campaign=a&mtm_source=b&matomo_kwd=c', 'https://example.com/job/1'],
    ['https://example.com/job/1?ref=hn&source=twitter&src=feed&referrer=x', 'https://example.com/job/1'],
    ['https://example.com/job/1?trk=public_jobs&trackingId=abc', 'https://example.com/job/1'],
    ['https://example.com/job/1?_ga=2.1.2&_gl=1*abc', 'https://example.com/job/1'],
    ['https://example.com/job/1?igshid=abc&li_fat_id=x&ttclid=y&twclid=z', 'https://example.com/job/1'],
    ['https://example.com/job/1?UTM_SOURCE=A&Utm_Medium=B', 'https://example.com/job/1'],
    ['https://example.com/job/1?lang=de', 'https://example.com/job/1'],
    ['https://example.com/job/1?jsessionid=abc', 'https://example.com/job/1'],
    // kept parameters, sorted
    ['https://example.com/jobs?page=2&id=55', 'https://example.com/jobs?id=55&page=2'],
    ['https://example.com/jobs?b=2&a=1&utm_source=x', 'https://example.com/jobs?a=1&b=2'],
    ['https://example.com/jobs?a=2&a=1', 'https://example.com/jobs?a=1&a=2'],
    ['https://example.com/jobs?a=1&a=1', 'https://example.com/jobs?a=1'],
    ['https://example.com/jobs?position=backend', 'https://example.com/jobs?position=backend'],
    ['https://acme.wd3.myworkdayjobs.com/en-US/External/job/Berlin/Engineer_R123?source=LinkedIn', 'https://acme.wd3.myworkdayjobs.com/en-US/External/job/Berlin/Engineer_R123'],
    ['https://jobs.smartrecruiters.com/Acme/743999-backend-engineer?trid=abc', 'https://jobs.smartrecruiters.com/Acme/743999-backend-engineer?trid=abc'],
    // host, port, credentials, fragment, slashes
    ['HTTPS://Jobs.Example.COM/Job/ABC', 'https://jobs.example.com/Job/ABC'],
    ['https://jobs.example.com./job/1', 'https://jobs.example.com/job/1'],
    ['https://jobs.example.com:443/job/1', 'https://jobs.example.com/job/1'],
    ['http://jobs.example.com:80/job/1', 'http://jobs.example.com/job/1'],
    ['https://jobs.example.com:8443/job/1', 'https://jobs.example.com:8443/job/1'],
    ['https://user:secret@jobs.example.com/job/1', 'https://jobs.example.com/job/1'],
    ['https://example.com/job/1#apply', 'https://example.com/job/1'],
    ['https://example.com/job/1/#section-2', 'https://example.com/job/1'],
    ['https://example.com/careers/#/jobs/123', 'https://example.com/careers#/jobs/123'],
    ['https://example.com/careers#!/job/77/', 'https://example.com/careers#!/job/77'],
    ['https://example.com/job/1/', 'https://example.com/job/1'],
    ['https://example.com/job/1///', 'https://example.com/job/1'],
    ['https://example.com//jobs//1', 'https://example.com/jobs/1'],
    ['https://example.com', 'https://example.com/'],
    ['https://example.com/', 'https://example.com/'],
    ['https://example.com/?utm_source=x', 'https://example.com/'],
    ['  https://example.com/job/1  ', 'https://example.com/job/1'],
    // job boards
    ['https://www.linkedin.com/jobs/view/3912345678/?refId=abc&trackingId=def&trk=xyz&eBP=1', 'https://www.linkedin.com/jobs/view/3912345678'],
    ['https://linkedin.com/jobs/view/3912345678', 'https://www.linkedin.com/jobs/view/3912345678'],
    ['https://de.linkedin.com/jobs/view/3912345678?position=1&pageNum=0', 'https://de.linkedin.com/jobs/view/3912345678'],
    ['https://de.indeed.com/viewjob?jk=abc123def&from=serp&vjs=3&tk=1h2', 'https://de.indeed.com/viewjob?jk=abc123def'],
    ['https://www.indeed.co.uk/viewjob?jk=abc&advn=1', 'https://www.indeed.co.uk/viewjob?jk=abc'],
    // scheme-less and odd input
    ['//jobs.example.com/job/1', 'https://jobs.example.com/job/1'],
    ['jobs.example.com/job/1?utm_source=x', 'https://jobs.example.com/job/1'],
    ['www.example.com', 'https://www.example.com/'],
    ['https://bücher.example/job/1', 'https://xn--bcher-kva.example/job/1'],
    ['https://example.com/jobs/ingénieur', 'https://example.com/jobs/ing%C3%A9nieur'],
    ['not a url', 'not a url'],
    ['mailto:jobs@example.com', 'mailto:jobs@example.com'],
    ['javascript:alert(1)', 'javascript:alert(1)'],
    ['ftp://example.com/file', 'ftp://example.com/file'],
    ['', ''],
    ['   ', ''],
  ];

  it.each(CASES)('%s', (input, expected) => {
    expect(cleanUrl(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const [input] of CASES) expect(cleanUrl(cleanUrl(input))).toBe(cleanUrl(input));
  });

  it('tolerates non-string input', () => {
    expect(cleanUrl(undefined as unknown as string)).toBe('');
    expect(cleanUrl(42 as unknown as string)).toBe('');
  });

  it('has a versioned logic id', () => {
    expect(URL_LOGIC_VERSION).toMatch(/^url@\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe('sameLink / urlHost / isTrackingParam', () => {
  it('sameLink', () => {
    expect(sameLink('https://jobs.lever.co/acme/1?lever-source=x', 'https://jobs.lever.co/acme/1/apply')).toBe(true);
    expect(sameLink('https://example.com/a', 'https://example.com/b')).toBe(false);
    expect(sameLink('', '')).toBe(false);
  });

  it.each([
    ['https://www.Example.com/x', 'example.com'],
    ['jobs.example.com/x', 'jobs.example.com'],
    ['https://careers.acme.de./', 'careers.acme.de'],
    ['nonsense', null],
    ['mailto:x@y.z', null],
    ['', null],
  ] as [string, string | null][])('urlHost(%s) = %s', (u, h) => {
    expect(urlHost(u)).toBe(h);
  });

  it.each([
    ['utm_source', true], ['UTM_TERM', true], ['gclid', true], ['gh_src', true], ['lever-origin', true], ['mc_eid', true],
    ['gh_jid', false], ['ashby_jid', false], ['jk', false], ['id', false], ['page', false], ['q', false], ['position', false],
  ] as [string, boolean][])('isTrackingParam(%s) = %s', (k, v) => {
    expect(isTrackingParam(k)).toBe(v);
  });
});
