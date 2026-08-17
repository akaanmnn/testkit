import { useEffect, useRef, useState } from 'react';
import type {
  AgentSummary,
  ParameterisationChoice,
  RecordingEvent,
  RecordingSessionResponse,
  TestStepDsl,
  VariableCandidate,
} from '@testkit/shared';
import { api } from '../api/client.js';

interface Props {
  agents: AgentSummary[];
  onCommitted: (scenarioId: string) => void;
}

type Phase = 'idle' | 'starting' | 'recording' | 'review';

export function RecordPage({ agents, onCommitted }: Props) {
  const connected = agents.filter((agent) => agent.state === 'connected');
  const [agentId, setAgentId] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<RecordingSessionResponse | null>(null);
  const [steps, setSteps] = useState<TestStepDsl[]>([]);
  const [candidates, setCandidates] = useState<VariableCandidate[]>([]);
  const [choices, setChoices] = useState<Record<number, ParameterisationChoice>>({});
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [scenarioName, setScenarioName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stream = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!agentId && connected[0]) setAgentId(connected[0].id);
  }, [connected, agentId]);

  useEffect(() => () => stream.current?.close(), []);

  const listen = (sessionId: string) => {
    stream.current?.close();
    const source = new EventSource(`/api/events?channel=recording:${sessionId}`);
    stream.current = source;

    source.onmessage = (message) => {
      let event: RecordingEvent;
      try {
        event = JSON.parse(message.data) as RecordingEvent;
      } catch {
        return;
      }
      if (event.type === 'recording.started') setPhase('recording');
      if (event.type === 'recording.step') {
        setSteps((previous) => [...previous, event.step]);
      }
      if (event.type === 'recording.steps') setSteps(event.steps);
      if (event.type === 'recording.stopped') {
        setSteps(event.steps);
        setCandidates(event.variableCandidates);
        setChoices(
          Object.fromEntries(
            event.variableCandidates.map((candidate) => [
              candidate.stepIndex,
              {
                stepIndex: candidate.stepIndex,
                // A recorded file name cannot be replayed, so uploads start ticked.
                parameterise: candidate.mandatory,
                key: candidate.suggestedKey,
              } satisfies ParameterisationChoice,
            ]),
          ),
        );
        setPhase('review');
        if (event.reason === 'error' && event.errorMessage) setError(event.errorMessage);
        source.close();
      }
    };
  };

  const start = async () => {
    setError(null);
    setSteps([]);
    setCandidates([]);
    setDropped(new Set());
    setPhase('starting');
    try {
      const started = await api.startRecording({ agentId, targetUrl });
      setSession(started);
      setScenarioName('');
      listen(started.sessionId);
    } catch (cause) {
      setPhase('idle');
      setError(cause instanceof Error ? cause.message : 'Kayıt başlatılamadı.');
    }
  };

  const stop = async () => {
    if (!session) return;
    try {
      await api.stopRecording(session.sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kayıt durdurulamadı.');
    }
  };

  const commit = async () => {
    if (!session) return;
    try {
      const saved = await api.commitRecording(session.sessionId, {
        name: scenarioName.trim(),
        choices: Object.values(choices),
        droppedStepIndexes: [...dropped],
      });
      stream.current?.close();
      onCommitted(saved.scenario.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Senaryo kaydedilemedi.');
    }
  };

  const discard = async () => {
    if (session) await api.discardRecording(session.sessionId).catch(() => undefined);
    stream.current?.close();
    setPhase('idle');
    setSession(null);
    setSteps([]);
  };

  const busy = phase === 'starting' || phase === 'recording';

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Test kaydet</h2>
          <span className="readout">
            {phase === 'recording'
              ? `kaydediliyor · ${steps.length} adım`
              : phase === 'starting'
                ? 'tarayıcı açılıyor…'
                : phase === 'review'
                  ? 'gözden geçirme'
                  : `${connected.length} makine hazır`}
          </span>
        </div>
        <div className="panel-body">
          {connected.length === 0 ? (
            <p className="empty">
              Bağlı makine yok. Kaydı yapacağınız bilgisayarda TestKit Agent'ı başlatın; tarayıcı orada açılır,
              sunucuda değil.
            </p>
          ) : phase === 'idle' ? (
            <>
              <div className="row">
                <select value={agentId} onChange={(event) => setAgentId(event.target.value)} aria-label="Makine">
                  {connected.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="https://app.internal/customers/new"
                  value={targetUrl}
                  onChange={(event) => setTargetUrl(event.target.value)}
                  aria-label="Kaydedilecek adres"
                  style={{ minWidth: '22rem' }}
                />
                <button onClick={() => void start()} disabled={!agentId || targetUrl.trim().length === 0}>
                  Kaydı başlat
                </button>
              </div>
              <p className="empty" style={{ marginTop: '0.8rem' }}>
                Chromium {connected.find((a) => a.id === agentId)?.name ?? 'o makinede'} üzerinde açılır.
                Uygulamayı normalde nasıl kullanıyorsanız öyle kullanın; dosyaları kendi diskinizden seçebilirsiniz.
                Bitirdiğinizde buradan durdurun.
              </p>
            </>
          ) : (
            <div className="row">
              {phase !== 'review' ? (
                <button onClick={() => void stop()}>Kaydı durdur</button>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Müşteri Oluşturma"
                    value={scenarioName}
                    onChange={(event) => setScenarioName(event.target.value)}
                    aria-label="Senaryo adı"
                  />
                  <button onClick={() => void commit()} disabled={scenarioName.trim().length < 2}>
                    Senaryoyu kaydet
                  </button>
                </>
              )}
              <button className="quiet" onClick={() => void discard()}>
                Vazgeç
              </button>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      </section>

      {(phase === 'recording' || phase === 'review') && (
        <section className="panel">
          <div className="panel-head">
            <h2>{phase === 'review' ? 'Kaydedilen adımlar' : 'Canlı'}</h2>
            <span className="readout">{steps.length} adım</span>
          </div>
          <div className="panel-body">
            {steps.length === 0 ? (
              <p className="empty">İlk aksiyon bekleniyor. Az önce açılan tarayıcıda bir şeye tıklayın.</p>
            ) : (
              <table className="grid steps">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Aksiyon</th>
                    <th>Hedef</th>
                    <th>Değer</th>
                    {phase === 'review' && <th />}
                  </tr>
                </thead>
                <tbody>
                  {steps.map((step, index) => (
                    <tr key={step.id} data-disabled={dropped.has(index)}>
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
                        <code>{step.value ?? '—'}</code>
                      </td>
                      {phase === 'review' && (
                        <td className="num">
                          <button
                            className="quiet small"
                            onClick={() =>
                              setDropped((previous) => {
                                const next = new Set(previous);
                                if (next.has(index)) next.delete(index);
                                else next.add(index);
                                return next;
                              })
                            }
                          >
                            {dropped.has(index) ? 'Geri al' : 'Çıkar'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {phase === 'review' && candidates.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Koşular arasında değişen değerler</h2>
            <span className="readout">değişkene dönüşür</span>
          </div>
          <div className="panel-body">
            <p className="empty" style={{ marginBottom: '0.8rem' }}>
              İşaretlenen değerler değişkene dönüşür; böylece aynı test farklı verilerle koşabilir. İşareti
              kaldırırsanız kaydedilen değer sabit kalır.
            </p>
            <table className="grid">
              <thead>
                <tr>
                  <th>Değişken yap</th>
                  <th>Alan</th>
                  <th>Kaydedilen</th>
                  <th>Değişken adı</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => {
                  const choice = choices[candidate.stepIndex];
                  const droppedStep = dropped.has(candidate.stepIndex);
                  return (
                    <tr key={candidate.stepIndex} data-disabled={droppedStep}>
                      <td>
                        <input
                          type="checkbox"
                          checked={choice?.parameterise ?? false}
                          disabled={candidate.mandatory || droppedStep}
                          aria-label={`${candidate.suggestedKey} değişken olsun`}
                          onChange={(event) =>
                            setChoices((previous) => ({
                              ...previous,
                              [candidate.stepIndex]: {
                                stepIndex: candidate.stepIndex,
                                parameterise: event.target.checked,
                                key: previous[candidate.stepIndex]?.key ?? candidate.suggestedKey,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <code className="target">{candidate.label}</code>
                      </td>
                      <td>
                        <code>{candidate.recordedValue || '—'}</code>
                        {candidate.mandatory && (
                          <span className="tag" data-status="file" style={{ marginLeft: '0.4rem' }}>
                            yalnızca dosya adı
                          </span>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          value={choice?.key ?? candidate.suggestedKey}
                          disabled={droppedStep || !(choice?.parameterise ?? false)}
                          aria-label={`${candidate.label} için değişken adı`}
                          style={{ minWidth: '10rem' }}
                          onChange={(event) =>
                            setChoices((previous) => ({
                              ...previous,
                              [candidate.stepIndex]: {
                                stepIndex: candidate.stepIndex,
                                parameterise: previous[candidate.stepIndex]?.parameterise ?? true,
                                key: event.target.value,
                              },
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="notice">
              Dosya yükleme adımında tarayıcı yalnızca dosya adını verir, tam yolu vermez. Bu yüzden her zaman
              dosya değişkenine dönüşür; gerçek dosyayı Phase 3'te veri setine yükleyeceksiniz.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
