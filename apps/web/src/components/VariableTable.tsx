import { useState } from 'react';
import type { ScenarioDetailResponse, VariableDsl, VariableType } from '@testkit/shared';
import { VARIABLE_TYPES } from '@testkit/shared';
import { api } from '../api/client.js';

interface Props {
  scenarioId: string;
  variables: VariableDsl[];
  onChanged: (next: ScenarioDetailResponse) => void;
  onError: (message: string) => void;
}

/**
 * The scenario's contract, not its data. A row here says "this test needs a
 * customer name"; the value for any given run lives in a data set.
 */
export function VariableTable({ scenarioId, variables, onChanged, onError }: Props) {
  const [key, setKey] = useState('');
  const [type, setType] = useState<VariableType>('text');
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<ScenarioDetailResponse>) => {
    setBusy(true);
    try {
      onChanged(await action());
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Değişiklik uygulanamadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Değişkenler</h2>
        <span className="readout">değerleri veri setinden gelir</span>
      </div>
      <div className="panel-body">
        {variables.length === 0 ? (
          <p className="empty">
            Henüz değişken yok. Koşular arasında değişen her değer için bir tane ekleyin, sonra yukarıdan bir adıma bağlayın.
          </p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Ad</th>
                <th>Tip</th>
                <th>Zorunlu</th>
                <th>Varsayılan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {variables.map((variable) => (
                <tr key={variable.id}>
                  <td>
                    <code>{variable.key}</code>
                  </td>
                  <td>
                    <span className="tag" data-status={variable.type === 'file' ? 'file' : 'text'}>
                      {variable.type}
                    </span>
                  </td>
                  <td>
                    <button
                      className="quiet small"
                      disabled={busy}
                      onClick={() =>
                        void run(() => api.updateVariable(variable.id, { required: !variable.required }))
                      }
                    >
                      {variable.required ? 'zorunlu' : 'isteğe bağlı'}
                    </button>
                  </td>
                  <td>
                    {variable.type === 'file' ? (
                      <span className="muted">veri setinden</span>
                    ) : (
                      <code>{variable.defaultValue ?? '—'}</code>
                    )}
                  </td>
                  <td className="num">
                    <button
                      className="quiet small"
                      disabled={busy}
                      onClick={() => void run(() => api.deleteVariable(variable.id))}
                    >
                      Kaldır
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="row" style={{ marginTop: '1rem' }}>
          <input
            type="text"
            placeholder="customerName"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            aria-label="Değişken adı"
          />
          <select value={type} onChange={(event) => setType(event.target.value as VariableType)} aria-label="Tip">
            {VARIABLE_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            disabled={busy || key.trim().length === 0}
            onClick={() =>
              void run(async () => {
                const next = await api.addVariable(scenarioId, { key: key.trim(), type });
                setKey('');
                return next;
              })
            }
          >
            Değişken ekle
          </button>
        </div>
      </div>
    </section>
  );
}
