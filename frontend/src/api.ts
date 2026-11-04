export const IS_BROWSER_MODE = import.meta.env.VITE_STORAGE_MODE === "browser";
export type Card = {
  id: number;
  word: string;
  definition: string;
  pos: string;
  notes: string;
  accepted_answers: string[];
  important: boolean;
  forgotten: boolean;
  kind: string;
  classification_kind?: string;
  dictionary_id?: number;
  deleted?: boolean;
};
export type Notebook = {
  id: number;
  name: string;
  card_count: number;
  cards?: Card[];
};
export type Source = {
  kind: "notebook" | "level" | "saved" | "wrong";
  notebook_id?: number;
  level?: number;
  category?: string;
  saved_filter?: string;
  exam_id?: string;
  query?: string;
};
export type Study = {
  id: string;
  source: Source;
  cards: Card[];
  position: number;
  flipped: boolean;
  requested: string;
};
export type ResultItem = {
  question_id: string;
  card_id: number;
  word: string;
  definition: string;
  answer: string;
  accepted_answers: string[];
  correct: boolean;
};
export type Exam = {
  id: string;
  source: Source;
  questions: {
    id: string;
    definition: string;
    pos: string;
    classification_kind?: string;
  }[];
  answers: Record<string, string>;
  position: number;
  requested: string;
  result: null | {
    total: number;
    correct: number;
    wrong: number;
    accuracy: number;
    items: ResultItem[];
  };
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (IS_BROWSER_MODE) {
    const { browserApi } = await import("./browserStore");
    return browserApi(path, method, body) as Promise<T>;
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status >= 500)
      throw new Error(
        "서버에서 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : "입력 내용을 확인해 주세요. 필수 항목이나 길이가 올바르지 않습니다.",
    );
  }
  if (data === null)
    throw new Error(
      "서버 응답을 읽을 수 없습니다. 백엔드 연결을 확인해 주세요.",
    );
  return data as T;
}
export function go(path: string) {
  window.location.hash = "#/" + path;
}
export function sourceName(source: Source) {
  return source.kind === "notebook"
    ? "내 단어장"
    : source.kind === "level"
      ? `레벨 ${source.level}`
      : source.kind === "saved"
        ? "저장한 단어"
        : "틀린 단어";
}
export const posName = (pos: string) =>
  ({ n: "명사", v: "동사", a: "형용사", s: "형용사", r: "부사" })[pos] ||
  pos ||
  "품사 미지정";
