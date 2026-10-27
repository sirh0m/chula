const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (lvl, message, meta) => {
    if (LEVELS[lvl] < threshold) return;
    const line = { time: new Date().toISOString(), level: lvl, msg: message };
    if (meta instanceof Error) {
      line.error = { message: meta.message, stack: meta.stack };
    } else if (meta && typeof meta === 'object') {
      Object.assign(line, meta);
    }
    const out = lvl === 'error' || lvl === 'warn' ? console.error : console.log;
    out(JSON.stringify(line));
  };

  return {
    debug: (msg, meta) => write('debug', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
  };
}
