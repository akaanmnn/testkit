import { useEffect, useRef, useState } from 'react';
import type { DataSetSummary, DataSetValueInput, VariableDsl } from '@testkit/shared';
import { api } from '../api/client.js';

interface Props {
  scenarioId: string;
  variables: VariableDsl[];
  onError: (message: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Test data lives here, not in the scenario. Each row is one variable; each set
 * is one run's worth of values. Ahmet and Mehmet are two sets over the same
 * steps, which is the whole point of the split.
 */
export function DataSetPanel({ scenarioId, variables, onError }: Props) {
  const [dataSets, setDataSets] = useState<DataSetSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const load = async (keepId?: string | null) => {
    try {
      const result = await api.listDataSets(scenarioId);
      setDataSets(result.dataSets);
      const next = keepId ?? selectedId ?? result.dataSets[0]?.id ?? null;
      setSelectedId(result.dataSets.some((set) => set.id === next) ? next : (result.dataSets[0]?.id ?? null));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Veri setleri yüklenemedi.');
      setDataSets([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  const selected = dataSets?.find((set) => set.id === selectedId) ?? null;

  useEffect(() => {
    // Reset the text drafts whenever a different set is opened, so a half-typed
    // value never leaks from one set into another.
    if (!selected) return;
    setDrafts(
      Object.fromEntries(
        selected.values
          .filter((value) => value.variableType !== 'file')
          .map((value) => [value.variableKey, value.textValue ?? '']),
      ),
    );
  }, [selectedId, selected?.updatedAt]);

  const run = async (action: () => Promise<unknown>, keepId?: string | null) => {
    setBusy(true);
    try {
      await action();
      await load(keepId);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Bu işlem tamamlanamadı.');
    } finally {
      setBusy(false);
    }
  };

  const create = (cloneFromId?: string) =>
    run(async () => {
      const created = await api.createDataSet(scenarioId, { name: newName.trim(), cloneFromId });
      setNewName('');
      setSelectedId(created.id);
      return created;
    });

  const saveTexts = () => {
    if (!selected) return;
    const values: DataSetValueInput[] = Object.entries(drafts).map(([variableKey, textValue]) => ({
      variableKey,
      textValue: textValue.length > 0 ? textValue : null,
    }));
    void run(() => api.setDataSetValues(selected.id, values), selected.id);
  };

  const pickFile = (variableKey: string) => {
    setUploadingKey(variableKey);
    fileInput.current?.click();
  };

  const onFileChosen = async (file: File | undefined) => {
    const key = uploadingKey;
    setUploadingKey(null);
    if (!file || !selected || !key) return;
    await run(async () => {
      const stored = await api.uploadFile(file);
      return api.setDataSetValues(selected.id, [{ variableKey: key, fileId: stored.id }]);
    }, selected.id);
  };

  if (variables.length === 0) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Veri setleri</h2>
        </div>
        <div className="panel-body">
          <p className="empty">
            Veri seti için önce değişken gerekiyor. Aşağıdan bir değişken ekleyin; sonra her koşu için burada değer
            girersiniz.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Veri setleri</h2>
        <span className="readout">{dataSets?.length ?? '—'} set</span>
      </div>
      <div className="panel-body">
        <input
          ref={fileInput}
          type="file"
          style={{ display: 'none' }}
          onChange={(event) => {
            void onFileChosen(event.target.files?.[0]);
            event.target.value = '';
          }}
        />

        {dataSets === null ? (
          <p className="empty">Yükleniyor…</p>
        ) : dataSets.length === 0 ? (
          <p className="empty">
            Henüz veri seti yok. Aynı testi farklı verilerle koşturmak için her senaryo verisi bir set olur; örneğin
            Ahmet ve Mehmet.
          </p>
        ) : (
          <div className="set-tabs">
            {dataSets.map((set) => (
              <button
                key={set.id}
                className={set.id === selectedId ? 'active' : ''}
                onClick={() => setSelectedId(set.id)}
              >
                {set.name}
                {set.missing.length > 0 && <span className="badge" title="Eksik değer var">!</span>}
              </button>
            ))}
          </div>
        )}

        {selected && (
          <>
            {selected.missing.length > 0 && (
              <p className="notice">
                Eksik: {selected.missing.join(', ')}. Bu set tamamlanmadan test bu veriyle koşturulamaz.
              </p>
            )}

            <table className="grid" style={{ marginTop: '0.8rem' }}>
              <thead>
                <tr>
                  <th>Değişken</th>
                  <th>Değer</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {selected.values.map((value) => (
                  <tr key={value.variableId}>
                    <td>
                      <code>{value.variableKey}</code>
                      {value.required && <span className="muted"> · zorunlu</span>}
                    </td>
                    <td>
                      {value.variableType === 'file' ? (
                        value.file ? (
                          <>
                            <a href={`/api/files/${value.file.id}/download`}>{value.file.originalName}</a>
                            <span className="muted"> · {formatSize(value.file.sizeBytes)}</span>
                          </>
                        ) : (
                          <span className="muted">dosya seçilmedi</span>
                        )
                      ) : (
                        <input
                          type="text"
                          value={drafts[value.variableKey] ?? ''}
                          disabled={busy}
                          aria-label={`${value.variableKey} değeri`}
                          onChange={(event) =>
                            setDrafts((previous) => ({ ...previous, [value.variableKey]: event.target.value }))
                          }
                        />
                      )}
                    </td>
                    <td className="num nowrap">
                      {value.variableType === 'file' && (
                        <button className="quiet small" disabled={busy} onClick={() => pickFile(value.variableKey)}>
                          {value.file ? 'Değiştir' : 'Dosya seç'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="row" style={{ marginTop: '1rem' }}>
              <button onClick={saveTexts} disabled={busy}>
                Değerleri kaydet
              </button>
              <button
                className="quiet"
                disabled={busy || newName.trim().length === 0}
                onClick={() => void create(selected.id)}
                title="Aşağıdaki adla, bu setin değerlerini kopyalayarak yeni set oluşturur"
              >
                Kopyala
              </button>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => void run(() => api.deleteDataSet(selected.id), null)}
              >
                Seti sil
              </button>
            </div>
          </>
        )}

        <div className="row" style={{ marginTop: '1.25rem' }}>
          <input
            type="text"
            placeholder="Ahmet"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            aria-label="Yeni veri seti adı"
          />
          <button disabled={busy || newName.trim().length === 0} onClick={() => void create()}>
            Veri seti ekle
          </button>
        </div>
      </div>
    </section>
  );
}
