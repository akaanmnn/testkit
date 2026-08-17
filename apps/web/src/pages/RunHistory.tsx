import { useEffect, useState } from 'react';
import type { TestRunSummary } from '@testkit/shared';
import { api } from '../api/client.js';

interface Props {
  onOpenRun: (runId: string) => void;
}

const RUN_LABEL: Record<string, string> = {
  queued: 'sırada',
  running: 'çalışıyor',
  passed: 'GEÇTİ',
  failed: 'BAŞARISIZ',
  error: 'HATA',
  cancelled: 'iptal',
};

/** Every run, newest first. Refreshes while anything is still in flight. */
export function RunHistory({ onOpenRun }: Props) {
  const [runs, setRuns] = useState<TestRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: number | null = null;

    const load = async () => {
      try {
        const result = await api.listRuns(undefined, 100);
        setRuns(result.runs);
        const active = result.runs.some((run) => run.status === 'queued' || run.status === 'running');
        // Poll only while something is running: an idle history does not move.
        if (active) timer = window.setTimeout(() => void load(), 2000);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Koşu geçmişi yüklenemedi.');
        setRuns([]);
      }
    };

    void load();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Koşular</h2>
        <span className="readout">{runs?.length ?? '—'} kayıt</span>
      </div>
      <div className="panel-body">
        {error && <p className="error">{error}</p>}
        {runs === null ? (
          <p className="empty">Yükleniyor…</p>
        ) : runs.length === 0 ? (
          <p className="empty">
            Henüz koşu yok. Bir senaryo açıp veri seti seçtikten sonra <strong>Çalıştır</strong> düğmesini kullanın.
          </p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Sonuç</th>
                <th>Senaryo</th>
                <th>Veri seti</th>
                <th className="num">Geçen</th>
                <th className="num">Başarısız</th>
                <th>Zaman</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="clickable" onClick={() => onOpenRun(run.id)}>
                  <td>
                    <span className="tag" data-status={run.status}>
                      {RUN_LABEL[run.status] ?? run.status}
                    </span>
                  </td>
                  <td>
                    <span className="cell-title">{run.scenarioName}</span>
                  </td>
                  <td>{run.dataSetName ?? '—'}</td>
                  <td className="num">{run.passedCount}</td>
                  <td className="num">{run.failedCount}</td>
                  <td className="muted">{new Date(run.queuedAt).toLocaleString('tr-TR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
