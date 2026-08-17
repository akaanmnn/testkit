import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentSummary, HealthResponse } from '@testkit/shared';
import { api } from './api/client.js';
import { HeartbeatTrace } from './components/HeartbeatTrace.js';
import { AgentsPanel } from './components/AgentsPanel.js';
import { ScenarioList } from './pages/ScenarioList.js';
import { ScenarioDetail } from './pages/ScenarioDetail.js';
import { RecordPage } from './pages/RecordPage.js';
import { RunDetail } from './pages/RunDetail.js';
import { RunHistory } from './pages/RunHistory.js';
import { useHashRoute } from './hooks/useHashRoute.js';

const POLL_INTERVAL_MS = 2_000;
const MAX_SAMPLES = 44;

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [samples, setSamples] = useState<boolean[]>([]);
  const [reachable, setReachable] = useState(true);
  const timer = useRef<number | null>(null);
  const [route, navigate] = useHashRoute();

  const poll = useCallback(async () => {
    try {
      const [healthResult, agentResult] = await Promise.all([api.health(), api.listAgents()]);
      setHealth(healthResult);
      setAgents(agentResult.agents);
      setReachable(true);
      const anyConnected = agentResult.agents.some((agent) => agent.state === 'connected');
      setSamples((previous) => [...previous, anyConnected].slice(-MAX_SAMPLES));
    } catch {
      setReachable(false);
      setSamples((previous) => [...previous, false].slice(-MAX_SAMPLES));
    }
  }, []);

  useEffect(() => {
    void poll();
    timer.current = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [poll]);

  // Served by the server itself in production; only the Vite dev port differs.
  const serverUrl =
    window.location.port === '5173'
      ? `${window.location.protocol}//${window.location.hostname}:3001`
      : window.location.origin;

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1 className="wordmark">
            TestKit <span>/ phase 4</span>
          </h1>
          <p className="tagline">Kendi bilgisayarınızda kaydedin, tek yerden koşturun.</p>
        </div>
        <HeartbeatTrace samples={samples} agents={agents} />
      </header>

      <nav className="tabs">
        <button
          className={route.name === 'scenarios' || route.name === 'scenario' ? 'active' : ''}
          onClick={() => navigate('/scenarios')}
        >
          Senaryolar
        </button>
        <button className={route.name === 'record' ? 'active' : ''} onClick={() => navigate('/record')}>
          Kayıt
        </button>
        <button
          className={route.name === 'runs' || route.name === 'run' ? 'active' : ''}
          onClick={() => navigate('/runs')}
        >
          Koşular
        </button>
        <button
          className={route.name === 'machines' ? 'active' : ''}
          onClick={() => navigate('/machines')}
        >
          Makineler ve sunucu
        </button>
      </nav>

      {route.name === 'scenario' ? (
        <ScenarioDetail
          scenarioId={route.id}
          onBack={() => navigate('/scenarios')}
          onOpenRun={(runId) => navigate(`/runs/${runId}`)}
        />
      ) : route.name === 'run' ? (
        <RunDetail runId={route.id} onBack={() => navigate('/runs')} />
      ) : route.name === 'runs' ? (
        <RunHistory onOpenRun={(runId) => navigate(`/runs/${runId}`)} />
      ) : route.name === 'record' ? (
        <RecordPage agents={agents} onCommitted={(id) => navigate(`/scenarios/${id}`)} />
      ) : route.name === 'machines' ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Sunucu</h2>
              <span className="readout">{reachable ? `v${health?.serverVersion ?? '—'}` : 'ulaşılamıyor'}</span>
            </div>
            <div className="panel-body">
              {reachable ? (
                <dl className="readout-grid">
                  <div className="readout-cell">
                    <dt>api</dt>
                    <dd data-tone="ok">çalışıyor</dd>
                  </div>
                  <div className="readout-cell">
                    <dt>veritabanı</dt>
                    <dd data-tone={health?.database === 'ok' ? 'ok' : 'bad'}>{health?.database ?? '—'}</dd>
                  </div>
                  <div className="readout-cell">
                    <dt>dosya klasörü</dt>
                    <dd data-tone={health?.storageRoot === 'ok' ? 'ok' : 'bad'}>{health?.storageRoot ?? '—'}</dd>
                  </div>
                  <div className="readout-cell">
                    <dt>sunucu saati</dt>
                    <dd>{health ? new Date(health.now).toLocaleTimeString('tr-TR') : '—'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="empty">
                  Sunucudan yanıt yok. <code>TestKit Server Baslat</code> ile başlatın; bu panel kendiliğinden
                  dolar.
                </p>
              )}
            </div>
          </section>

          <AgentsPanel agents={agents} serverUrl={serverUrl} onChanged={() => void poll()} />
        </>
      ) : (
        <ScenarioList onOpen={(id) => navigate(`/scenarios/${id}`)} />
      )}

      <p className="phase-note">
        Kayıt sizin bilgisayarınızda yapılır, koşu sunucuda. Bir senaryo istediğiniz kadar veri setiyle
        çalıştırılabilir; her koşunun adımları, ekran görüntüleri ve kullandığı veri saklanır.
      </p>
    </div>
  );
}
