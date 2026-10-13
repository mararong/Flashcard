import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  LoaderCircle,
  X,
} from "lucide-react";
import { api, go, type Source } from "./api";

export const ToastContext = createContext<
  (message: string, error?: boolean) => void
>(() => {});
export function useAction() {
  const toast = useContext(ToastContext),
    [busy, setBusy] = useState(false);
  async function run<T>(
    action: () => Promise<T>,
    success?: string,
  ): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await action();
      if (success) toast(success);
      return result;
    } catch (e) {
      toast(
        e instanceof Error
          ? e.message
          : "처리하지 못했습니다. 다시 시도해 주세요.",
        true,
      );
    } finally {
      setBusy(false);
    }
  }
  return { busy, run, toast };
}
export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<T>(path)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, version]);
  return {
    data,
    setData,
    error,
    loading,
    refresh: () => setVersion((v) => v + 1),
  };
}
export function Loading() {
  return (
    <div className="state">
      <LoaderCircle className="spin" />
      불러오는 중입니다…
    </div>
  );
}
export function Failure({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="state error" role="alert">
      <AlertCircle />
      <p>{message}</p>
      <button className="secondary" onClick={retry}>
        다시 시도
      </button>
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BookOpen size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="title-actions">{children}</div>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" aria-label="닫기" onClick={onClose}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function StartDialog({
  source,
  available,
  onClose,
}: {
  source: Source;
  available: number;
  onClose: () => void;
}) {
  const [count, setCount] = useState("10"),
    { busy, run } = useAction();
  return (
    <Modal title="학습 준비" onClose={onClose}>
      <p className="muted">카드를 섞어 한 번씩 보여 드릴게요.</p>
      <label>
        학습할 카드 수
        <select value={count} onChange={(e) => setCount(e.target.value)}>
          <option value="10">10개</option>
          <option value="20">20개</option>
          <option value="all">전체</option>
        </select>
      </label>
      <div className="notice">
        {count !== "all" && available < Number(count)
          ? `요청한 ${count}개보다 카드가 적어 ${available}개로 시작합니다.`
          : `학습 가능한 카드 ${available}개`}
      </div>
      <button
        className="primary wide"
        disabled={busy || available === 0}
        onClick={() =>
          run(async () => {
            const s = await api<{ id: string }>("/study", "POST", {
              source,
              count,
            });
            localStorage.setItem("lastStudy", s.id);
            go(`study/${s.id}`);
          })
        }
      >
        학습 시작 <ArrowRight size={18} />
      </button>
    </Modal>
  );
}
