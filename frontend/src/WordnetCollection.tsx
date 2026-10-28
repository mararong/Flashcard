import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useAction } from "./ui";

type Job = {
  id: string;
  status: string;
  phase: string;
  current_word: string | null;
  requested: number;
  collected: number;
  evaluated: number;
  total_groups: number;
  published: number;
  failed: number;
  frequency_review: number;
  error: string | null;
};
type Collection = {
  model: string | null;
  counts: { words: number; senses: number; classified: number };
  job: Job | null;
};
const isActive = (job: Job | null) =>
  job?.status === "queued" || job?.status === "running";

export function WordnetCollection({ onComplete }: { onComplete: () => void }) {
  const [state, setState] = useState<Collection | null>(null);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(10);
  const { busy, run } = useAction();
  const completed = useRef(onComplete);
  completed.current = onComplete;

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    let previous: Job | null = null;
    let previousCount: number | null = null;
    async function poll() {
      let active = false;
      try {
        const next = await api<Collection>("/dictionary/collection");
        if (!mounted) return;
        setState(next);
        setError("");
        if ((isActive(previous) && !isActive(next.job)) ||
            (previousCount !== null && previousCount !== next.counts.classified)) completed.current();
        previous = next.job;
        previousCount = next.counts.classified;
        active = isActive(next.job);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "수집 상태를 불러오지 못했습니다.");
      }
      if (mounted) timer = setTimeout(poll, active ? 2000 : 5000);
    }
    poll();
    return () => { mounted = false; clearTimeout(timer); };
  }, []);

  const job = state?.job || null;
  const active = isActive(job);
  return (
    <section className="collection-panel" aria-label="WordNet 자동 수집">
      <div>
        <h3>WordNet 단어 자동 수집</h3>
        <p className="muted">
          자주 쓰는 단어부터 드문 단어까지 고르게 수집합니다. 빈도·추상성·의미 복잡도·철자와 발음·사용 맥락을 평가해 레벨을 정합니다.
        </p>
        {state && <p className="muted">수집 {state.counts.words}단어 · {state.counts.senses}개 뜻 · 난이도 지정 {state.counts.classified}개 뜻</p>}
      </div>
      <div className="collection-actions">
        <label>수집 단어 수
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} disabled={active || busy}>
            {[10, 30, 100, 500].map(n => <option value={n} key={n}>{n}단어</option>)}
          </select>
        </label>
        <button className="primary" disabled={!state?.model || active || busy} onClick={() => run(async () => {
          await api("/dictionary/collection", "POST", { limit });
          const next = await api<Collection>("/dictionary/collection");
          setState(next);
          if (!isActive(next.job)) completed.current();
        })}>
          {active ? "수집·분류 중…" : "자동 수집·난이도 분류"}
        </button>
      </div>
      {!state?.model && state && <p className="notice">자동 난이도 분류를 위해 Ollama 모델 연결이 필요합니다.</p>}
      {error && <p role="alert" className="notice">{error}</p>}
      {job && <div className="collection-progress" role="status" aria-live="polite">
        {active ? <>
          <strong>{job.phase}{job.current_word ? ` · ${job.current_word}` : ""}</strong>
          <p>단어 {job.collected}/{job.requested} · 품사별 평가 {job.evaluated}/{job.total_groups} · 학습 카드 {job.published}개</p>
          <p className="muted">처음에는 사전 준비에 시간이 걸릴 수 있습니다. 이 화면을 나가도 작업은 계속됩니다.</p>
        </> : <>
          <strong>{job.status === "complete" ? "수집 완료" : job.status === "partial" ? "일부 평가 재시도 필요" : job.status === "interrupted" ? "이전 수집 중단" : "수집 실패"}</strong>
          <p>{job.collected}단어 수집 · {job.published}개 학습 카드 · 평가 실패 {job.failed}개 · 빈도 확인 필요 {job.frequency_review}개</p>
          {job.error && <p>{job.error}</p>}
        </>}
      </div>}
    </section>
  );
}
