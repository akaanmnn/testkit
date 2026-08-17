import { useEffect, useState } from 'react';
import type { ScenarioSummary } from '@testkit/shared';
import { api } from '../api/client.js';

interface Props {
  onOpen: (id: string) => void;
}

export function ScenarioList({ onOpen }: Props) {
  const [scenarios, setScenarios] = useState<ScenarioSummary[] | null>(null);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await api.listScenarios();
      setScenarios(result.scenarios);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Senaryolar yüklenemedi.');
      setScenarios([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createScenario({ name, baseUrl });
      setName('');
      setBaseUrl('');
      onOpen(created.scenario.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Senaryo oluşturulamadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Senaryolar</h2>
          <span className="readout">{scenarios?.length ?? '—'} senaryo</span>
        </div>
        <div className="panel-body">
          {scenarios === null ? (
            <p className="empty">Yükleniyor…</p>
          ) : scenarios.length === 0 ? (
            <p className="empty">
              Henüz senaryo yok. Aşağıdan elle oluşturabilir ya da <strong>Kayıt</strong> sekmesinden kaydedebilirsiniz.
            </p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Senaryo</th>
                  <th className="num">Adım</th>
                  <th className="num">Değişken</th>
                  <th className="num">Veri seti</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((scenario) => (
                  <tr key={scenario.id} onClick={() => onOpen(scenario.id)} className="clickable">
                    <td>
                      <span className="cell-title">{scenario.name}</span>
                      <span className="cell-sub">{scenario.baseUrl}</span>
                    </td>
                    <td className="num">{scenario.stepCount}</td>
                    <td className="num">{scenario.variableCount}</td>
                    <td className="num">{scenario.dataSetCount}</td>
                    <td>
                      <span className="tag" data-status={scenario.status}>
                        {scenario.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Yeni senaryo</h2>
        </div>
        <div className="panel-body">
          <div className="row">
            <input
              type="text"
              placeholder="Müşteri Oluşturma"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Senaryo adı"
            />
            <input
              type="text"
              placeholder="https://app.internal/customers/new"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              aria-label="Başlangıç adresi"
              style={{ minWidth: '20rem' }}
            />
            <button onClick={() => void create()} disabled={busy || name.trim().length < 2 || !baseUrl.trim()}>
              Senaryoyu oluştur
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </section>
    </>
  );
}
