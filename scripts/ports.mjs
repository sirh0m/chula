#!/usr/bin/env node
// Dev port helper.
//   node scripts/ports.mjs check   exit 1 with a clear message if a dev port is taken
//   node scripts/ports.mjs stop    stop whatever is listening on the dev ports
import { execSync } from 'node:child_process';
import net from 'node:net';

const PORTS = [
  { port: Number(process.env.PORT || 4310), name: 'API' },
  { port: Number(process.env.FRONTEND_PORT || 5317), name: 'web app' },
];

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

async function respondsAsChula(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return body?.service === 'chula-api';
  } catch {
    return false;
  }
}

function pidsOn(port) {
  const attempts =
    process.platform === 'win32'
      ? [`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`]
      : [`lsof -ti tcp:${port} -sTCP:LISTEN`, `fuser -n tcp ${port} 2>/dev/null`];
  for (const command of attempts) {
    try {
      const out = execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const pids =
        process.platform === 'win32'
          ? out.split('\n').map((line) => line.trim().split(/\s+/).pop())
          : out.split(/\s+/);
      const unique = [...new Set(pids.filter((pid) => /^\d+$/.test(pid) && Number(pid) !== process.pid))];
      if (unique.length) return unique.map(Number);
    } catch {
      // Tool missing or nothing listening; try the next one.
    }
  }
  return [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check() {
  const busy = [];
  for (const entry of PORTS) {
    if (!(await isFree(entry.port))) busy.push(entry);
  }
  if (!busy.length) return;

  const healthy = await respondsAsChula(PORTS[1].port);
  console.error('');
  for (const { port, name } of busy) console.error(`  Port ${port} (${name}) is already in use.`);
  console.error('');
  if (healthy) {
    console.error('  Chula is already running: open http://localhost:5317');
    console.error('  To restart it instead, run:  npm run stop && npm run dev');
  } else {
    console.error('  Another process (possibly a stuck earlier dev server) is holding the port.');
    console.error('  Free it with:  npm run stop   then run  npm run dev  again.');
  }
  console.error('');
  process.exit(1);
}

async function stop() {
  let stopped = 0;
  for (const { port, name } of PORTS) {
    const pids = pidsOn(port);
    if (!pids.length) {
      console.log(`Port ${port} (${name}): free`);
      continue;
    }
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
        stopped += 1;
        console.log(`Port ${port} (${name}): stopped process ${pid}`);
      } catch (error) {
        console.error(`Port ${port} (${name}): could not stop process ${pid} (${error.code})`);
      }
    }
  }
  if (!stopped) return;
  await sleep(1500);
  for (const { port, name } of PORTS) {
    for (const pid of pidsOn(port)) {
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`Port ${port} (${name}): force-stopped process ${pid}`);
      } catch {
        // Already gone.
      }
    }
  }
}

const mode = process.argv[2];
if (mode === 'check') await check();
else if (mode === 'stop') await stop();
else {
  console.error('Usage: node scripts/ports.mjs <check|stop>');
  process.exit(2);
}
