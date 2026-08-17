import { useState } from 'react';
import type { AgentSummary, CreateAgentResponse } from '@testkit/shared';
import { api } from '../api/client.js';

interface Props {
  agents: AgentSummary[];
  serverUrl: string;
  onChanged: () => void;
}

function lastSeen(agent: AgentSummary): string {
  if (agent.state === 'connected') {
    const age = agent.heartbeatAgeMs ?? 0;
    return `${Math.round(age / 1000)} sn önce sinyal aldı`;
  }
  if (!agent.lastSeenAt) return 'hiç bağlanmadı';
  const minutes = Math.round((Date.now() - new Date(agent.lastSeenAt).getTime()) / 60_000);
  if (minutes < 1) return 'az önce görüldü';
  if (minutes < 60) return `${minutes} dk önce görüldü`;
  return `son görülme: ${new Date(agent.lastSeenAt).toLocaleString('tr-TR')}`;
}

export function AgentsPanel({ agents, serverUrl, onChanged }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<CreateAgentResponse | null>(null);

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createAgent(name);
      setIssued(result);
      setName('');
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Makine kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (agent: AgentSummary) => {
    setBusy(true);
    setError(null);
    try {
      setIssued(await api.rotateToken(agent.id));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Yeni token üretilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (agent: AgentSummary) => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAgent(agent.id);
      if (issued?.agent.id === agent.id) setIssued(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Makine kaldırılamadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Analist makineleri</h2>
        <span className="readout">{agents.length} kayıtlı</span>
      </div>
      <div className="panel-body">
        {agents.length === 0 ? (
          <p className="empty">
            Kayıt tarayıcısını açacak bilgisayarı ekleyin. Kayıt orada çalışır, bu sunucuda değil.
          </p>
        ) : (
          <div>
            {agents.map((agent) => (
              <div className="agent-row" key={agent.id}>
                <span className="dot" data-state={agent.state} aria-hidden="true" />
                <span className="agent-name">{agent.name}</span>
                <span className="agent-meta">
                  {agent.os ?? 'işletim sistemi bilinmiyor'} · agent {agent.agentVersion ?? '—'} · playwright{' '}
                  {agent.playwrightVersion ?? '—'}
                  <br />
                  {lastSeen(agent)}
                </span>
                <a className="button-link" href={`/api/agents/${agent.id}/config`}>
                  Config indir
                </a>
                <button className="quiet" onClick={() => void rotate(agent)} disabled={busy}>
                  Yeni token
                </button>
                <button className="quiet" onClick={() => void remove(agent)} disabled={busy}>
                  Kaldır
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: agents.length === 0 ? '1rem' : '1.25rem' }}>
          <input
            type="text"
            placeholder="AHMET-PC"
            value={name}
            onChange={(event) => setName(event.target.value.toUpperCase())}
            aria-label="Makine adı"
          />
          <button onClick={() => void register()} disabled={busy || name.trim().length < 2}>
            Makineyi kaydet
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {issued && (
          <div className="token-card">
            <h3>{issued.agent.name} için token</h3>
            <p>
              Yukarıdaki <strong>Config indir</strong> düğmesini kullanın ve dosyayı {issued.agent.name}{' '}
              bilgisayarındaki TestKit Agent klasörüne koyun. Analist sonrasında yalnızca programı başlatır.
            </p>
            <p>Terminalden eşleştirmek isterseniz bu token bir kez çalışır:</p>
            <pre>
              testkit-agent login --server {serverUrl} --token {issued.token} --name {issued.agent.name}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
