import { Router } from 'express';
import { eventBus } from '../lib/eventBus.js';

export const eventsRouter = Router();

/**
 * Server-sent events. One long-lived GET per channel; the browser reconnects on
 * its own, which is why this is SSE and not a second WebSocket.
 */
eventsRouter.get('/events', (req, res) => {
  const channel = typeof req.query.channel === 'string' ? req.query.channel : '';
  if (!/^(recording|run):[A-Za-z0-9_-]+$/.test(channel)) {
    res.status(400).json({ error: { code: 'invalidChannel', message: 'Yalnızca kayıt veya koşu kanalı dinlenebilir.' } });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Without this, a proxy can hold the stream in a buffer and nothing appears
    // until the recording ends.
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: open\ndata: ${JSON.stringify({ channel })}\n\n`);

  const unsubscribe = eventBus.subscribe(channel, (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  });

  // Comment frames keep idle connections alive through proxies with timeouts.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end();
  });
});
