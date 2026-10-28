import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Star,
  Volume2,
  X,
} from "lucide-react";
import {
  api,
  go,
  posName,
  sourceName,
  type Exam,
  type Notebook,
  type Study,
} from "./api";
import { Empty, Failure, Loading, PageTitle, useAction, useLoad } from "./ui";

function SpeechButton({ word }: { word: string }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    { toast } = useAction();
  useEffect(() => {
    if (!window.speechSynthesis) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, []);
  function speak() {
    const voice = (
      voices.length ? voices : window.speechSynthesis?.getVoices() || []
    ).find((v) => /^en[-_]/i.test(v.lang) || v.lang === "en");
    if (!window.speechSynthesis || !voice) {
      toast("이 환경에서는 발음을 지원하지 않습니다", true);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.85;
    utterance.onerror = () =>
      toast("이 환경에서는 발음을 지원하지 않습니다", true);
    window.speechSynthesis.speak(utterance);
  }
  return (
    <button className="speaker" aria-label="영어 발음 듣기" onClick={speak}>
      <Volume2 size={21} />
    </button>
  );
}

export function StudyPage({ id }: { id: string }) {
  const session = useLoad<Study>(`/study/${id}`),
    { busy, run } = useAction(),
    [done, setDone] = useState(false);
  const s = session.data;
  const progress = (position: number, flipped: boolean) =>
    run(async () => {
      const updated = await api<Study>(`/study/${id}`, "PATCH", {
        position,
        flipped,
      });
      session.setData(updated);
    });
  const flip = () => {
    if (s && !busy && !done) progress(s.position, !s.flipped);
  };
  const next = () => {
    if (!s || busy || done) return;
    if (s.position === s.cards.length - 1) setDone(true);
    else progress(s.position + 1, false);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.closest(
          'input,textarea,select,button,[contenteditable="true"],dialog',
        ) ||
        e.repeat
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        flip();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
      if (e.key === "ArrowLeft" && s && s.position > 0 && !busy) {
        e.preventDefault();
        progress(s.position - 1, false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (session.loading) return <Loading />;
  if (session.error)
    return <Failure message={session.error} retry={session.refresh} />;
  if (!s) return null;
  const c = s.cards[s.position];
  const restart = () =>
    run(async () => {
      const result = await api<Study>("/study", "POST", {
        source: s.source,
        count: s.requested,
      });
      localStorage.setItem("lastStudy", result.id);
      go(`study/${result.id}`);
    });
  return (
    <>
      <PageTitle
        eyebrow="FLASHCARD STUDY"
        title={done ? "오늘의 학습을 마쳤어요!" : "한 장씩, 기억 속으로."}
        description={`${sourceName(s.source)} · ${s.cards.length}개의 카드`}
      >
        <button
          className="secondary"
          onClick={() =>
            go(
              s.source.kind === "notebook"
                ? `notebooks/${s.source.notebook_id}`
                : s.source.kind === "saved"
                  ? "saved"
                  : "levels",
            )
          }
        >
          목록으로
        </button>
      </PageTitle>
      {s.requested !== "all" && s.cards.length < Number(s.requested) && (
        <div className="notice">
          요청한 {s.requested}개보다 카드가 적어 {s.cards.length}개로
          학습합니다.
        </div>
      )}
      {s.cards.some((c) => c.classification_kind === "manual_demo") && (
        <p className="demo-label">
          시연용 수동 분류 데이터가 포함되어 있습니다.
        </p>
      )}
      {done ? (
        <div className="completion">
          <div className="completion-icon">
            <Check size={36} />
          </div>
          <h2>{s.cards.length}개의 단어를 만나 보았어요.</h2>
          <p>필요할 때 다시 꺼내 보면 더 오래 기억할 수 있어요.</p>
          <button className="primary" disabled={busy} onClick={restart}>
            <RotateCcw size={18} />
            다시 학습
          </button>
          <button className="secondary" onClick={() => go("saved")}>
            저장한 단어 보기
          </button>
        </div>
      ) : (
        <div className="study-wrap">
          <div className="study-progress">
            <span>학습 진행</span>
            <strong>
              {s.position + 1}
              <span> / {s.cards.length}</span>
            </strong>
          </div>
          <div className="progress-track">
            <span
              style={{ width: `${((s.position + 1) / s.cards.length) * 100}%` }}
            />
          </div>
          <div className={`flashcard ${s.flipped ? "flipped" : ""}`}>
            <div className="flashcard-top">
              <span>{s.flipped ? "MEANING" : "ENGLISH WORD"}</span>
              <SpeechButton word={c.word} />
            </div>
            <button
              className="card-face"
              aria-label={s.flipped ? "영어 단어 보기" : "카드 뒤집기"}
              disabled={busy}
              onClick={flip}
            >
              {s.flipped ? (
                <>
                  <span className="pos">{posName(c.pos)}</span>
                  <h2>{c.definition}</h2>
                  {c.notes && <p>{c.notes}</p>}
                  <span className="card-hint">클릭해서 영어 단어 보기</span>
                </>
              ) : (
                <>
                  <h2 lang="en">{c.word}</h2>
                  <span className="card-hint">
                    클릭해서 뜻 보기 <RotateCcw size={14} />
                  </span>
                </>
              )}
            </button>
            <div className="flashcard-bottom">
              <span>{String(s.position + 1).padStart(2, "0")}</span>
              <span>단어의 숲</span>
            </div>
          </div>
          <div className="study-flags">
            {c.deleted ? (
              <p className="muted">
                삭제된 카드의 학습 기록입니다. 저장할 수 없어요.
              </p>
            ) : (
              <>
                <button
                  className={`flag-btn ${c.important ? "on" : ""}`}
                  aria-pressed={c.important}
                  disabled={busy}
                  onClick={() =>
                    run(
                      async () => {
                        const saved = await api<{
                          important: boolean;
                          forgotten: boolean;
                        }>(`/cards/${c.id}/saved`, "PUT", {
                          important: !c.important,
                          forgotten: c.forgotten,
                        });
                        session.setData({
                          ...s,
                          cards: s.cards.map((card) =>
                            card.id === c.id ? { ...card, ...saved } : card,
                          ),
                        });
                      },
                      c.important
                        ? "중요 표시를 해제했습니다."
                        : "중요한 단어로 저장했습니다.",
                    )
                  }
                >
                  <Star size={18} />
                  중요
                </button>
                <button
                  className={`flag-btn ${c.forgotten ? "forgotten-on" : ""}`}
                  aria-pressed={c.forgotten}
                  disabled={busy}
                  onClick={() =>
                    run(
                      async () => {
                        const saved = await api<{
                          important: boolean;
                          forgotten: boolean;
                        }>(`/cards/${c.id}/saved`, "PUT", {
                          important: c.important,
                          forgotten: !c.forgotten,
                        });
                        session.setData({
                          ...s,
                          cards: s.cards.map((card) =>
                            card.id === c.id ? { ...card, ...saved } : card,
                          ),
                        });
                      },
                      c.forgotten
                        ? "잊음 표시를 해제했습니다."
                        : "잊은 단어로 저장했습니다.",
                    )
                  }
                >
                  <Bookmark size={18} />
                  잊음
                </button>
              </>
            )}
          </div>
          <div className="study-controls">
            <button
              className="secondary"
              disabled={busy || s.position === 0}
              onClick={() => progress(s.position - 1, false)}
            >
              <ChevronLeft size={18} />
              이전
            </button>
            <button className="secondary" disabled={busy} onClick={flip}>
              <RotateCcw size={17} />
              {s.flipped ? "단어 보기" : "뜻 보기"}
            </button>
            <button className="primary" disabled={busy} onClick={next}>
              {s.position === s.cards.length - 1 ? "학습 완료" : "다음 카드"}
              <ChevronRight size={18} />
            </button>
          </div>
          <p className="keyboard-note">
            PC 단축키: Space 뜻 보기 · ← 이전 · → 다음
          </p>
          <button className="text-btn" disabled={busy} onClick={restart}>
            <RotateCcw size={15} />새 순서로 다시 학습
          </button>
        </div>
      )}
    </>
  );
}

type History = {
  id: string;
  submitted: boolean;
  total: number;
  accuracy: number | null;
  created_at: string;
};
export function ExamSetup() {
  const books = useLoad<Notebook[]>("/notebooks"),
    levels =
      useLoad<{ level: number; demo: number; ai: number; total: number }[]>(
        "/levels",
      ),
    history = useLoad<History[]>("/exams");
  const [kind, setKind] = useState("notebook"),
    [bookId, setBookId] = useState(""),
    [level, setLevel] = useState(1),
    [category, setCategory] = useState("all"),
    [count, setCount] = useState("10"),
    { busy, run } = useAction();
  const chosen = bookId || books.data?.[0]?.id.toString() || "";
  const available =
    kind === "notebook"
      ? books.data?.find((b) => b.id === Number(chosen))?.card_count || 0
      : levels.data?.find((l) => l.level === level)?.[
          category === "demo" ? "demo" : category === "ai" ? "ai" : "total"
        ] || 0;
  return (
    <>
      <PageTitle
        eyebrow="CHECK YOUR LEARNING"
        title="시험 보기"
        description="뜻을 보고 영어 단어를 입력해 보세요. 채점은 제출한 뒤 이루어집니다."
      />
      <div className="exam-layout">
        <form
          className="panel exam-settings"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const result = await api<Exam>("/exams", "POST", {
                source:
                  kind === "notebook"
                    ? { kind, notebook_id: Number(chosen) }
                    : { kind, level, category },
                count,
              });
              localStorage.setItem("lastExam", result.id);
              go(`exams/${result.id}`);
            });
          }}
        >
          <h2>시험 설정</h2>
          <label>시험 출처</label>
          <div className="tabs source-tabs">
            <button
              type="button"
              className={kind === "notebook" ? "selected" : ""}
              onClick={() => setKind("notebook")}
            >
              내 단어장
            </button>
            <button
              type="button"
              className={kind === "level" ? "selected" : ""}
              onClick={() => setKind("level")}
            >
              레벨별 공용 단어
            </button>
          </div>
          {kind === "notebook" ? (
            books.loading ? (
              <Loading />
            ) : books.error ? (
              <Failure message={books.error} retry={books.refresh} />
            ) : books.data?.length ? (
              <label>
                단어장 선택
                <select
                  value={chosen}
                  onChange={(e) => setBookId(e.target.value)}
                >
                  {books.data.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.card_count}개)
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="notice">
                단어장이 없습니다.{" "}
                <a href="#/notebooks">첫 단어장을 만들어 주세요.</a>
              </div>
            )
          ) : (
            <>
              <label>
                레벨
                <select
                  aria-label="레벨"
                  value={level}
                  onChange={(e) => setLevel(Number(e.target.value))}
                >
                  <option value={1}>레벨 1 · 기초</option>
                  <option value={2}>레벨 2 · 중급</option>
                  <option value={3}>레벨 3 · 고급</option>
                </select>
              </label>
              <label>
                데이터 구분
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="all">전체 (시연 + AI 분류)</option>
                  <option value="demo">시연용 수동 분류</option>
                  <option value="ai">AI 분류 (자동·검수 완료)</option>
                </select>
              </label>
              {levels.error && (
                <Failure message={levels.error} retry={levels.refresh} />
              )}
              {category !== "ai" && (
                <div className="notice">
                  시연용 수동 분류 데이터가 포함됩니다.
                </div>
              )}
            </>
          )}
          <label>
            문항 수
            <select value={count} onChange={(e) => setCount(e.target.value)}>
              <option value="10">10개</option>
              <option value="20">20개</option>
              <option value="all">전체</option>
            </select>
          </label>
          <p className="muted">
            {available === 0
              ? "출제할 카드가 없습니다."
              : count !== "all" && Number(count) > available
                ? `카드가 ${available}개이므로 ${available}문항을 출제합니다.`
                : `출제 가능한 카드 ${available}개`}
          </p>
          <button className="primary wide" disabled={busy || available === 0}>
            시험 시작 <ArrowRight size={18} />
          </button>
        </form>
        <aside className="exam-guide">
          <span className="eyebrow">HOW IT WORKS</span>
          <h2>
            아는 만큼,
            <br />
            차분하게 확인해요.
          </h2>
          <ol>
            <li>
              <span>01</span>한국어 또는 영어 뜻을 확인하세요.
            </li>
            <li>
              <span>02</span>떠오르는 영어 단어를 입력하세요.
            </li>
            <li>
              <span>03</span>제출 후 결과와 정답을 확인하세요.
            </li>
          </ol>
          <p>
            대소문자와 앞뒤·연속 공백은 무시합니다.
            <br />
            다른 단어는 허용 정답으로 등록한 경우에만 인정합니다.
          </p>
        </aside>
      </div>
      <div className="section-heading">
        <h2>최근 시험</h2>
        <span>최대 20회</span>
      </div>
      {history.loading ? (
        <Loading />
      ) : history.error ? (
        <Failure message={history.error} retry={history.refresh} />
      ) : history.data?.length ? (
        <div className="history-list">
          {history.data.map((h) => (
            <button key={h.id} onClick={() => go(`exams/${h.id}`)}>
              <div>
                <strong>
                  {h.submitted ? "완료한 시험" : "진행 중인 시험"}
                </strong>
                <span>
                  {new Date(h.created_at).toLocaleString("ko-KR")} · {h.total}
                  문항
                </span>
              </div>
              <span>
                {h.submitted ? `${h.accuracy}%` : "이어서 풀기"}{" "}
                <ChevronRight size={16} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">첫 시험을 마치면 여기에 기록됩니다.</p>
      )}
    </>
  );
}

export function ExamPage({ id }: { id: string }) {
  const exam = useLoad<Exam>(`/exams/${id}`);
  if (exam.loading) return <Loading />;
  if (exam.error) return <Failure message={exam.error} retry={exam.refresh} />;
  if (!exam.data) return null;
  return exam.data.result ? (
    <ExamResult exam={exam.data} />
  ) : (
    <AnswerExam key={id} initial={exam.data} onSubmitted={exam.setData} />
  );
}

function AnswerExam({
  initial,
  onSubmitted,
}: {
  initial: Exam;
  onSubmitted: (e: Exam) => void;
}) {
  const key = `examDraft:${initial.id}`;
  const readLocal = () => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value.answers === "object" ? value : null;
    } catch {
      return null;
    }
  };
  const [answers, setAnswers] = useState<Record<string, string>>(
      () => readLocal()?.answers || initial.answers,
    ),
    [position, setPosition] = useState<number>(() =>
      Math.min(
        readLocal()?.position ?? initial.position,
        initial.questions.length - 1,
      ),
    ),
    [saveStatus, setSaveStatus] = useState("저장된 답안"),
    { busy, run } = useAction();
  const queue = useRef<Promise<unknown>>(Promise.resolve()),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, [position]);
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify({ answers, position }));
    setSaveStatus("저장 중…");
    let active = true;
    const timer = setTimeout(() => {
      queue.current = queue.current
        .catch(() => {})
        .then(() =>
          api<Exam>(`/exams/${initial.id}/answers`, "PUT", {
            answers,
            position,
          }),
        )
        .then(() => {
          if (active) setSaveStatus("서버에 저장됨");
        })
        .catch(() => {
          if (active)
            setSaveStatus("서버 저장 실패 · 이 브라우저에 임시 보관됨");
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [answers, position, key, initial.id]);
  const q = initial.questions[position],
    answered = Object.values(answers).filter((v) => v.trim()).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (
      answered < initial.questions.length &&
      !window.confirm(
        `${initial.questions.length - answered}개 답안이 비어 있습니다. 제출할까요?`,
      )
    )
      return;
    run(async () => {
      await queue.current;
      const result = await api<Exam>(`/exams/${initial.id}/submit`, "POST", {
        answers,
        position,
      });
      localStorage.removeItem(key);
      onSubmitted(result);
    }, "시험을 채점했습니다.");
  };
  return (
    <>
      <PageTitle
        eyebrow="WRITE YOUR ANSWER"
        title="어떤 단어일까요?"
        description={`${sourceName(initial.source)} · 뜻을 보고 영어 단어 입력`}
      >
        <button className="secondary" onClick={() => go("exams")}>
          설정으로
        </button>
      </PageTitle>
      {initial.requested !== "all" &&
        initial.questions.length < Number(initial.requested) && (
          <div className="notice">
            카드가 부족해 {initial.questions.length}문항으로 시험합니다.
          </div>
        )}
      {initial.questions.some(
        (q) => q.classification_kind === "manual_demo",
      ) && (
        <p className="demo-label">
          시연용 수동 분류 데이터가 포함된 시험입니다.
        </p>
      )}
      <form onSubmit={submit} className="answer-wrap">
        <div className="study-progress">
          <span>
            문항 {position + 1} / {initial.questions.length}
          </span>
          <span>{answered}개 답안 입력</span>
        </div>
        <div className="progress-track">
          <span
            style={{ width: `${(answered / initial.questions.length) * 100}%` }}
          />
        </div>
        <div className="question-card">
          <span className="eyebrow">MEANING</span>
          <span className="pos">{posName(q.pos)}</span>
          <h2>{q.definition}</h2>
          <label>
            영어 정답
            <input
              ref={input}
              lang="en"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              maxLength={300}
              placeholder="영어 단어를 입력하세요"
              value={answers[q.id] || ""}
              disabled={busy}
              onChange={(e) =>
                setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  position < initial.questions.length - 1
                ) {
                  e.preventDefault();
                  setPosition(position + 1);
                }
              }}
            />
          </label>
          <p
            className={`save-status ${saveStatus.includes("실패") ? "danger" : ""}`}
            role="status"
          >
            {saveStatus}
          </p>
        </div>
        <div className="study-controls">
          <button
            type="button"
            className="secondary"
            disabled={busy || position === 0}
            onClick={() => setPosition(position - 1)}
          >
            <ChevronLeft size={18} />
            이전 문항
          </button>
          {position < initial.questions.length - 1 ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => setPosition(position + 1)}
            >
              다음 문항
              <ChevronRight size={18} />
            </button>
          ) : (
            <button className="primary" disabled={busy}>
              답안 제출
              <Check size={18} />
            </button>
          )}
        </div>
        <div className="question-nav">
          {initial.questions.map((q, i) => (
            <button
              type="button"
              key={q.id}
              aria-label={`${i + 1}번 문항`}
              aria-current={position === i ? "step" : undefined}
              disabled={busy}
              className={`${position === i ? "current" : ""} ${answers[q.id]?.trim() ? "answered" : ""}`}
              onClick={() => setPosition(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <p className="keyboard-note">
          답안과 문항 위치가 저장됩니다. 정답은 제출 후 확인할 수 있어요.
        </p>
      </form>
    </>
  );
}

function ExamResult({ exam }: { exam: Exam }) {
  const { busy, run, toast } = useAction(),
    r = exam.result!;
  const wrongSource = { kind: "wrong", exam_id: exam.id };
  return (
    <>
      <button className="text-btn back" onClick={() => go("exams")}>
        <ArrowLeft size={16} />
        시험 목록
      </button>
      <PageTitle
        eyebrow="YOUR RESULTS"
        title="배움을 확인했어요."
        description="틀린 단어도 다음 배움의 좋은 시작이 됩니다."
      />
      <div className="result-summary">
        <div className="score-circle">
          <strong>
            {r.accuracy}
            <small>%</small>
          </strong>
          <span>정답률</span>
        </div>
        <div className="result-counts">
          <div>
            <span>전체 문항</span>
            <strong>{r.total}</strong>
          </div>
          <div>
            <span>정답</span>
            <strong className="green-text">{r.correct}</strong>
          </div>
          <div>
            <span>오답</span>
            <strong className="rose-text">{r.wrong}</strong>
          </div>
        </div>
      </div>
      {r.wrong > 0 ? (
        <div className="result-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const e = await api<Exam>("/exams", "POST", {
                  source: wrongSource,
                  count: "all",
                });
                localStorage.setItem("lastExam", e.id);
                go(`exams/${e.id}`);
              })
            }
          >
            <RotateCcw size={18} />
            오답만 재시험
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const s = await api<Study>("/study", "POST", {
                  source: wrongSource,
                  count: "all",
                });
                localStorage.setItem("lastStudy", s.id);
                go(`study/${s.id}`);
              })
            }
          >
            오답 카드 학습
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const res = await api<{ saved: number }>(
                  `/exams/${exam.id}/save-wrong`,
                  "POST",
                );
                toast(
                  `${res.saved}개 오답을 잊음으로 저장했습니다.${res.saved < r.wrong ? " 삭제된 카드는 제외했습니다." : ""}`,
                );
              })
            }
          >
            <Bookmark size={18} />
            오답을 잊음으로 저장
          </button>
        </div>
      ) : (
        <div className="info-strip">
          <Check size={19} />
          <p>모든 문제를 맞혔어요. 다른 단어장이나 레벨로 도전해 보세요.</p>
        </div>
      )}
      <div className="section-heading">
        <h2>문항별 결과</h2>
        <span>등록된 허용 정답만 인정</span>
      </div>
      <div className="result-list">
        {r.items.map((item, i) => (
          <div
            className={`result-row ${item.correct ? "correct" : "incorrect"}`}
            key={item.question_id}
          >
            <span className="result-marker">
              {item.correct ? <Check size={18} /> : <X size={18} />}
            </span>
            <div>
              <span className="result-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <strong>{item.definition}</strong>
              <div className="answer-comparison">
                <span>
                  내 답 <b>{item.answer || "(미입력)"}</b>
                </span>
                <span>
                  정답 <b lang="en">{item.word}</b>
                </span>
                {item.accepted_answers.length > 0 && (
                  <span>허용 정답 {item.accepted_answers.join(", ")}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="setup-note">
        시험은 시작할 때의 카드 내용으로 채점합니다. 이후 카드를 수정해도 기존
        결과는 유지됩니다.
      </p>
    </>
  );
}
