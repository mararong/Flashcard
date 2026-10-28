import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Check,
  Edit3,
  Layers,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { api, go, posName, type Card, type Notebook, type Source } from "./api";
import { WordnetCollection } from "./WordnetCollection";
import {
  Empty,
  Failure,
  Loading,
  Modal,
  PageTitle,
  StartDialog,
  useAction,
  useLoad,
} from "./ui";

export function NotebooksPage() {
  const books = useLoad<Notebook[]>("/notebooks"),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    { busy, run } = useAction();
  const create = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const b = await api<Notebook>("/notebooks", "POST", { name });
      setCreating(false);
      go(`notebooks/${b.id}`);
    }, "단어장을 만들었습니다.");
  };
  return (
    <>
      <PageTitle
        eyebrow="MY COLLECTION"
        title="내 단어장"
        description="기억하고 싶은 단어를 나만의 뜻과 함께 모아 보세요."
      >
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus size={18} />새 단어장
        </button>
      </PageTitle>
      {books.loading ? (
        <Loading />
      ) : books.error ? (
        <Failure message={books.error} retry={books.refresh} />
      ) : books.data!.length === 0 ? (
        <Empty
          title="첫 단어장을 만들어 볼까요?"
          description="시험 공부, 좋아하는 책, 일상 표현… 원하는 주제로 시작하세요."
        >
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={18} />
            단어장 만들기
          </button>
        </Empty>
      ) : (
        <div className="notebook-grid">
          {books.data!.map((b, i) => (
            <button
              className="notebook-tile"
              key={b.id}
              onClick={() => go(`notebooks/${b.id}`)}
            >
              <div className={`book-cover color-${i % 3}`}>
                <BookOpen size={33} />
                <span>MY VOCABULARY</span>
              </div>
              <h3>{b.name}</h3>
              <div>
                <span>{b.card_count}개 카드</span>
                <ArrowRight size={18} />
              </div>
            </button>
          ))}
        </div>
      )}
      {creating && (
        <Modal title="새 단어장 만들기" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            <label>
              단어장 이름
              <input
                autoFocus
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 매일 만나는 영어"
              />
            </label>
            <button className="primary wide" disabled={busy}>
              만들기
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function NotebookPage({ id }: { id: number }) {
  const [query, setQuery] = useState(""),
    book = useLoad<Notebook>(`/notebooks/${id}?q=${encodeURIComponent(query)}`),
    [add, setAdd] = useState(false),
    [edit, setEdit] = useState<Card | null>(null),
    [rename, setRename] = useState(false),
    [name, setName] = useState(""),
    [study, setStudy] = useState(false),
    { busy, run } = useAction();
  if (book.loading && !book.data) return <Loading />;
  if (book.error) return <Failure message={book.error} retry={book.refresh} />;
  if (!book.data) return null;
  const b = book.data;
  return (
    <>
      <button className="text-btn back" onClick={() => go("notebooks")}>
        <ArrowLeft size={16} />
        단어장 목록
      </button>
      <PageTitle
        eyebrow="MY VOCABULARY"
        title={b.name}
        description={`${b.card_count}개의 카드 · 나의 뜻으로 기억하는 단어`}
      >
        <button
          className="icon-btn"
          title="이름 수정"
          aria-label="단어장 이름 수정"
          onClick={() => {
            setName(b.name);
            setRename(true);
          }}
        >
          <Edit3 size={19} />
        </button>
        <button
          className="icon-btn danger"
          aria-label="단어장 삭제"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                `“${b.name}” 단어장을 삭제할까요? 별도로 저장한 카드는 유지됩니다.`,
              )
            )
              run(async () => {
                await api(`/notebooks/${id}`, "DELETE");
                go("notebooks");
              }, "단어장을 삭제했습니다.");
          }}
        >
          <Trash2 size={19} />
        </button>
        <button
          className="secondary"
          disabled={!b.card_count}
          onClick={() => setStudy(true)}
        >
          <Layers size={18} />
          학습하기
        </button>
        <button className="primary" onClick={() => setAdd(true)}>
          <Plus size={18} />
          단어 등록
        </button>
      </PageTitle>
      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} />
        <span className="muted">
          같은 단어, 다른 뜻은 별도 카드로 등록할 수 있어요.
        </span>
      </div>
      {book.loading ? (
        <Loading />
      ) : b.cards?.length ? (
        <div className="word-list">
          {b.cards.map((c) => (
            <WordRow key={c.id} card={c}>
              <button
                className="icon-btn"
                aria-label={`${c.word} 수정`}
                onClick={() => setEdit(c)}
              >
                <Edit3 size={17} />
              </button>
              <button
                className="icon-btn danger"
                aria-label={`${c.word} 삭제`}
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "카드 자체를 삭제하면 저장 목록에서도 제거됩니다. 삭제할까요?",
                    )
                  )
                    run(async () => {
                      await api(`/cards/${c.id}`, "DELETE");
                      book.refresh();
                    }, "카드를 삭제했습니다.");
                }}
              >
                <Trash2 size={17} />
              </button>
            </WordRow>
          ))}
        </div>
      ) : (
        <Empty
          title={query ? "검색 결과가 없어요" : "첫 단어를 등록해 보세요"}
          description={
            query
              ? "다른 검색어로 찾아보세요."
              : "영어 단어만 입력해 사전을 조회하거나, 단어와 뜻을 직접 입력할 수 있어요."
          }
        >
          {!query && (
            <button className="primary" onClick={() => setAdd(true)}>
              <Plus size={18} />
              단어 등록
            </button>
          )}
        </Empty>
      )}
      {add && (
        <AddCards
          notebookId={id}
          onClose={() => setAdd(false)}
          onSaved={() => {
            setAdd(false);
            book.refresh();
          }}
        />
      )}
      {edit && (
        <EditCard
          card={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            book.refresh();
          }}
        />
      )}
      {rename && (
        <Modal title="단어장 이름 수정" onClose={() => setRename(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(`/notebooks/${id}`, "PATCH", { name });
                setRename(false);
                book.refresh();
              }, "이름을 수정했습니다.");
            }}
          >
            <label>
              단어장 이름
              <input
                autoFocus
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="primary wide" disabled={busy}>
              저장
            </button>
          </form>
        </Modal>
      )}
      {study && (
        <StartDialog
          source={{ kind: "notebook", notebook_id: id }}
          available={b.card_count}
          onClose={() => setStudy(false)}
        />
      )}
    </>
  );
}

export function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="search">
      <Search size={18} />
      <input
        aria-label="단어 검색"
        placeholder="단어 또는 뜻 검색"
        maxLength={200}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
function WordRow({
  card,
  children,
}: {
  card: Card;
  children?: React.ReactNode;
}) {
  return (
    <div className="word-row" data-card-id={card.id}>
      <div className="word-main">
        <strong lang="en">{card.word}</strong>
        <span className="pos">{posName(card.pos)}</span>
        {card.important && <Star size={15} className="gold" />}
        {card.forgotten && <Bookmark size={15} className="rose-text" />}
      </div>
      <div className="word-definition">
        {card.definition}
        {card.notes && <small>{card.notes}</small>}
      </div>
      <div className="word-actions">{children}</div>
    </div>
  );
}

type Draft = {
  word: string;
  definition: string;
  pos: string;
  notes: string;
  accepted_answers: string[];
  dictionary_id?: number;
};
const blank = (): Draft => ({
  word: "",
  definition: "",
  pos: "",
  notes: "",
  accepted_answers: [],
});
function Fields({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: (v: Draft) => void;
}) {
  return (
    <>
      <div className="form-grid">
        <label>
          영어 단어
          <input
            required
            maxLength={150}
            value={draft.word}
            onChange={(e) => setDraft({ ...draft, word: e.target.value })}
            placeholder="예: grow"
          />
        </label>
        <label>
          품사
          <select
            aria-label="품사"
            value={draft.pos}
            onChange={(e) => setDraft({ ...draft, pos: e.target.value })}
          >
            <option value="">미지정</option>
            <option value="n">명사</option>
            <option value="v">동사</option>
            <option value="a">형용사</option>
            <option value="s">형용사 (위성형)</option>
            <option value="r">부사</option>
            {draft.pos && !["n", "v", "a", "s", "r"].includes(draft.pos) && (
              <option value={draft.pos}>{draft.pos}</option>
            )}
          </select>
        </label>
      </div>
      <label>
        뜻
        <textarea
          aria-label="뜻"
          required
          maxLength={3000}
          value={draft.definition}
          onChange={(e) => setDraft({ ...draft, definition: e.target.value })}
          placeholder="한국어 또는 영어 정의"
          rows={2}
        />
      </label>
      <label>
        추가 설명
        <textarea
          maxLength={3000}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="예문이나 기억할 내용을 적어 보세요 (선택)"
          rows={2}
        />
      </label>
      <label>
        허용 정답 <span className="muted">선택 · 한 줄에 하나</span>
        <textarea
          value={draft.accepted_answers.join("\n")}
          onChange={(e) =>
            setDraft({ ...draft, accepted_answers: e.target.value.split("\n") })
          }
          rows={2}
          placeholder="시험에서 정답으로 인정할 다른 표기"
        />
      </label>
    </>
  );
}

function EditCard({
  card,
  onClose,
  onSaved,
}: {
  card: Card;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({ ...card }),
    { busy, run } = useAction();
  return (
    <Modal title="카드 수정" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api(`/cards/${card.id}`, "PATCH", draft);
            onSaved();
          }, "카드를 수정했습니다.");
        }}
      >
        <Fields draft={draft} setDraft={setDraft} />
        <button className="primary wide" disabled={busy}>
          수정 저장
        </button>
      </form>
    </Modal>
  );
}

type Candidate = {
  id: number;
  pos: string;
  definition: string;
  source: string;
};
function AddCards({
  notebookId,
  onClose,
  onSaved,
}: {
  notebookId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState("manual"),
    [draft, setDraft] = useState<Draft>(blank),
    [text, setText] = useState(""),
    [lookups, setLookups] = useState<
      { word: string; candidates: Candidate[] }[] | null
    >(null),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [wordnet, setWordnet] = useState(true),
    { busy, run, toast } = useAction();
  const save = async (cards: Draft[]) => {
    const result = await api<{ added: number; skipped: number }>(
      `/notebooks/${notebookId}/cards`,
      "POST",
      { cards },
    );
    toast(
      `${result.added}개 등록${result.skipped ? ` · 중복 ${result.skipped}개 제외` : ""}`,
    );
    onSaved();
  };
  return (
    <Modal title="단어 등록" onClose={onClose}>
      <div className="tabs">
        {[
          ["manual", "직접 입력"],
          ["batch", "여러 단어"],
          ["lookup", "영어만 입력"],
        ].map(([v, label]) => (
          <button
            key={v}
            className={mode === v ? "selected" : ""}
            onClick={() => setMode(v)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "manual" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => save([draft]));
          }}
        >
          <Fields draft={draft} setDraft={setDraft} />
          <button className="primary wide" disabled={busy}>
            카드 등록
          </button>
        </form>
      ) : mode === "batch" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const lines = text.split(/\r?\n/).filter((l) => l.trim());
              if (!lines.length) throw new Error("단어를 입력해 주세요.");
              const cards = lines.map((line, i) => {
                const tab = line.indexOf("\t");
                if (tab < 1 || !line.slice(tab + 1).trim())
                  throw new Error(
                    `${i + 1}번째 줄을 영어 단어[TAB]뜻 형식으로 입력해 주세요.`,
                  );
                return {
                  ...blank(),
                  word: line.slice(0, tab).trim(),
                  definition: line.slice(tab + 1).trim(),
                };
              });
              await save(cards);
            });
          }}
        >
          <p className="muted">
            엑셀의 단어·뜻 두 열을 복사해 붙여넣으세요. 뜻 안의 쉼표는 그대로
            유지됩니다.
          </p>
          <label>
            영어 단어[TAB]뜻
            <textarea
              required
              rows={9}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"apple\t사과\njourney\t여행, 여정"}
            />
          </label>
          <button className="primary wide" disabled={busy}>
            한꺼번에 등록
          </button>
        </form>
      ) : (
        <>
          <p className="muted">
            한 줄에 영어 단어 하나씩 입력하세요. 저장된 사전을 먼저 찾고, 없으면
            설치된 WordNet에서 영어 정의를 조회합니다.
          </p>
          <label>
            영어 단어 목록
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"apple\nwalk"}
            />
          </label>
          <button
            className="secondary wide"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const words = text
                  .split(/\r?\n/)
                  .map((w) => w.trim())
                  .filter(Boolean);
                if (!words.length)
                  throw new Error("영어 단어를 입력해 주세요.");
                const r = await api<{
                  wordnet_available: boolean;
                  results: { word: string; candidates: Candidate[] }[];
                }>("/dictionary/lookup", "POST", { words });
                setWordnet(r.wordnet_available);
                setLookups(r.results);
                setDrafts(
                  r.results.map((row) => ({
                    ...blank(),
                    word: row.word,
                    definition: row.candidates[0]?.definition || "",
                    pos: row.candidates[0]?.pos || "",
                    dictionary_id: row.candidates[0]?.id,
                  })),
                );
              })
            }
          >
            <Search size={16} />뜻 후보 조회
          </button>
          {lookups && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => save(drafts));
              }}
            >
              {!wordnet && (
                <div className="notice">
                  WordNet 데이터가 없어 저장된 사전만 조회했습니다. 조회되지
                  않은 단어는 뜻을 직접 입력해 주세요.
                </div>
              )}
              {lookups.map((row, i) => (
                <div className="lookup-row" key={row.word}>
                  <h3>{row.word}</h3>
                  {row.candidates.length > 0 ? (
                    <label>
                      품사·뜻 후보
                      <select
                        value={drafts[i].dictionary_id || ""}
                        onChange={(e) => {
                          const c = row.candidates.find(
                            (c) => c.id === Number(e.target.value),
                          );
                          setDrafts((ds) =>
                            ds.map((d, j) =>
                              j === i
                                ? {
                                    ...d,
                                    dictionary_id: c?.id,
                                    definition: c?.definition || "",
                                    pos: c?.pos || "",
                                  }
                                : d,
                            ),
                          );
                        }}
                      >
                        <option value="">직접 입력</option>
                        {row.candidates.map((c) => (
                          <option value={c.id} key={c.id}>
                            {posName(c.pos)} · {c.definition} (
                            {c.source === "wordnet" ? "WordNet" : "시연 사전"})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="muted">
                      조회 결과가 없어요. 뜻을 직접 입력해 주세요.
                    </p>
                  )}
                  <label>
                    뜻 확인·수정
                    <textarea
                      required
                      rows={2}
                      value={drafts[i].definition}
                      onChange={(e) =>
                        setDrafts((ds) =>
                          ds.map((d, j) =>
                            j === i ? { ...d, definition: e.target.value } : d,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    품사
                    <input
                      maxLength={40}
                      value={drafts[i].pos}
                      onChange={(e) =>
                        setDrafts((ds) =>
                          ds.map((d, j) =>
                            j === i ? { ...d, pos: e.target.value } : d,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                className="primary wide"
                disabled={busy || !drafts.length}
              >
                선택한 뜻으로 등록
              </button>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}

export function SavedPage() {
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    cards = useLoad<Card[]>(
      `/saved?filter=${filter}&q=${encodeURIComponent(query)}`,
    ),
    [study, setStudy] = useState(false),
    { busy, run } = useAction();
  return (
    <>
      <PageTitle
        eyebrow="KEEP & REMEMBER"
        title="저장한 단어"
        description="중요한 단어와 잊은 단어를 다시 꺼내 보세요."
      >
        <button
          className="primary"
          disabled={!cards.data?.length}
          onClick={() => setStudy(true)}
        >
          <Layers size={18} />
          다시 학습
        </button>
      </PageTitle>
      <div className="toolbar">
        <div className="tabs">
          {[
            ["all", "전체"],
            ["important", "중요"],
            ["forgotten", "잊음"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={filter === v ? "selected" : ""}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <SearchBox value={query} onChange={setQuery} />
      </div>
      {cards.loading ? (
        <Loading />
      ) : cards.error ? (
        <Failure message={cards.error} retry={cards.refresh} />
      ) : cards.data!.length ? (
        <>
          <p className="muted">{cards.data!.length}개 카드</p>
          <div className="word-list">
            {cards.data!.map((c) => (
              <WordRow card={c} key={c.id}>
                <button
                  className={`flag-btn ${c.important ? "on" : ""}`}
                  aria-label={`${c.word} 중요`}
                  aria-pressed={c.important}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/cards/${c.id}/saved`, "PUT", {
                        important: !c.important,
                        forgotten: c.forgotten,
                      });
                      cards.refresh();
                    }, "저장 상태를 변경했습니다.")
                  }
                >
                  <Star size={16} />
                </button>
                <button
                  className={`flag-btn ${c.forgotten ? "forgotten-on" : ""}`}
                  aria-label={`${c.word} 잊음`}
                  aria-pressed={c.forgotten}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/cards/${c.id}/saved`, "PUT", {
                        important: c.important,
                        forgotten: !c.forgotten,
                      });
                      cards.refresh();
                    }, "저장 상태를 변경했습니다.")
                  }
                >
                  <Bookmark size={16} />
                </button>
                <button
                  className="text-btn danger"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/cards/${c.id}/saved`, "PUT", {
                        important: false,
                        forgotten: false,
                      });
                      cards.refresh();
                    }, "저장을 해제했습니다.")
                  }
                >
                  저장 해제
                </button>
              </WordRow>
            ))}
          </div>
        </>
      ) : (
        <Empty
          title="저장한 단어가 없어요"
          description={
            query
              ? "다른 검색어로 찾아보세요."
              : "학습 카드에서 중요 또는 잊음을 선택하면 여기에 모입니다."
          }
        >
          <button className="secondary" onClick={() => go("levels")}>
            레벨별 학습으로
          </button>
        </Empty>
      )}
      {study && (
        <StartDialog
          source={{ kind: "saved", saved_filter: filter, query }}
          available={cards.data?.length || 0}
          onClose={() => setStudy(false)}
        />
      )}
    </>
  );
}

export function LevelsPage() {
  const [level, setLevel] = useState(1),
    [category, setCategory] = useState("all"),
    cards = useLoad<Card[]>(`/levels/${level}/cards?category=${category}`),
    [study, setStudy] = useState(false);
  return (
    <>
      <PageTitle
        eyebrow="STEP BY STEP"
        title="레벨별 학습"
        description="세 가지 단계로, 내게 맞는 단어를 만나 보세요."
      />
      <div className="level-grid">
        {[
          { n: 1, title: "가볍게 시작하기", detail: "0–3점 · 기초 단어" },
          { n: 2, title: "한 걸음 더 넓게", detail: "4–6점 · 중급 단어" },
          { n: 3, title: "더 깊이 알아가기", detail: "7–10점 · 고급 단어" },
        ].map((l) => (
          <button
            className={`level-tile ${level === l.n ? "selected" : ""}`}
            key={l.n}
            onClick={() => setLevel(l.n)}
          >
            <span>LEVEL 0{l.n}</span>
            <h3>{l.title}</h3>
            <p>{l.detail}</p>
            <span className="level-check">
              {level === l.n ? <Check size={18} /> : <ArrowRight size={18} />}
            </span>
          </button>
        ))}
      </div>
      <div className="info-strip">
        <LeafIcon />
        <p>
          WordNet에서 수집한 단어는 <strong>AI 자동 분류</strong>로 표시됩니다.
          자동 분류는 추정 난이도이며, 사람이 확인한 결과는 검수 완료로 구분합니다.
        </p>
      </div>
      <WordnetCollection onComplete={cards.refresh} />
      <div className="toolbar">
        <div className="tabs">
          {[
            ["all", "전체"],
            ["demo", "시연용 수동 분류"],
            ["ai", "AI 분류"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={category === v ? "selected" : ""}
              onClick={() => setCategory(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          className="primary"
          disabled={!cards.data?.length || cards.loading}
          onClick={() => setStudy(true)}
        >
          레벨 {level} 학습 <ArrowRight size={18} />
        </button>
      </div>
      {cards.loading ? (
        <Loading />
      ) : cards.error ? (
        <Failure message={cards.error} retry={cards.refresh} />
      ) : cards.data!.length ? (
        <div className="word-list">
          {cards.data!.map((c) => (
            <WordRow key={c.id} card={c}>
              <span className="tag">
                {c.classification_kind === "manual_demo"
                  ? "시연용 수동 분류"
                  : c.classification_kind === "ai_auto" ? "AI 자동 분류" : "AI · 검수 완료"}
              </span>
            </WordRow>
          ))}
        </div>
      ) : (
        <Empty
          title="이 조건의 단어가 아직 없어요"
          description="자동 수집·난이도 분류를 실행하면 WordNet 단어로 학습할 수 있습니다."
        />
      )}
      {study && (
        <StartDialog
          source={{ kind: "level", level, category }}
          available={cards.data?.length || 0}
          onClose={() => setStudy(false)}
        />
      )}
    </>
  );
}
function LeafIcon() {
  return <Layers size={19} />;
}
