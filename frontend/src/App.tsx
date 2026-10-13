import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronRight,
  ClipboardList,
  Home as HomeIcon,
  Layers,
  Leaf,
  Menu,
  Sprout,
  X,
} from "lucide-react";
import { go } from "./api";
import {
  ToastContext,
  Empty,
  Failure,
  Loading,
  PageTitle,
  useLoad,
} from "./ui";
import { NotebookPage, NotebooksPage, SavedPage, LevelsPage } from "./Library";
import { StudyPage, ExamPage, ExamSetup } from "./Sessions";

const navigation = [
  { path: "", name: "홈", icon: HomeIcon },
  { path: "notebooks", name: "내 단어장", icon: BookOpen },
  { path: "levels", name: "레벨별 학습", icon: Layers },
  { path: "saved", name: "저장한 단어", icon: Bookmark },
  { path: "exams", name: "시험 보기", icon: ClipboardList },
];
export default function App() {
  const [route, setRoute] = useState(window.location.hash.replace(/^#\/?/, "")),
    [menu, setMenu] = useState(false),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const update = () => {
      setRoute(window.location.hash.replace(/^#\/?/, ""));
      setMenu(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const [page, id] = route.split("/");
  const title =
    navigation.find((n) => n.path === page)?.name ||
    (page === "study" ? "플래시카드 학습" : "시험 진행");
  const notify = (message: string, error = false) => {
    setToast({ message, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 6000);
  };
  let content;
  if (!page) content = <HomePage />;
  else if (page === "notebooks")
    content = id ? (
      <NotebookPage key={id} id={Number(id)} />
    ) : (
      <NotebooksPage />
    );
  else if (page === "levels") content = <LevelsPage />;
  else if (page === "saved") content = <SavedPage />;
  else if (page === "study" && id) content = <StudyPage key={id} id={id} />;
  else if (page === "exams")
    content = id ? <ExamPage key={id} id={id} /> : <ExamSetup />;
  else
    content = (
      <Empty
        title="페이지를 찾을 수 없어요"
        description="홈에서 다시 시작해 주세요."
      >
        <button className="primary" onClick={() => go("")}>
          홈으로
        </button>
      </Empty>
    );
  return (
    <ToastContext.Provider value={notify}>
      <div className="app-shell">
        <aside className={`sidebar ${menu ? "open" : ""}`}>
          <a className="brand" href="#/">
            <span className="brand-icon">
              <Sprout size={25} />
            </span>
            <span>
              단어의 숲<small>MY WORD GARDEN</small>
            </span>
          </a>
          <p className="nav-label">나의 학습 공간</p>
          <nav>
            {navigation.map((n) => (
              <a
                key={n.path}
                href={`#/${n.path}`}
                className={(page || "") === n.path ? "active" : ""}
              >
                <n.icon size={20} />
                {n.name}
                {(page || "") === n.path && <ChevronRight size={16} />}
              </a>
            ))}
          </nav>
          <div className="sidebar-note">
            <Leaf size={22} />
            <p>
              하루에 단어 하나,
              <br />
              조금씩 자라는 나의 영어.
            </p>
            <span>나만의 로컬 학습 공간</span>
          </div>
        </aside>
        {menu && (
          <button
            className="scrim"
            aria-label="메뉴 닫기"
            onClick={() => setMenu(false)}
          />
        )}
        <div className="workspace">
          <header className="topbar">
            <div>
              <button
                className="icon-btn mobile-menu"
                aria-label="메뉴 열기"
                onClick={() => setMenu(!menu)}
              >
                <Menu />
              </button>
              <span>학습 공간</span>
              <ChevronRight size={14} />
              <strong>{title}</strong>
            </div>
            <span className="local-badge">
              <span />
              개인용 · 로컬
            </span>
          </header>
          <main>{content}</main>
          <footer>
            단어의 숲 <span>작은 배움이 쌓이는 곳</span>
          </footer>
        </div>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <X size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button aria-label="알림 닫기" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}

function HomePage() {
  const stats = useLoad<{
    notebooks: number;
    personal_cards: number;
    saved: number;
    completed_exams: number;
  }>("/dashboard");
  const health = useLoad<{
    wordnet_available: boolean;
    ai_configured: boolean;
  }>("/health");
  const lastStudy = localStorage.getItem("lastStudy"),
    lastExam = localStorage.getItem("lastExam");
  return (
    <>
      <PageTitle
        eyebrow="A LITTLE EVERY DAY"
        title="오늘도, 한 단어씩."
        description="나만의 속도로 배우고 기억하는 영어 학습 공간"
      />
      <section className="hero">
        <div>
          <span className="pill">나의 작은 영어 습관</span>
          <h2>
            새로운 단어를 만나고,
            <br />
            나의 언어로 만들어 보세요.
          </h2>
          <p>
            단어장을 만들고, 카드로 익히고, 시험으로 확인하세요.
            <br className="desktop" /> 기억하고 싶은 단어는 언제든 다시 꺼내 볼
            수 있어요.
          </p>
          <button className="primary" onClick={() => go("notebooks")}>
            내 단어장 열기 <ArrowRight size={18} />
          </button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-ring" />
          <div className="art-card back">
            <Leaf size={35} />
          </div>
          <div className="art-card front">
            <span>word of the day</span>
            <strong>grow</strong>
            <em>/ɡroʊ/</em>
            <div className="art-line" />
            <p>자라다, 성장하다</p>
            <Sprout size={35} />
          </div>
          <div className="art-tag">
            <Check size={15} />
            조금씩, 꾸준히
          </div>
        </div>
      </section>
      {stats.loading ? (
        <Loading />
      ) : stats.error ? (
        <Failure message={stats.error} retry={stats.refresh} />
      ) : (
        <div className="stats">
          {[
            {
              label: "내 단어장",
              value: stats.data!.notebooks,
              unit: "권",
              icon: BookOpen,
            },
            {
              label: "나의 단어",
              value: stats.data!.personal_cards,
              unit: "개",
              icon: Layers,
            },
            {
              label: "저장한 단어",
              value: stats.data!.saved,
              unit: "개",
              icon: Bookmark,
            },
            {
              label: "완료한 시험",
              value: stats.data!.completed_exams,
              unit: "회",
              icon: ClipboardList,
            },
          ].map((s) => (
            <div className="stat" key={s.label}>
              <s.icon size={21} />
              <div>
                <span>{s.label}</span>
                <strong>
                  {s.value}
                  <small>{s.unit}</small>
                </strong>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="section-heading">
        <h2>어떻게 공부할까요?</h2>
        <span>원하는 방식으로 시작하세요</span>
      </div>
      <div className="feature-grid">
        {[
          {
            path: "notebooks",
            icon: BookOpen,
            title: "내 단어장",
            description: "직접 고른 단어와 뜻을 모아 나만의 단어장을 만들어요.",
            badge: "나만의 컬렉션",
            color: "green",
          },
          {
            path: "levels",
            icon: Layers,
            title: "레벨별 학습",
            description: "레벨 1부터 3까지, 단계별 단어를 카드로 익혀요.",
            badge: "차근차근 배우기",
            color: "tan",
          },
          {
            path: "saved",
            icon: Bookmark,
            title: "저장한 단어",
            description: "중요한 단어와 잊은 단어를 모아 다시 기억해요.",
            badge: "한 번 더 기억하기",
            color: "rose",
          },
          {
            path: "exams",
            icon: ClipboardList,
            title: "시험 보기",
            description: "뜻을 보고 영어 단어를 입력하며 배움을 확인해요.",
            badge: "배움 확인하기",
            color: "blue",
          },
        ].map((f) => (
          <button className="feature" key={f.path} onClick={() => go(f.path)}>
            <span className={`feature-icon ${f.color}`}>
              <f.icon size={23} />
            </span>
            <span className="feature-badge">{f.badge}</span>
            <h3>
              {f.title}
              <ArrowRight size={18} />
            </h3>
            <p>{f.description}</p>
          </button>
        ))}
      </div>
      {(lastStudy || lastExam) && (
        <div className="resume">
          <span>이어서 공부하기</span>
          {lastStudy && (
            <button
              className="text-btn"
              onClick={() => go(`study/${lastStudy}`)}
            >
              최근 학습 <ArrowRight size={16} />
            </button>
          )}
          {lastExam && (
            <button
              className="text-btn"
              onClick={() => go(`exams/${lastExam}`)}
            >
              최근 시험 <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      <div className="info-strip">
        <Leaf size={19} />
        <p>
          공용 단어는 <strong>시연용 수동 분류</strong> 30개로 시작합니다. AI
          평가와 검수 완료 데이터는 별도로 구분합니다.
        </p>
      </div>
      {health.data && (
        <p className="setup-note">
          WordNet{" "}
          {health.data.wordnet_available ? "사용 가능" : "데이터 설치 필요"} ·
          AI {health.data.ai_configured ? "연결 설정됨" : "설정 필요"} · 설정과
          무관하게 개인 학습과 시험은 사용할 수 있어요.
        </p>
      )}
    </>
  );
}
