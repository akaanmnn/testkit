import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunEvent, TestRunDetail } from '@testkit/shared';
import { api } from '../api/client.js';

interface Props {
  runId: string;
  onBack: () => void;
}

const STATUS_MARK: Record<string, string> = { passed: '✅', failed: '❌', skipped: '⏭' };

const RUN_LABEL: Record<string, string> = {
  queued: 'sırada',
  running: 'çalışıyor',
  passed: 'GEÇTİ',
  failed: 'BAŞARISIZ',
  error: 'HATA',
  cancelled: 'iptal edildi',
};

function seconds(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} sn`;
}

export function RunDetail({ runId, onBack }: Props) {
  const [detail, setDetail] = useState<TestRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const stream = useRef<EventSource | null>(null);

  const reload = useCallback(async () => {
    try {
      setDetail(await api.getRun(runId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Koşu yüklenemedi.');
    }
  }, [runId]);

  useEffect(() => {
    void reload();

    const source = new EventSource(`/api/events?channel=run:${runId}`);
    stream.current = source;

    // A short run can finish before this subscription exists, so the stream is
    // for liveness and the fetch is for truth: reconcile whenever either fires.
    source.addEventListener('open', () => void reload());

    source.onmessage = (message) => {
      let event: RunEvent;
      try {
        event = JSON.parse(message.data) as RunEvent;
      } catch {
        return;
      }
      // Every event changes something the table shows, and the run is small, so
      // re-reading it keeps this component free of partial-update bugs.
      void reload();
      if (event.type === 'run.finished') source.close();
    };

    return () => source.close();
  }, [runId, reload]);

  if (error && !detail) {
    return (
      <section className="panel">
        <div className="panel-body">
          <p className="error">{error}</p>
          <button className="quiet" onClick={onBack} style={{ marginTop: '0.8rem' }}>
            Geri
          </button>
        </div>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="panel">
        <div className="panel-body">
          <p className="empty">Yükleniyor…</p>
        </div>
      </section>
    );
  }

  const inProgress = detail.status === 'queued' || detail.status === 'running';

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{detail.scenarioName}</h2>
          <span className="readout">
            <button className="quiet small" onClick={onBack}>
              Geri
            </button>
          </span>
        </div>
        <div className="panel-body">
          <div className="verdict" data-status={detail.status}>
            <strong>{RUN_LABEL[detail.status] ?? detail.status}</strong>
            <span>
              {detail.dataSetName ? `veri seti: ${detail.dataSetName}` : 'veri seti seçilmedi'} ·{' '}
              {seconds(detail.durationMs)}
            </span>
          </div>

          <dl className="readout-grid" style={{ marginTop: '1rem' }}>
            <div className="readout-cell">
              <dt>geçen</dt>
              <dd data-tone="ok">{detail.passedCount}</dd>
            </div>
            <div className="readout-cell">
              <dt>başarısız</dt>
              <dd data-tone={detail.failedCount > 0 ? 'bad' : undefined}>{detail.failedCount}</dd>
            </div>
            <div className="readout-cell">
              <dt>atlanan</dt>
              <dd>{detail.skippedCount}</dd>
            </div>
            <div className="readout-cell">
              <dt>başlangıç</dt>
              <dd>{detail.startedAt ? new Date(detail.startedAt).toLocaleTimeString('tr-TR') : '—'}</dd>
            </div>
          </dl>

          {detail.errorMessage && <p className="error">{detail.errorMessage}</p>}

          {inProgress && (
            <div className="row" style={{ marginTop: '1rem' }}>
              <button className="quiet" onClick={() => void api.cancelRun(runId).then(reload)}>
                Koşuyu iptal et
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Adımlar</h2>
          <span className="readout">{inProgress ? 'canlı' : `${detail.steps.length} adım`}</span>
        </div>
        <div className="panel-body">
          {detail.steps.length === 0 ? (
            <p className="empty">Tarayıcı açılıyor, ilk adım bekleniyor…</p>
          ) : (
            <table className="grid steps">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th />
                  <th>Aksiyon</th>
                  <th>Hedef</th>
                  <th>Değer</th>
                  <th className="num">Süre</th>
                  <th>Görüntü</th>
                </tr>
              </thead>
              <tbody>
                {detail.steps.map((step) => (
                  <tr key={step.order} data-disabled={step.status === 'skipped'}>
                    <td className="num muted">{step.order}</td>
                    <td>{STATUS_MARK[step.status] ?? '·'}</td>
                    <td>
                      <span className="tag" data-status={step.type}>
                        {step.type}
                      </span>
                    </td>
                    <td>
                      <code className="target">{step.label ?? '—'}</code>
                      {step.errorMessage && <div className="error">{step.errorMessage}</div>}
                    </td>
                    <td>
                      <code>{step.resolvedValue ?? '—'}</code>
                    </td>
                    <td className="num muted">{seconds(step.durationMs)}</td>
                    <td>
                      {step.screenshotUrl ? (
                        <button className="thumb" onClick={() => setZoomed(step.screenshotUrl)}>
                          <img src={step.screenshotUrl} alt={`${step.order}. adım ekran görüntüsü`} />
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {detail.resolvedData.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Bu koşuda kullanılan veri</h2>
            <span className="readout">koşu anındaki hâli</span>
          </div>
          <div className="panel-body">
            <table className="grid">
              <tbody>
                {detail.resolvedData.map((variable) => (
                  <tr key={variable.key}>
                    <td>
                      <code>{variable.key}</code>
                    </td>
                    <td>
                      <code className="target">{variable.value}</code>
                    </td>
                    <td className="muted">
                      {variable.source === 'dataSet' ? 'veri setinden' : 'varsayılandan'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="empty" style={{ marginTop: '0.6rem' }}>
              Veri seti sonradan değiştirilse bile burada koşu anındaki değerler görünür.
            </p>
          </div>
        </section>
      )}

      {zoomed && (
        <button className="lightbox" onClick={() => setZoomed(null)} aria-label="Görüntüyü kapat">
          <img src={zoomed} alt="Ekran görüntüsü" />
        </button>
      )}
    </>
  );
}
