/**
 * Generates an ADMIN_PASSWORD_HASH value.
 *
 *   npx tsx scripts/hash-password.ts            # prompts (input hidden), asks twice
 *   printf '%s' "$PW" | npx tsx scripts/hash-password.ts --stdin
 *
 * Prints ONLY the hash (scrypt:N:r:p:<salt>:<key>) to stdout. The password is never echoed,
 * logged or written anywhere. Never pass the password as a command-line argument.
 */
import { stdin, stdout, stderr } from 'node:process';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';

const MIN_LENGTH = 12;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  // Strip exactly one trailing newline (from `echo`), keep everything else verbatim.
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error('stdin is not a TTY; use --stdin'));
      return;
    }
    stderr.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (key: string) => {
      for (const ch of key) {
        if (ch === '\u0003') {
          // Ctrl-C
          stdin.setRawMode(false);
          stderr.write('\n');
          process.exit(130);
        } else if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stderr.write('\n');
          resolve(value);
          return;
        } else if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const fromStdin = process.argv.includes('--stdin');
  if (process.argv.slice(2).some((a) => a !== '--stdin')) {
    stderr.write('Usage: tsx scripts/hash-password.ts [--stdin]  (never pass the password as an argument)\n');
    process.exit(2);
  }
  let password: string;
  if (fromStdin) {
    password = await readStdin();
  } else {
    password = await promptHidden('New admin password: ');
    const again = await promptHidden('Repeat password: ');
    if (again !== password) {
      stderr.write('Passwords do not match.\n');
      process.exit(1);
    }
  }
  if (password.length < MIN_LENGTH) {
    stderr.write(`Password must be at least ${MIN_LENGTH} characters.\n`);
    process.exit(1);
  }
  const hash = await hashPassword(password);
  if (!(await verifyPassword(password, hash))) {
    stderr.write('Self-check failed.\n');
    process.exit(1);
  }
  stdout.write(`${hash}\n`);
}

main().catch((err: unknown) => {
  stderr.write(`hash-password failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
