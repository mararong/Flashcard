import catalog from "./wordnet.json";
import type { Card, Exam, Source, Study } from "./api";

type StoredCard = Card & { level?: number };
type Book = { id: number; name: string; created_at: string; ids: number[] };
type StoredExam = Exam & { snapshot: StoredCard[]; created_at: string };
type State = {
  version: 1;
  catalogVersion?: string;
  seq: number;
  cards: Record<number, StoredCard>;
  books: Book[];
  studies: Record<string, Study>;
  exams: Record<string, StoredExam>;
};
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const clone = <T>(v: T): T => structuredClone(v);
const fail = (message: string): never => {
  throw new Error(message);
};
function initial(): State {
  const state: State = {
    version: 1,
    seq: 0,
    cards: {},
    books: [],
    studies: {},
    exams: {},
  };
  return state;
}
function installCatalog(state:State){
  if(state.catalogVersion==='wordnet-3.0-10000-v1')return false;
  const existing=new Set(Object.values(state.cards).filter(c=>c.classification_kind==='frequency').map(c=>c.word));
  for(const entry of catalog){
    if(existing.has(entry.word))continue;
    const id=++state.seq;
    state.cards[id]={...entry,id,notes:'WordNet '+entry.source_version+' · '+entry.sense_key+' · Zipf '+entry.zipf+' · 사용 빈도 기준 임시 단계 (AI 평가 아님)',accepted_answers:[],important:false,forgotten:false,kind:'public',classification_kind:'frequency',dictionary_id:id};
  }
  state.catalogVersion='wordnet-3.0-10000-v1';return true;
}
let connection: Promise<IDBDatabase> | undefined;
function database() {
  if (!connection)
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("word-garden", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("state");
      req.onsuccess = () => {
        req.result.onversionchange = () => {
          req.result.close();
          connection = undefined;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        connection = undefined;
        reject(
          new Error(
            "브라우저 저장소를 열 수 없습니다. 저장소 권한과 사용 가능 공간을 확인해 주세요.",
          ),
        );
      };
      req.onblocked = () => {
        reject(new Error("다른 탭을 닫은 뒤 다시 시도해 주세요."));
      };
    });
  return connection;
}

// A read/write transaction serializes requests across tabs. Resolve only after commit.
export async function browserApi(
  path: string,
  method: string,
  body: unknown,
): Promise<unknown> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    const store = tx.objectStore("state");
    let result: unknown, error: unknown;
    const req = store.get("app");
    req.onsuccess = () => {
      try {
        const state: State = req.result || initial();
        if (state.version !== 1)
          fail(
            "지원하지 않는 저장 형식입니다. 데이터를 삭제하지 말고 앱을 업데이트해 주세요.",
          );
        const installed=installCatalog(state);
        result = route(state, path, method, body);
        if(installed || method!=="GET") store.put(state, "app");
      } catch (e) {
        error = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () =>
      reject(
        error ||
          new Error(
            "브라우저에 저장하지 못했습니다. 저장 공간을 확인해 주세요.",
          ),
      );
    tx.onerror = () => {
      error ||= new Error(
        "브라우저 저장에 실패했습니다. 저장 공간과 권한을 확인해 주세요.",
      );
    };
  });
}
function card(s: State, id: number) {
  return s.cards[id] || fail("카드를 찾을 수 없습니다.");
}
function book(s: State, id: number) {
  return s.books.find((b) => b.id === id) || fail("단어장을 찾을 수 없습니다.");
}
function exam(s: State, id: string) {
  return s.exams[id] || fail("시험을 찾을 수 없습니다.");
}
function study(s: State, id: string) {
  return s.studies[id] || fail("학습 기록을 찾을 수 없습니다.");
}
function cards(s: State, source: Source): StoredCard[] {
  let values = Object.values(s.cards);
  if (source.kind === "notebook")
    values = book(s, source.notebook_id!).ids.map((id) => card(s, id));
  else if (source.kind === "level")
    values =
      source.category && source.category !== "all" && source.category !== "demo"
        ? []
        : values.filter((c) => c.kind === "public" && c.level === source.level && (source.category=== "demo" ? c.classification_kind==="manual_demo" : c.classification_kind!=="manual_demo"));
  else if (source.kind === "saved")
    values = values.filter(
      (c) =>
        (c.important || c.forgotten) &&
        (source.saved_filter === "important"
          ? c.important
          : source.saved_filter === "forgotten"
            ? c.forgotten
            : true),
    );
  else {
    const result =
      exam(s, source.exam_id!).result || fail("시험을 먼저 제출해 주세요.");
    const ids = new Set(
      result.items.filter((i) => !i.correct).map((i) => i.card_id),
    );
    values = values.filter((c) => ids.has(c.id));
  }
  const q = norm(source.query || "");
  return values.filter((c) => norm(c.word + " " + c.definition).includes(q));
}
function sample(values: StoredCard[], count: string) {
  const items = clone(values);
  for (let i = items.length - 1; i > 0; i--) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    const j = Math.floor((a[0] / 4294967296) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return count === "all" ? items : items.slice(0, Number(count));
}
function examView(e: StoredExam): Exam {
  const { snapshot, created_at, ...view } = e;
  return clone(view);
}
function studyView(s: State, value: Study) {
  const view = clone(value);
  for (const c of view.cards) {
    c.important = !!s.cards[c.id]?.important;
    c.forgotten = !!s.cards[c.id]?.forgotten;
    c.deleted = !s.cards[c.id];
  }
  return view;
}
function validateCard(data: any): StoredCard {
  const word = String(data.word || "").trim(),
    definition = String(data.definition || "").trim();
  if (!word || !definition || word.length > 150 || definition.length > 3000)
    fail("단어와 뜻의 길이를 확인해 주세요.");
  return {
    ...data,
    word,
    definition,
    pos: String(data.pos || "").trim(),
    notes: String(data.notes || "").trim(),
    accepted_answers: [
      ...new Set<string>(
        (data.accepted_answers || []).map(norm).filter(Boolean),
      ),
    ],
  };
}
function duplicate(s: State, b: Book, c: StoredCard, exclude?: number) {
  return b.ids.some(
    (id) =>
      id !== exclude &&
      norm(card(s, id).word) === norm(c.word) &&
      norm(card(s, id).definition) === norm(c.definition) &&
      norm(card(s, id).pos) === norm(c.pos),
  );
}

function route(s: State, path: string, method: string, body: unknown): unknown {
  const url = new URL(path, "https://local.invalid");
  const p = url.pathname.split("/").filter(Boolean);
  const q = url.searchParams;
  const b = body as any;
  const all = Object.values(s.cards);
  if (p[0] === "health")
    return {
      status: "ok",
      wordnet_available: false,
      ai_configured: false,
      ai_model: null,
    };
  if (p[0] === "dashboard")
    return {
      notebooks: s.books.length,
      personal_cards: new Set(s.books.flatMap((b) => b.ids)).size,
      saved: all.filter((c) => c.important || c.forgotten).length,
      completed_exams: Object.values(s.exams).filter((e) => e.result).length,
    };
  if (p[0] === "notebooks") {
    if (!p[1]) {
      if (method === "GET")
        return s.books
          .slice()
          .reverse()
          .map(({ ids, ...b }) => ({ ...b, card_count: ids.length }));
      const name = String(b.name || "").trim();
      if (!name || name.length > 80)
        fail("단어장 이름은 1~80자로 입력해 주세요.");
      const value: Book = {
        id: ++s.seq,
        name,
        ids: [],
        created_at: new Date().toISOString(),
      };
      s.books.push(value);
      return clone(value);
    }
    const value = book(s, Number(p[1]));
    if (p[2] === "cards") {
      if (!Array.isArray(b.cards) || !b.cards.length || b.cards.length > 500)
        fail("한 번에 1~500개 카드를 입력해 주세요.");
      const ids: number[] = [];
      let skipped = 0;
      for (const item of b.cards) {
        const c = validateCard(item);
        if (duplicate(s, value, c)) {
          skipped++;
          continue;
        }
        const id = ++s.seq;
        s.cards[id] = {
          ...c,
          id,
          kind: "personal",
          important: false,
          forgotten: false,
        };
        value.ids.push(id);
        ids.push(id);
      }
      return { added: ids.length, skipped, ids };
    }
    if (method === "DELETE") {
      s.books = s.books.filter((v) => v.id !== value.id);
      return { deleted: true };
    }
    if (method === "PATCH") {
      const name = String(b.name || "").trim();
      if (!name || name.length > 80) fail("단어장 이름을 확인해 주세요.");
      value.name = name;
    }
    return {
      ...clone(value),
      card_count: value.ids.length,
      cards: clone(
        value.ids
          .map((id) => card(s, id))
          .filter((c) =>
            norm(c.word + " " + c.definition).includes(norm(q.get("q") || "")),
          )
          .reverse(),
      ),
    };
  }
  if (p[0] === "cards") {
    const value = card(s, Number(p[1]));
    if (p[2] === "saved") {
      value.important = !!b.important;
      value.forgotten = !!b.forgotten;
      return {
        card_id: value.id,
        important: value.important,
        forgotten: value.forgotten,
      };
    }
    if (value.kind !== "personal")
      fail("공용 사전은 수정하거나 삭제할 수 없습니다.");
    if (method === "DELETE") {
      delete s.cards[value.id];
      for (const book of s.books)
        book.ids = book.ids.filter((id) => id !== value.id);
      return { deleted: true };
    }
    const updated = validateCard(b);
    for (const book of s.books.filter((v) => v.ids.includes(value.id)))
      if (duplicate(s, book, updated, value.id))
        fail("같은 단어·뜻·품사의 카드가 이미 있습니다.");
    Object.assign(value, updated, {
      id: value.id,
      kind: "personal",
      important: value.important,
      forgotten: value.forgotten,
    });
    return clone(value);
  }
  if (p[0] === "dictionary")
    return {
      wordnet_available: false,
      results: [...new Set<string>(b.words.map(norm).filter(Boolean))].map(
        (word) => ({
          word,
          candidates: all
            .filter((c) => c.kind === "public" && norm(c.word) === word)
            .map((c) => ({ ...c, source: c.classification_kind==="frequency"?"wordnet":"demo" })),
        }),
      ),
    };
  if (p[0] === "levels") {
    if (p[1])
      return clone(
        cards(s, {
          kind: "level",
          level: Number(p[1]),
          category: q.get("category") || "all",
        }).slice(0,200),
      );
    return [1, 2, 3].map((level) => ({
      level,
      demo: all.filter(c=>c.level===level&&c.classification_kind==="manual_demo").length,
      ai: 0,
      ai_auto: 0,
      total: cards(s,{kind:"level",level}).length,
    }));
  }
  if (p[0] === "saved")
    return clone(
      cards(s, {
        kind: "saved",
        saved_filter: q.get("filter") || "all",
        query: q.get("q") || "",
      }),
    );
  if (p[0] === "study") {
    if (!p[1]) {
      const selected = sample(cards(s, b.source), b.count || "10");
      if (!selected.length)
        fail(
          "학습할 카드가 없습니다. 단어를 등록하거나 다른 출처를 선택해 주세요.",
        );
      const value: Study = {
        id: crypto.randomUUID(),
        source: clone(b.source),
        cards: selected,
        position: 0,
        flipped: false,
        requested: b.count || "10",
      };
      s.studies[value.id] = value;
      return studyView(s, value);
    }
    const value = study(s, p[1]);
    if (method === "PATCH") {
      if (
        !Number.isInteger(b.position) ||
        b.position < 0 ||
        b.position >= value.cards.length
      )
        fail("카드 위치가 올바르지 않습니다.");
      value.position = b.position;
      value.flipped = !!b.flipped;
    }
    return studyView(s, value);
  }
  if (p[0] === "exams") {
    if (!p[1]) {
      if (method === "GET")
        return Object.values(s.exams)
          .reverse()
          .slice(0, 20)
          .map((e) => ({
            id: e.id,
            created_at: e.created_at,
            source: e.source,
            submitted: !!e.result,
            total: e.questions.length,
            accuracy: e.result?.accuracy ?? null,
          }));
      const selected = sample(cards(s, b.source), b.count || "10");
      if (!selected.length) fail("출제할 카드가 없습니다.");
      const value: StoredExam = {
        id: crypto.randomUUID(),
        source: clone(b.source),
        snapshot: selected,
        questions: selected.map((c, i) => ({
          id: String(i),
          definition: c.definition,
          pos: c.pos,
          classification_kind: c.classification_kind,
        })),
        answers: {},
        position: 0,
        requested: b.count || "10",
        result: null,
        created_at: new Date().toISOString(),
      };
      s.exams[value.id] = value;
      return examView(value);
    }
    const value = exam(s, p[1]);
    if (p[2] === "save-wrong") {
      const result = value.result || fail("시험을 먼저 제출해 주세요.");
      let count = 0;
      for (const item of result.items)
        if (!item.correct && s.cards[item.card_id]) {
          s.cards[item.card_id].forgotten = true;
          count++;
        }
      return { saved: count };
    }
    if (p[2] && !value.result) {
      const answers: Record<string, string> = b.answers || {};
      if (
        Object.entries(answers).some(
          ([key, v]) =>
            !value.questions.some((q) => q.id === key) ||
            typeof v !== "string" ||
            v.length > 300,
        )
      )
        fail("답안을 확인해 주세요.");
      value.answers = clone(answers);
      if (p[2] === "answers") {
        if (
          !Number.isInteger(b.position) ||
          b.position < 0 ||
          b.position >= value.questions.length
        )
          fail("문항 위치를 확인해 주세요.");
        value.position = b.position;
      }
      if (p[2] === "submit") {
        const items = value.snapshot.map((c, i) => {
          const answer = answers[String(i)] || "";
          return {
            question_id: String(i),
            card_id: c.id,
            definition: c.definition,
            word: c.word,
            accepted_answers: c.accepted_answers,
            answer,
            correct: [c.word, ...c.accepted_answers]
              .map(norm)
              .includes(norm(answer)),
          };
        });
        const correct = items.filter((i) => i.correct).length;
        value.result = {
          items,
          total: items.length,
          correct,
          wrong: items.length - correct,
          accuracy: Math.round((correct / items.length) * 1000) / 10,
        };
      }
    }
    return examView(value);
  }
  return fail("브라우저 모드에서 지원하지 않는 기능입니다.");
}
