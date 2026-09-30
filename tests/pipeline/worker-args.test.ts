/** `npm run pipeline -- <command> [flags]` argument parsing. */
import { describe, expect, it } from 'vitest';
import { CLI_COMMANDS, CliArgError, parseCliArgs } from '../../src/worker/args';

describe('parseCliArgs', () => {
  it('accepts every command', () => {
    for (const c of CLI_COMMANDS) expect(parseCliArgs(['--', c]).command).toBe(c);
  });

  it('parses repeated and comma-separated sources (deduplicated)', () => {
    expect(parseCliArgs(['run', '--source=3', '--source', '5,3', '--sources=7']).sourceIds).toEqual([3, 5, 7]);
    expect(parseCliArgs(['run']).sourceIds).toBeUndefined();
  });

  it('parses numeric and date flags', () => {
    expect(parseCliArgs(['ai', '--max-calls=10'])).toMatchObject({ command: 'ai', maxCalls: 10 });
    expect(parseCliArgs(['linkcheck', '--batch', '150']).batch).toBe(150);
    expect(parseCliArgs(['reprocess', '--since=2026-09-01']).since?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(parseCliArgs(['digest', '--force'])).toMatchObject({ force: true, daily: false });
    expect(parseCliArgs(['run', '--daily']).daily).toBe(true);
  });

  it.each([
    [[]],
    [['--help']],
    [['explode']],
    [['run', 'extra']],
    [['run', '--source=abc']],
    [['run', '--source=0']],
    [['ai', '--max-calls=5000']],
    [['ai', '--max-calls']],
    [['reprocess', '--since=yesterday']],
    [['run', '--nope']],
  ])('rejects %j', (argv) => {
    expect(() => parseCliArgs(argv)).toThrow(CliArgError);
  });
});
