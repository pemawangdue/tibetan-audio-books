import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  ChevronRight,
  CircleAlert,
  FileImage,
  FileText,
  Gauge,
  Languages,
  Library,
  Menu,
  Moon,
  MoreVertical,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Share2,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { zipSync } from "fflate";
import { api } from "./api";
import { AuthProvider, LoginPage, ProtectedRoute, useAuth } from "./auth";
import { I18nProvider, useI18n } from "./i18n";
import type {
  Book,
  Bookmark as SavedBookmark,
  ProcessingJob,
  SentenceSegment,
} from "./types";

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      return JSON.parse(localStorage.getItem(key) || "");
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};
interface Playing {
  book: Book;
  page: number;
  segment: number;
  playing: boolean;
}
let setGlobalPlayer: ((value: Playing | null) => void) | null = null;

function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const [player, setPlayer] = useState<Playing | null>(null);
  setGlobalPlayer = setPlayer;
  const reader = useLocation().pathname.endsWith("/read");
  return (
    <div className="app-shell">
      {!reader && (
        <header className="topbar">
          <Link to="/library" className="brand">
            <span className="brand-mark small">ད</span>dadhep
          </Link>
          <button
            className="icon-button mobile-only"
            aria-label="Open menu"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <nav className={menu ? "nav open" : "nav"}>
            <NavLink to="/library">
              <Library />
              {t("library")}
            </NavLink>
            <NavLink to="/bookmarks">
              <Bookmark />
              {t("bookmarks")}
            </NavLink>
            <NavLink to="/settings">
              <Settings />
              {t("settings")}
            </NavLink>
          </nav>
        </header>
      )}
      <div className={player && !reader ? "page-with-player" : ""}>
        {children}
      </div>
      {player && !reader && (
        <aside className="mini-player" aria-label="Current audio">
          <button
            className="play-small"
            aria-label={player.playing ? "Pause" : "Play"}
            onClick={() => setPlayer({ ...player, playing: !player.playing })}
          >
            {player.playing ? <Pause /> : <Play />}
          </button>
          <Link to={`/books/${player.book.id}/read`} className="mini-copy">
            <strong>{player.book.title}</strong>
            <span>
              {player.book.pages?.[player.page]?.segments[player.segment]?.text}
            </span>
          </Link>
          <span>
            {player.page + 1}/{player.book.pageCount}
          </span>
          <button
            className="icon-button"
            aria-label="Close player"
            onClick={() => setPlayer(null)}
          >
            <X />
          </button>
        </aside>
      )}
    </div>
  );
}

function LibraryPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"me" | "shared">("me");
  const [books, setBooks] = useState<Book[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    api
      .listBooks()
      .then((x) => {
        setBooks(x);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);
  const shown = books.filter((book) => book.owner === tab);
  return (
    <main className="container">
      <div className="title-row">
        <div>
          <p className="eyebrow">{t("collection")}</p>
          <h1>{t("library")}</h1>
        </div>
        <Link to="/upload" className="primary">
          <Plus />
          {t("upload")}
        </Link>
      </div>
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "me"}
          onClick={() => setTab("me")}
        >
          {t("uploads")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "shared"}
          onClick={() => setTab("shared")}
        >
          {t("shared")}
        </button>
      </div>
      {state === "loading" ? (
        <div className="book-grid" aria-label="Loading books">
          {[1, 2, 3].map((n) => (
            <div className="book-card skeleton" key={n} />
          ))}
        </div>
      ) : state === "error" ? (
        <ErrorState message="Could not load your library." />
      ) : shown.length ? (
        <div className="book-grid">
          {shown.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      ) : tab === "shared" ? (
        <SharedUnavailable />
      ) : (
        <EmptyLibrary />
      )}
    </main>
  );
}
function EmptyLibrary() {
  const { t } = useI18n();
  return (
    <section className="empty-state">
      <div className="empty-icon">
        <BookOpen />
      </div>
      <h2>{t("emptyTitle")}</h2>
      <p>{t("emptyBody")}</p>
      <Link to="/upload" className="primary">
        <Upload />
        {t("upload")}
      </Link>
    </section>
  );
}
function SharedUnavailable() {
  const { t } = useI18n();
  return (
    <section className="empty-state">
      <div className="empty-icon">
        <Library />
      </div>
      <h2>{t("sharedComing")}</h2>
      <p>{t("sharedComingBody")}</p>
    </section>
  );
}
function BookCard({ book }: { book: Book }) {
  return (
    <Link
      className="book-card"
      to={book.status === "ready" ? `/books/${book.id}` : `/jobs/${book.id}`}
    >
      <div className="book-cover">
        {book.coverUrl ? <img src={book.coverUrl} alt="" /> : <span>ཨ</span>}
        {book.status !== "ready" && (
          <span className={`status ${book.status}`}>{book.status}</span>
        )}
      </div>
      <div className="book-info">
        <h2>{book.title}</h2>
        <p>{book.author || `${book.pageCount} pages`}</p>
        {book.status !== "ready" && (
          <progress
            aria-label={`${book.title} processing progress`}
            max="100"
            value={book.progress || 0}
          />
        )}
        <div className="book-meta">
          <span>{book.pageCount} pages</span>
          <ChevronRight />
        </div>
      </div>
    </Link>
  );
}

function UploadPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function pick(event: ChangeEvent<HTMLInputElement>) {
    const all = Array.from(event.target.files || []);
    const valid = all.filter(
      (f) => f.type === "application/pdf" || f.type.startsWith("image/"),
    );
    const invalidMix =
      valid.length > 1 && valid.some((f) => f.type === "application/pdf");
    setFiles(invalidMix ? [] : valid);
    if (valid.length && !title) setTitle(valid[0].name.replace(/\.[^.]+$/, ""));
    setError(
      invalidMix
        ? "Choose one PDF or a collection of images, not both."
        : valid.length < all.length
          ? "Only PDF and image files are supported."
          : "",
    );
  }
  async function upload() {
    setBusy(true);
    setError("");
    try {
      let uploadFile = files[0];
      if (files.length > 1) {
        const entries = Object.fromEntries(
          await Promise.all(
            files.map(async (file, index) => [
              `${String(index + 1).padStart(4, "0")}-${file.name}`,
              new Uint8Array(await file.arrayBuffer()),
            ]),
          ),
        );
        const archive = zipSync(entries);
        uploadFile = new File([archive.buffer as ArrayBuffer], "pages.zip", {
          type: "application/zip",
        });
      }
      const signed = await api.createUpload({
        filename: uploadFile.name,
        contentType: uploadFile.type,
        size: uploadFile.size,
      });
      await api.putFile(signed, uploadFile, setProgress);
      const job = await api.startProcessing(
        signed,
        title.trim() || files[0].name.replace(/\.[^.]+$/, ""),
      );
      navigate(`/jobs/${job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
    }
  }
  return (
    <main className="container narrow">
      <Link to="/library" className="back">
        <ArrowLeft />
        {t("backLibrary")}
      </Link>
      <p className="eyebrow">{t("newAudiobook")}</p>
      <h1>{t("uploadTitle")}</h1>
      <p className="lead">{t("uploadHelp")}</p>
      <label>
        {t("bookTitle")}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={300}
          placeholder={t("bookTitle")}
        />
      </label>
      <label className="dropzone">
        <input type="file" accept=".pdf,image/*" multiple onChange={pick} />
        <div className="empty-icon">
          <Upload />
        </div>
        <strong>{t("chooseFiles")}</strong>
        <span>PDF, PNG, JPEG, WebP · up to 50 MB</span>
      </label>
      {!!files.length && (
        <section className="file-list">
          <div className="section-heading">
            <h2>
              {files.length} file{files.length > 1 ? "s" : ""} selected
            </h2>
            <button className="text-button" onClick={() => setFiles([])}>
              Clear
            </button>
          </div>
          {files.map((file, i) => (
            <div className="file-row" key={file.name + i}>
              {file.type === "application/pdf" ? <FileText /> : <FileImage />}
              <span>
                <strong>{file.name}</strong>
                <small>{(file.size / 1048576).toFixed(1)} MB</small>
              </span>
              {files.length > 1 && <em>{t("page")} {i + 1}</em>}
            </div>
          ))}
        </section>
      )}
      {busy && (
        <div className="progress-block" aria-live="polite">
          <div>
            <span>{t("uploading")}</span>
            <strong>{progress}%</strong>
          </div>
          <progress max="100" value={progress} />
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary full"
        disabled={!files.length || !title.trim() || busy}
        onClick={upload}
      >
        {busy ? t("uploading") : t("uploadAction")}
      </button>
    </main>
  );
}

function ProcessingPage() {
  const { id = "" } = useParams(),
    navigate = useNavigate();
  const { t } = useI18n();
  const [job, setJob] = useState<ProcessingJob>({
    id,
    status: "processing",
    progress: 5,
  });
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const next = await api.getJob(id);
        if (stop) return;
        setJob(next);
        if (next.status === "completed" && next.bookId)
          navigate(`/books/${next.bookId}`, { replace: true });
        else if (next.status !== "failed") setTimeout(poll, 1200);
      } catch {
        setJob((j) => ({ ...j, status: "failed" }));
      }
    };
    poll();
    return () => {
      stop = true;
    };
  }, [id, navigate]);
  return (
    <main className="center-screen processing">
      <div className="processing-orbit">
        <BookOpen />
        <span>{job.progress}%</span>
      </div>
      <p className="eyebrow">{t("makingAudiobook")}</p>
      <h1>
        {job.status === "failed" ? t("processingStopped") : t("processing")}
      </h1>
      <p className="muted">{t("processingHelp")}</p>
      <progress max="100" value={job.progress} />
      <Link to="/library" className="secondary">
        {t("returnLibrary")}
      </Link>
    </main>
  );
}

function DetailsPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [book, setBook] = useState<Book | null>(null),
    [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState("");
  useEffect(() => {
    api
      .getBook(id)
      .then(setBook)
      .catch((e) => setError(e.message));
  }, [id]);
  const deleteBook = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteBook(id);
      navigate("/library", { replace: true });
    } catch {
      setDeleteError(t("deleteFailed"));
      setDeleting(false);
    }
  };
  if (error) return <ErrorState message={error} />;
  if (!book) return <div className="center-screen">{t("openingBook")}</div>;
  return (
    <main className="container">
      <Link to="/library" className="back">
        <ArrowLeft />
        {t("library")}
      </Link>
      <section className="book-hero">
        <div className="book-cover large">
          {book.coverUrl ? <img src={book.coverUrl} alt="" /> : <span>ཨ</span>}
        </div>
        <div>
          <p className="eyebrow">{t("audiobook")}</p>
          <h1>{book.title}</h1>
          <p className="lead">{book.author}</p>
          <p className="muted">
            {book.pageCount} pages · Updated{" "}
            {new Date(book.updatedAt).toLocaleDateString()}
          </p>
          <div className="actions">
            <Link to={`/books/${book.id}/read`} className="primary">
              <Play />
              {t("startListening")}
            </Link>
            <button
              className="secondary"
              disabled
              title={t("sharedComingBody")}
            >
              <Share2 />
              {t("sharedComing")}
            </button>
            <button
              className="danger-button"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
              {t("deleteBook")}
            </button>
          </div>
        </div>
      </section>
      <section className="toc">
        <div className="section-heading">
          <h2>{t("availablePages")}</h2>
          <span>
            {book.pages?.length || 0} of {book.pageCount}
          </span>
        </div>
        {book.pages?.map((page) => (
          <Link
            key={page.id}
            to={`/books/${book.id}/read?page=${page.pageNumber}`}
          >
            <span className="page-number">
              {String(page.pageNumber).padStart(2, "0")}
            </span>
            <span>
              <strong>{page.title || `${t("page")} ${page.pageNumber}`}</strong>
              <small>{page.segments.length} sentences</small>
            </span>
            <ChevronRight />
          </Link>
        ))}
      </section>
      {confirmDelete && (
        <DeleteBookModal
          title={book.title}
          busy={deleting}
          error={deleteError}
          close={() => !deleting && setConfirmDelete(false)}
          confirm={deleteBook}
        />
      )}
    </main>
  );
}

function DeleteBookModal({
  title,
  busy,
  error,
  close,
  confirm,
}: {
  title: string;
  busy: boolean;
  error: string;
  close(): void;
  confirm(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-book-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="section-heading">
          <h2 id="delete-book-title">{t("deleteBook")}</h2>
          <button
            className="icon-button"
            aria-label="Close"
            onClick={close}
            disabled={busy}
          >
            <X />
          </button>
        </div>
        <p className="muted">{t("deleteBookHelp")}</p>
        <p>
          <strong>{title}</strong>
        </p>
        {error && <p className="error-text">{error}</p>}
        <div className="actions end">
          <button className="secondary" onClick={close} disabled={busy}>
            {t("cancel")}
          </button>
          <button
            className="danger-button"
            onClick={confirm}
            disabled={busy}
          >
            <Trash2 />
            {busy ? t("deleting") : t("deleteBook")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ReaderPage() {
  const { id = "" } = useParams(),
    navigate = useNavigate();
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [book, setBook] = useState<Book | null>(null),
    [error, setError] = useState("");
  const [pageIndex, setPageIndex] = useState(0),
    [segmentIndex, setSegmentIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(store.get("dadhep.speed", 1)),
    [elapsed, setElapsed] = useState(0),
    [sleep, setSleep] = useState(0);
  const [fontSize, setFontSize] = useState(store.get("dadhep.font", 25)),
    [correcting, setCorrecting] = useState<SentenceSegment | null>(null),
    [regenerating, setRegenerating] = useState<string[]>([]);
  const audio = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef(0);
  useEffect(() => {
    api
      .getBook(id)
      .then(setBook)
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => {
    if (!book?.pages) return;
    const requested = Number(searchParams.get("page"));
    const index = book.pages.findIndex((item) => item.pageNumber === requested);
    if (index >= 0) setPageIndex(index);
  }, [book, searchParams]);
  const page = book?.pages?.[pageIndex],
    segment = page?.segments[segmentIndex],
    total = page?.segments.reduce((a, s) => a + s.durationMs, 0) || 1,
    before =
      page?.segments
        .slice(0, segmentIndex)
        .reduce((a, s) => a + s.durationMs, 0) || 0;
  const seekPosition = (target: number) => {
    if (!page) return;
    let cursor = 0;
    const index = Math.max(
      0,
      page.segments.findIndex((item) => {
        if (target <= cursor + item.durationMs) return true;
        cursor += item.durationMs;
        return false;
      }),
    );
    const offset = Math.max(0, target - cursor);
    pendingSeek.current = offset;
    setSegmentIndex(index);
    setElapsed(offset);
    if (index === segmentIndex && audio.current) {
      audio.current.currentTime = offset / 1000;
      pendingSeek.current = 0;
    }
  };
  useEffect(() => {
    if (!playing || !segment) return;
    const start = Date.now() - elapsed / speed;
    const timer = setInterval(() => {
      const next = (Date.now() - start) * speed;
      if (next >= segment.durationMs) {
        setElapsed(0);
        if (segmentIndex < (page?.segments.length || 0) - 1)
          setSegmentIndex((i) => i + 1);
        else if (book?.pages && pageIndex < book.pages.length - 1) {
          setPageIndex((i) => i + 1);
          setSegmentIndex(0);
        } else setPlaying(false);
      } else setElapsed(next);
    }, 250);
    return () => clearInterval(timer);
  }, [playing, segment, segmentIndex, page, pageIndex, book, speed, elapsed]);
  useEffect(() => {
    if (!sleep || !playing) return;
    const timer = setTimeout(() => setPlaying(false), sleep * 60000);
    return () => clearTimeout(timer);
  }, [sleep, playing]);
  useEffect(() => {
    if (book)
      setGlobalPlayer?.({
        book,
        page: pageIndex,
        segment: segmentIndex,
        playing,
      });
  }, [book, pageIndex, segmentIndex, playing]);
  useEffect(() => {
    const element = audio.current;
    if (!element || !segment?.audioUrl) return;
    element.src = segment.audioUrl;
    const start = () => {
      if (pendingSeek.current) {
        element.currentTime = pendingSeek.current / 1000;
        pendingSeek.current = 0;
      }
    };
    if (element.readyState >= 1) start();
    else element.addEventListener("loadedmetadata", start, { once: true });
    return () => element.removeEventListener("loadedmetadata", start);
  }, [segment]);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    const element = audio.current;
    if (!element || !segment?.audioUrl) return;
    if (playing) element.play().catch(() => setPlaying(false));
    else element.pause();
  }, [playing, segment]);
  if (error) return <ErrorState message={error} />;
  if (!book || !page || !segment)
    return <div className="center-screen">{t("openingBook")}</div>;
  const saveBookmark = () => {
    const items = store.get<SavedBookmark[]>("dadhep.bookmarks", []);
    items.push({
      id: crypto.randomUUID(),
      bookId: book.id,
      pageNumber: page.pageNumber,
      segmentId: segment.id,
      label: segment.text.slice(0, 48),
      createdAt: new Date().toISOString(),
    });
    store.set("dadhep.bookmarks", items);
  };
  const submitCorrection = async (text: string) => {
    if (!correcting) return;
    const sid = correcting.id;
    setRegenerating((v) => [...v, sid]);
    const correctedPage = page.segments
      .map((item) => (item.id === correcting.id ? text : item.text))
      .join(" ");
    await api.correctSegment({
      bookId: book.id,
      pageNumber: page.pageNumber,
      correctedText: correctedPage,
    });
    setCorrecting(null);
    api
      .waitForPage(book.id, page.pageNumber)
      .then((nextPage) =>
        setBook((current) =>
          current
            ? {
                ...current,
                pages: current.pages?.map((item) =>
                  item.pageNumber === nextPage.pageNumber ? nextPage : item,
                ),
              }
            : current,
        ),
      )
      .catch(() => setError("The corrected audio could not be regenerated."))
      .finally(() => setRegenerating((v) => v.filter((x) => x !== sid)));
  };
  return (
    <div className="reader">
      <header className="reader-header">
        <button
          className="icon-button"
          aria-label={t("back")}
          onClick={() => navigate(`/books/${book.id}`)}
        >
          <ArrowLeft />
        </button>
        <div>
          <strong>{book.title}</strong>
          <span>
            {t("page")} {page.pageNumber} / {book.pageCount}
          </span>
        </div>
        <button className="icon-button" aria-label="More options">
          <MoreVertical />
        </button>
      </header>
      <main className="reading-area">
        <div className="reader-tools">
          <button
            className="icon-button"
            aria-label={t("previousPage")}
            disabled={pageIndex === 0}
            onClick={() => {
              setPageIndex((value) => Math.max(0, value - 1));
              setSegmentIndex(0);
            }}
          >
            <ArrowLeft />
          </button>
          <label>
            {t("page")}
            <select
              aria-label={t("page")}
              value={pageIndex}
              onChange={(e) => {
                setPageIndex(Number(e.target.value));
                setSegmentIndex(0);
              }}
            >
              {book.pages?.map((p, i) => (
                <option value={i} key={p.id}>
                  {p.pageNumber}
                </option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            aria-label={t("nextPage")}
            disabled={pageIndex >= (book.pages?.length || 1) - 1}
            onClick={() => {
              setPageIndex((value) =>
                Math.min((book.pages?.length || 1) - 1, value + 1),
              );
              setSegmentIndex(0);
            }}
          >
            <ChevronRight />
          </button>
          <div className="font-control">
            <button
              onClick={() => {
                const n = Math.max(18, fontSize - 2);
                setFontSize(n);
                store.set("dadhep.font", n);
              }}
            >
              A−
            </button>
            <button
              onClick={() => {
                const n = Math.min(40, fontSize + 2);
                setFontSize(n);
                store.set("dadhep.font", n);
              }}
            >
              A+
            </button>
          </div>
          <button
            className="icon-button"
            aria-label={t("addBookmark")}
            onClick={saveBookmark}
          >
            <Bookmark />
          </button>
        </div>
        <article className="page-paper" style={{ fontSize }}>
          <p className="page-label">{page.title}</p>
          {page.segments.map((item, i) => (
            <button
              key={item.id}
              className={`sentence ${i === segmentIndex ? "active" : ""}`}
              onClick={() => {
                setSegmentIndex(i);
                setElapsed(0);
              }}
              onDoubleClick={() => setCorrecting(item)}
            >
              {item.text}
              {regenerating.includes(item.id) && (
                <span className="regenerating">
                  <RotateCcw />
                  {t("regenerating")}
                </span>
              )}
            </button>
          ))}
          <p className="correction-hint">{t("correctionHint")}</p>
        </article>
      </main>
      <section className="player-controls">
        <div className="scrub-labels">
          <span>{time(before + elapsed)}</span>
          <span>{time(total)}</span>
        </div>
        <input
          className="scrubber"
          aria-label={t("audioPosition")}
          type="range"
          min="0"
          max={total}
          value={Math.min(before + elapsed, total)}
          onChange={(event) => seekPosition(Number(event.target.value))}
        />
        <div className="transport">
          <button
            aria-label={t("previousSentence")}
            onClick={() => {
              setSegmentIndex(Math.max(0, segmentIndex - 1));
              setElapsed(0);
            }}
          >
            <SkipBack />
          </button>
          <button
            className="main-play"
            aria-label={playing ? t("pause") : t("play")}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button
            aria-label={t("nextSentence")}
            onClick={() => {
              setSegmentIndex(
                Math.min(page.segments.length - 1, segmentIndex + 1),
              );
              setElapsed(0);
            }}
          >
            <SkipForward />
          </button>
        </div>
        <div className="player-options">
          <label>
            <Gauge />
            {t("playbackSpeed")}
            <select
              aria-label={t("playbackSpeed")}
              value={speed}
              onChange={(e) => {
                const next = Number(e.target.value);
                setSpeed(next);
                store.set("dadhep.speed", next);
              }}
            >
              {[0.75, 1, 1.25, 1.5, 2].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            <Moon />
            {t("sleepTimer")}
            <select
              aria-label={t("sleepTimer")}
              value={sleep}
              onChange={(e) => setSleep(Number(e.target.value))}
            >
              <option value="0">{t("off")}</option>
              <option value="5">5 min</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
            </select>
          </label>
        </div>
      </section>
      <audio ref={audio} />
      {correcting && (
        <CorrectionModal
          segment={correcting}
          close={() => setCorrecting(null)}
          submit={submitCorrection}
        />
      )}
    </div>
  );
}
function CorrectionModal({
  segment,
  close,
  submit,
}: {
  segment: SentenceSegment;
  close(): void;
  submit(x: string): void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(segment.text);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="correction-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="section-heading">
          <h2 id="correction-title">{t("correctSentence")}</h2>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <X />
          </button>
        </div>
        <p className="muted">{t("correctionHelp")}</p>
        <label>
          {t("correctedText")}
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
          />
        </label>
        <div className="actions end">
          <button className="secondary" onClick={close}>
            {t("cancel")}
          </button>
          <button
            className="primary"
            disabled={!text.trim() || text.trim() === segment.text.trim()}
            onClick={() => submit(text.trim())}
          >
            {t("submitCorrection")}
          </button>
        </div>
      </section>
    </div>
  );
}

function BookmarksPage() {
  const { t } = useI18n();
  const [items, setItems] = useState(() =>
    store.get<SavedBookmark[]>("dadhep.bookmarks", []),
  );
  return (
    <main className="container narrow">
      <p className="eyebrow">{t("savedPlaces")}</p>
      <h1>{t("bookmarks")}</h1>
      {items.length ? (
        <div className="bookmark-list">
          {items.map((item) => (
            <div className="file-row" key={item.id}>
              <Bookmark />
              <Link to={`/books/${item.bookId}/read`}>
                <strong>{item.label}</strong>
                <small>{t("page")} {item.pageNumber}</small>
              </Link>
              <button
                className="icon-button"
                aria-label="Remove bookmark"
                onClick={() => {
                  const next = items.filter((x) => x.id !== item.id);
                  setItems(next);
                  store.set("dadhep.bookmarks", next);
                }}
              >
                <X />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <div className="empty-icon">
            <Bookmark />
          </div>
          <h2>{t("noBookmarks")}</h2>
          <p>{t("noBookmarksBody")}</p>
        </section>
      )}
    </main>
  );
}
function SettingsPage() {
  const { user, signOut, mode } = useAuth(),
    { language, setLanguage, t } = useI18n();
  const [voice, setVoice] = useState(store.get("dadhep.voice", "lhasaFemale")),
    [defaultSpeed, setDefaultSpeed] = useState(store.get("dadhep.speed", 1));
  return (
    <main className="container narrow">
      <p className="eyebrow">{t("preferences")}</p>
      <h1>{t("settings")}</h1>
      <section className="settings-card">
        <div className="setting-row">
          <div>
            <strong>{t("account")}</strong>
            <span>{user?.email}</span>
          </div>
          <span className="pill">
            {mode === "mock" ? "Local mock" : "Cognito"}
          </span>
        </div>
        <div className="setting-row">
          <div>
            <strong>
              <Languages />
              {t("language")}
            </strong>
            <span>{t("languageHelp")}</span>
          </div>
          <select
            aria-label={t("language")}
            value={language}
            onChange={(e) => setLanguage(e.target.value as "en" | "bo")}
          >
            <option value="en">English</option>
            <option value="bo">བོད་ཡིག</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>{t("ttsVoice")}</strong>
            <span>{t("voiceHelp")}</span>
          </div>
          <select
            aria-label={t("ttsVoice")}
            value={voice}
            onChange={(e) => {
              setVoice(e.target.value);
              store.set("dadhep.voice", e.target.value);
            }}
          >
            <option value="lhasa_female">{t("lhasaFemale")}</option>
            <option value="lhasa_male">{t("lhasaMale")}</option>
            <option value="amdo_female">{t("amdoFemale")}</option>
            <option value="amdo_male">{t("amdoMale")}</option>
            <option value="kham_female">{t("khamFemale")}</option>
            <option value="kham_male">{t("khamMale")}</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>{t("defaultSpeed")}</strong>
            <span>{t("speedHelp")}</span>
          </div>
          <select
            aria-label={t("defaultSpeed")}
            value={defaultSpeed}
            onChange={(e) => {
              const value = Number(e.target.value);
              setDefaultSpeed(value);
              store.set("dadhep.speed", value);
            }}
          >
            {[0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </div>
        <button className="danger-button" onClick={signOut}>
          {t("signOut")}
        </button>
      </section>
    </main>
  );
}
function ErrorState({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <main className="center-screen">
      <CircleAlert className="error-icon" />
      <h1>{t("somethingWrong")}</h1>
      <p className="muted">{message}</p>
      <Link to="/library" className="secondary">
        {t("goLibrary")}
      </Link>
    </main>
  );
}
function NotFound() {
  const { t } = useI18n();
  return (
    <main className="center-screen">
      <p className="eyebrow">404</p>
      <h1>{t("pageNotFound")}</h1>
      <Link to="/library" className="primary">
        {t("backLibrary")}
      </Link>
    </main>
  );
}
const time = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="*"
              element={
                <ProtectedRoute>
                  <Shell>
                    <Routes>
                      <Route path="/" element={<LibraryPage />} />
                      <Route path="/library" element={<LibraryPage />} />
                      <Route path="/upload" element={<UploadPage />} />
                      <Route path="/jobs/:id" element={<ProcessingPage />} />
                      <Route path="/books/:id" element={<DetailsPage />} />
                      <Route path="/books/:id/read" element={<ReaderPage />} />
                      <Route path="/bookmarks" element={<BookmarksPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Shell>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
