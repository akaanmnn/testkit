import { useCallback, useEffect, useState } from 'react';
import type { DataSetSummary, ResolutionPreview, TestRunSummary } from '@testkit/shared';
import { api } from '../api/client.js';

interface Props {
  scenarioId: string;
  onOpenRun: (runId: string) => void;
  onError: (message: string) => void;
}

const RUN_LABEL: Record<string, string> = {
  queued: 'sırada',
  running: 'çalışıyor',
  passed: 'GEÇTİ',
  failed: 'BAŞARISIZ',
  error: 'HATA',
  cancelled: 'iptal',
};

/**
 * Starting a run and seeing how it went. The preflight check runs before the
 * button is enabled, so an analyst learns about a missing spreadsheet here rather
 * than from a browser timing out.
 */
export function RunPanel({ scenarioId, onOpenRun, onError }: Props) {
  const [dataSets, setDataSets] = useState<DataSetSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<ResolutionPreview | null>(null);
  const [runs, setRuns] = useState<TestRunSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      const result = await api.listRuns(scenarioId, 10);
      setRuns(result.runs);
    } catch {
      // The history is supplementary; a failure here must not block starting a run.
    }
  }, [scenarioId]);

  useEffect(() => {
    void api
      .listDataSets(scenarioId)
      .then((result) => {
        setDataSets(result.dataSets);
        const first = result.dataSets.find((set) => set.missing.length === 0) ?? result.dataSets[0];
        setSelected(first ? [first.id] : []);
      })
      .catch(() => setDataSets([]));
    void loadRuns();
  }, [scenarioId, loadRuns]);

  useEffect(() => {
    const single = selected.length === 1 ? selected[0] : null;
    void api
      .resolve(scenarioId, single ?? null)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [scenarioId, selected]);

  const toggle = (id: string) =>
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );

  const start = async () => {
    setBusy(true);
    try {
      if (selected.length > 1) {
        const result = await api.startBatchRun(scenarioId, selected);
        await loadRuns();
        if (result.runIds[0]) onOpenRun(result.runIds[0]);
      } else {
        const result = await api.startRun(scenarioId, selected[0] ?? null);
        onOpenRun(result.runId);
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Koşu başlatılamadı.');
    } finally {
      setBusy(false);
    }
  };

  const blocked = preview !== null && !preview.runnable && selected.length <= 1;
  const incompleteSelected = dataSets.filter((set) => selected.includes(set.id) && set.missing.length > 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Testi çalıştır</h2>
        <span className="readout">sunucuda, arka planda</span>
      </div>
      <div className="panel-body">
        {dataSets.length === 0 ? (
          <p className="empty">
            Önce bir veri seti ekleyin. Test hangi veriyle koşacağını veri setinden alır.
          </p>
        ) : (
          <>
            <div className="checks">
              {dataSets.map((set) => (
                <label key={set.id} className="check">
                  <input
                    type="checkbox"
                    checked={selected.includes(set.id)}
                    onChange={() => toggle(set.id)}
                    disabled={busy}
                  />
                  {set.name}
                  {set.missing.length > 0 && <span className="badge">!</span>}
                </label>
              ))}
            </div>

            {incompleteSelected.length > 0 && (
              <p className="notice">
                {incompleteSelected.map((set) => set.name).join(', ')} setinde eksik değer var; bu set
                çalıştırılamaz.
              </p>
            )}

            {blocked && preview && (
              <div className="notice">
                {preview.problems.map((problem, index) => (
                  <div key={index}>{problem.message}</div>
                ))}
              </div>
            )}

            <div className="row" style={{ marginTop: '1rem' }}>
              <button
                onClick={() => void start()}
                disabled={busy || selected.length === 0 || incompleteSelected.length > 0 || blocked}
              >
                {selected.length > 1 ? `${selected.length} veri setiyle çalıştır` : 'Çalıştır'}
              </button>
              {preview?.runnable && selected.length === 1 && (
                <span className="muted">
                  {preview.variables.length} değer hazır, {preview.variables.filter((v) => v.type === 'file').length}{' '}
                  dosya
                </span>
              )}
            </div>
          </>
        )}

        {runs.length > 0 && (
          <table className="grid" style={{ marginTop: '1.5rem' }}>
            <thead>
              <tr>
                <th>Son koşular</th>
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
