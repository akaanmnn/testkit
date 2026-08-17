import { useState } from 'react';
import type { ScenarioDetailResponse, StepInput, StepType, TestStepDsl, VariableDsl } from '@testkit/shared';
import { PARAMETERISABLE_STEP_TYPES, STEP_TYPES, parseBinding } from '@testkit/shared';
import { api } from '../api/client.js';

interface Props {
  scenarioId: string;
  steps: TestStepDsl[];
  variables: VariableDsl[];
  onChanged: (next: ScenarioDetailResponse) => void;
  onError: (message: string) => void;
}

const NEEDS_VALUE: readonly StepType[] = ['navigate', 'fill', 'select', 'press', 'assertText', 'assertValue'];

/** DSL -> the shape the server accepts back. Bindings are re-derived server-side. */
function toInput(step: TestStepDsl, variables: VariableDsl[]): StepInput {
  const boundKey = parseBinding(step.value);
  const variable = boundKey ? variables.find((v) => v.key === boundKey) : undefined;
  return {
    id: step.id,
    type: step.type,
    enabled: step.enabled,
    selector: step.target?.selector,
    label: step.target?.label,
    pageAlias: step.target?.pageAlias,
    recordedValue: step.recordedValue ?? null,
    variableId: variable?.id ?? null,
    options: step.options ?? null,
  };
}

export function StepList({ scenarioId, steps, variables, onChanged, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [draftType, setDraftType] = useState<StepType>('click');
  const [draftSelector, setDraftSelector] = useState('');
  const [draftValue, setDraftValue] = useState('');

  const save = async (nextSteps: StepInput[]) => {
    setBusy(true);
    try {
      onChanged(await api.replaceSteps(scenarioId, nextSteps));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Adımlar kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const current = () => steps.map((step) => toInput(step, variables));

  const move = (index: number, delta: number) => {
    const next = current();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const moved = next[index];
    const displaced = next[target];
    if (!moved || !displaced) return;
    next[index] = displaced;
    next[target] = moved;
    void save(next);
  };

  const patch = (index: number, changes: Partial<StepInput>) => {
    const next = current();
    const existing = next[index];
    if (!existing) return;
    next[index] = { ...existing, ...changes };
    void save(next);
  };

  const remove = (index: number) => {
    void save(current().filter((_, i) => i !== index));
  };

  const add = () => {
    const step: StepInput = {
      type: draftType,
      enabled: true,
      selector: draftType === 'navigate' ? undefined : draftSelector.trim(),
      label: draftType === 'navigate' ? undefined : draftSelector.trim(),
      recordedValue: NEEDS_VALUE.includes(draftType) ? draftValue.trim() : null,
    };
    void save([...current(), step]).then(() => {
      setDraftSelector('');
      setDraftValue('');
    });
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Adımlar</h2>
        <span className="readout">{steps.length} adım</span>
      </div>
      <div className="panel-body">
        {steps.length === 0 ? (
          <p className="empty">
            Henüz adım yok. Aşağıdan elle ekleyin ya da <strong>Kayıt</strong> sekmesinden kaydedip buradan düzenleyin.
          </p>
        ) : (
          <table className="grid steps">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Aksiyon</th>
                <th>Hedef</th>
                <th>Değer</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {steps.map((step, index) => {
                const boundKey = parseBinding(step.value);
                const canBind = PARAMETERISABLE_STEP_TYPES.includes(step.type);
                return (
                  <tr key={step.id} data-disabled={!step.enabled}>
                    <td className="num muted">{index + 1}</td>
                    <td>
                      <span className="tag" data-status={step.type}>
                        {step.type}
                      </span>
                    </td>
                    <td>
                      <code className="target">{step.target?.label ?? '—'}</code>
                    </td>
                    <td>
                      {canBind ? (
                        <select
                          value={boundKey ?? ''}
                          disabled={busy}
                          aria-label={`${index + 1}. adımın değer kaynağı`}
                          onChange={(event) => {
                            const key = event.target.value;
                            const variable = variables.find((v) => v.key === key);
                            patch(index, { variableId: variable?.id ?? null });
                          }}
                        >
                          <option value="">
                            sabit: {step.recordedValue ?? '—'}
                          </option>
                          {variables
                            .filter((v) => (step.type === 'upload' ? v.type === 'file' : v.type !== 'file'))
                            .map((v) => (
                              <option key={v.id} value={v.key}>
                                {`{{${v.key}}}`}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <code>{step.value ?? '—'}</code>
                      )}
                    </td>
                    <td className="num nowrap">
                      <button className="quiet small" disabled={busy || index === 0} onClick={() => move(index, -1)}>
                        ↑
                      </button>
                      <button
                        className="quiet small"
                        disabled={busy || index === steps.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="quiet small"
                        disabled={busy}
                        onClick={() => patch(index, { enabled: !step.enabled })}
                      >
                        {step.enabled ? 'Atla' : 'Etkinleştir'}
                      </button>
                      <button className="quiet small" disabled={busy} onClick={() => remove(index)}>
                        Sil
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="row" style={{ marginTop: '1rem' }}>
          <select
            value={draftType}
            onChange={(event) => setDraftType(event.target.value as StepType)}
            aria-label="Aksiyon türü"
          >
            {STEP_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          {draftType !== 'navigate' && (
            <input
              type="text"
              placeholder='internal:role=button[name="Kaydet"i]'
              value={draftSelector}
              onChange={(event) => setDraftSelector(event.target.value)}
              aria-label="Hedef"
              style={{ minWidth: '18rem' }}
            />
          )}
          {NEEDS_VALUE.includes(draftType) && (
            <input
              type="text"
              placeholder={draftType === 'navigate' ? 'https://app.internal/…' : 'değer'}
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              aria-label="Değer"
            />
          )}
          <button
            disabled={
              busy ||
              (draftType === 'navigate' ? draftValue.trim().length === 0 : draftSelector.trim().length === 0)
            }
            onClick={add}
          >
            Adım ekle
          </button>
        </div>
      </div>
    </section>
  );
}
