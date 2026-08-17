/** Tiny structured logger. Enough for two analysts and one server process. */
type Level = 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, message: string, extra?: Record<string, unknown>): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const payload = extra && Object.keys(extra).length > 0 ? `${line} ${JSON.stringify(extra)}` : line;
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

export function createLogger(scope: string) {
  return {
    info: (message: string, extra?: Record<string, unknown>) => emit('info', scope, message, extra),
    warn: (message: string, extra?: Record<string, unknown>) => emit('warn', scope, message, extra),
    error: (message: string, extra?: Record<string, unknown>) => emit('error', scope, message, extra),
  };
}
