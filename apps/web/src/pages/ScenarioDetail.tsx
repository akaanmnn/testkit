import { useEffect, useState } from 'react';
import type { ScenarioDetailResponse } from '@testkit/shared';
import { api } from '../api/client.js';
import { StepList } from '../components/StepList.js';
import { VariableTable } from '../components/VariableTable.js';
import { DataSetPanel } from '../components/DataSetPanel.js';
import { RunPanel } from '../components/RunPanel.js';

interface Props {
  scenarioId: string;
  onBack: () => void;
  onOpenRun: (runId: string) => void;
}

export function ScenarioDetail({ scenarioId, onBack, onOpenRun }: Props) {
  const [detail, setDetail] = useState<ScenarioDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getScenario(scenarioId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Senaryo yüklenemedi.');
      });
    return () => {
      cancelled = true;
    };
  }, [scenarioId]);

  const accept = (next: ScenarioDetailResponse) => {
    setDetail(next);
    setError(null);
  };

  if (error && !detail) {
    return (
      <section className="panel">
        <div className="panel-body">
          <p className="error">{error}</p>
          <button className="quiet" onClick={onBack} style={{ marginTop: '0.8rem' }}>
            Senaryolara dön
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

  const { scenario, dataSetCount } = detail;
  const missingBindings = scenario.variables.filter(
    (variable) => !scenario.steps.some((step) => step.value === `{{${variable.key}}}`),
  );

  const remove = async () => {
    try {
      await api.deleteScenario(scenario.id);
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Senaryo silinemedi.');
    }
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{scenario.name}</h2>
          <span className="readout">
            <button className="quiet small" onClick={onBack}>
              Tüm senaryolar
            </button>
          </span>
        </div>
        <div className="panel-body">
          <dl className="readout-grid">
            <div className="readout-cell">
              <dt>başlangıç adresi</dt>
              <dd style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{scenario.baseUrl}</dd>
            </div>
            <div className="readout-cell">
              <dt>durum</dt>
              <dd>{scenario.status}</dd>
            </div>
            <div className="readout-cell">
              <dt>adım</dt>
              <dd>{scenario.steps.length}</dd>
            </div>
            <div className="readout-cell">
              <dt>veri seti</dt>
              <dd>{dataSetCount}</dd>
            </div>
          </dl>

          {missingBindings.length > 0 && (
            <p className="notice">
              {missingBindings.map((v) => v.key).join(', ')} tanımlı ama henüz hiçbir adım kullanmıyor. Değer
              kolonundan bir adıma bağlayın.
            </p>
          )}

          {error && <p className="error">{error}</p>}

          <div className="row" style={{ marginTop: '1rem' }}>
            <button
              className="quiet"
              onClick={() =>
                void api
                  .updateScenario(scenario.id, { status: scenario.status === 'ready' ? 'draft' : 'ready' })
                  .then(accept)
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : 'Durum değiştirilemedi.'),
                  )
              }
            >
              {scenario.status === 'ready' ? 'Taslağa geri al' : 'Hazır olarak işaretle'}
            </button>
            <button className="quiet" onClick={() => void remove()}>
              Senaryoyu sil
            </button>
          </div>
        </div>
      </section>

      <RunPanel scenarioId={scenario.id} onOpenRun={onOpenRun} onError={setError} />

      <StepList
        scenarioId={scenario.id}
        steps={scenario.steps}
        variables={scenario.variables}
        onChanged={accept}
        onError={setError}
      />

      <VariableTable
        scenarioId={scenario.id}
        variables={scenario.variables}
        onChanged={accept}
        onError={setError}
      />

      <DataSetPanel scenarioId={scenario.id} variables={scenario.variables} onError={setError} />
    </>
  );
}
