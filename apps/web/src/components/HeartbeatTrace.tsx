import type { AgentSummary } from '@testkit/shared';

const SAMPLE_COUNT = 44;
const WIDTH = 176;
const HEIGHT = 34;

interface Props {
  /** Newest sample last. true = at least one agent was connected at that poll. */
  samples: boolean[];
  agents: AgentSummary[];
}

/**
 * A trace of the last ~90 seconds of polling. A notch means an agent was
 * connected when we asked; a flat line means nobody was. It replaces the usual
 * green pill because the interesting fact is not "connected right now" but
 * "has the connection been steady", which is exactly what an analyst needs to
 * know before starting a recording.
 */
export function HeartbeatTrace({ samples, agents }: Props) {
  const connected = agents.filter((agent) => agent.state === 'connected');
  const state = connected.length > 0 ? 'connected' : agents.length > 0 ? 'disconnected' : 'never-connected';

  const padded = [...Array<boolean>(Math.max(0, SAMPLE_COUNT - samples.length)).fill(false), ...samples].slice(
    -SAMPLE_COUNT,
  );

  const step = WIDTH / (SAMPLE_COUNT - 1);
  const baseline = HEIGHT - 6;
  const peak = 7;

  const points = padded
    .map((alive, index) => {
      const x = index * step;
      return `${x.toFixed(1)},${(alive ? peak : baseline).toFixed(1)}`;
    })
    .join(' ');

  const label =
    connected.length > 0
      ? connected.map((agent) => agent.name).join(', ')
      : agents.length > 0
        ? 'bağlı makine yok'
        : 'kayıtlı makine yok';

  return (
    <div className="trace">
      <svg width={WIDTH} height={HEIGHT} role="img" aria-label={`Makine bağlantı izi: ${label}`}>
        <line x1="0" y1={baseline} x2={WIDTH} y2={baseline} stroke="var(--hairline)" strokeWidth="1" />
        <polyline
          points={points}
          fill="none"
          stroke={connected.length > 0 ? 'var(--live)' : 'var(--alert)'}
          strokeWidth="1.5"
          strokeLinejoin="miter"
        />
      </svg>
      <div className="trace-label">
        makine
        <strong data-state={state}>{label}</strong>
      </div>
    </div>
  );
}
