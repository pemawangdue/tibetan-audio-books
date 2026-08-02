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
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileImage,
  FileText,
  Gauge,
  Languages,
  Library,
  Menu,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Share2,
  AudioLines,
  Calendar,
  Clock,
  Headphones,
  Send,
  SkipBack,
  SkipForward,
  Sparkles,
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
  BookPage,
  Bookmark as SavedBookmark,
  ChatMessage,
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
              {
                player.book.pages?.find((item) => item.pageNumber === player.page)
                  ?.segments[player.segment]?.text
              }
            </span>
          </Link>
          <span>
            {player.page}/{player.book.pageCount}
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
  const [query, setQuery] = useState("");
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
  const inTab = books.filter((book) => book.owner === tab);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? inTab.filter(
        (book) =>
          book.title.toLowerCase().includes(needle) ||
          (book.author || "").toLowerCase().includes(needle),
      )
    : inTab;
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
      <label className="library-search">
        <Search />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchLibrary")}
          aria-label={t("searchLibrary")}
        />
      </label>
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
        <BookScroller key="loading" ariaLabel="Loading books">
          {[1, 2, 3, 4].map((n) => (
            <div className="book-card skeleton" key={n} />
          ))}
        </BookScroller>
      ) : state === "error" ? (
        <ErrorState message="Could not load your library." />
      ) : inTab.length ? (
        shown.length ? (
          <BookScroller key={tab} ariaLabel={t("library")}>
            {shown.map((book, index) => (
              <BookCard key={book.id} book={book} index={index} />
            ))}
          </BookScroller>
        ) : (
          <p className="muted library-search-empty">{t("noSearchResults")}</p>
        )
      ) : tab === "shared" ? (
        <SharedUnavailable />
      ) : (
        <EmptyLibrary />
      )}
    </main>
  );
}

function BookScroller({
  children,
  ariaLabel,
}: {
  children: ReactNode;
  ariaLabel: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = () => {
    const track = trackRef.current;
    if (!track) return;
    const maxScroll = track.scrollWidth - track.clientWidth;
    setCanScrollLeft(track.scrollLeft > 4);
    setCanScrollRight(track.scrollLeft < maxScroll - 4);
  };

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const frame = requestAnimationFrame(updateScrollState);
    const onScroll = () => updateScrollState();
    track.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateScrollState);
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateScrollState);
      observer.disconnect();
    };
  }, [children]);

  const scrollByCards = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector(".book-card") as HTMLElement | null;
    const step = card ? card.offsetWidth + 18 : track.clientWidth * 0.75;
    track.scrollBy({ left: direction * step * 2, behavior: "smooth" });
  };

  return (
    <div className="book-scroller">
      <button
        type="button"
        className="book-scroll-btn prev"
        aria-label="Scroll left"
        disabled={!canScrollLeft}
        onClick={() => scrollByCards(-1)}
      >
        <ChevronLeft />
      </button>
      <div className="book-scroller-track" ref={trackRef} aria-label={ariaLabel}>
        {children}
      </div>
      <button
        type="button"
        className="book-scroll-btn next"
        aria-label="Scroll right"
        disabled={!canScrollRight}
        onClick={() => scrollByCards(1)}
      >
        <ChevronRight />
      </button>
    </div>
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
function BookCard({ book, index = 0 }: { book: Book; index?: number }) {
  const inProgress = book.status !== "ready" && book.status !== "failed";
  return (
    <Link
      className="book-card book-card-enter from-bottom"
      style={{ animationDelay: `${Math.min(index, 10) * 70}ms` }}
      to={book.status === "ready" ? `/books/${book.id}` : `/jobs/${book.id}`}
    >
      <div className={`book-cover${book.coverUrl ? "" : " no-cover"}`}>
        {book.coverUrl ? <img src={book.coverUrl} alt="" /> : <span>ཨ</span>}
        {book.status !== "ready" && (
          <span
            className={`status ${book.status}${inProgress ? " status-live" : ""}`}
          >
            {book.status}
            {inProgress ? ` · ${book.progress || 0}%` : ""}
          </span>
        )}
      </div>
      <div className="book-info">
        <h2>{book.title}</h2>
        {book.author && <p>{book.author}</p>}
        <div className="book-meta">
          <span>{book.pageCount} pages</span>
          <ChevronRight />
        </div>
      </div>
    </Link>
  );
}

function titleFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_, oct) =>
      String.fromCharCode(Number.parseInt(oct, 8)),
    )
    .trim();
}

function decodePdfHexTitle(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length < 4 || clean.length % 2 !== 0) return "";
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const chars: string[] = [];
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      chars.push(String.fromCharCode((bytes[i] << 8) | bytes[i + 1]));
    }
    return chars.join("").trim();
  }
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("").trim();
}

function findPdfTitleInBytes(bytes: Uint8Array): string | null {
  let text = "";
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
  const literal = text.match(/\/Title\s*\(((?:\\.|[^\\)])*)\)/);
  if (literal?.[1]) {
    const decoded = decodePdfLiteral(literal[1]);
    if (decoded) return decoded;
  }
  const hex = text.match(/\/Title\s*<([0-9A-Fa-f\s]+)>/);
  if (hex?.[1]) {
    const decoded = decodePdfHexTitle(hex[1]);
    if (decoded) return decoded;
  }
  return null;
}

async function titleFromPdf(file: File): Promise<string | null> {
  const headSize = Math.min(file.size, 512 * 1024);
  const head = new Uint8Array(await file.slice(0, headSize).arrayBuffer());
  const fromHead = findPdfTitleInBytes(head);
  if (fromHead) return fromHead;
  if (file.size <= headSize) return null;
  const tailStart = Math.max(0, file.size - 128 * 1024);
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  return findPdfTitleInBytes(tail);
}

function UploadPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const all = Array.from(event.target.files || []);
    const valid = all.filter(
      (f) => f.type === "application/pdf" || f.type.startsWith("image/"),
    );
    const invalidMix =
      valid.length > 1 && valid.some((f) => f.type === "application/pdf");
    setFiles(invalidMix ? [] : valid);
    if (!invalidMix && valid.length) {
      const fallback = titleFromFilename(valid[0].name);
      setTitle(fallback);
      if (valid[0].type === "application/pdf") {
        const pdfTitle = await titleFromPdf(valid[0]);
        if (pdfTitle) setTitle(pdfTitle.slice(0, 300));
      }
    }
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
        title.trim() || titleFromFilename(files[0].name),
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
      <label className="upload-title-field">
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

const DETAILS_PAGE_BATCH = 10;
const READER_PAGE_BATCH = 10;

function pageBatchAround(ready: number[], focusPage: number, size: number) {
  if (!ready.length) return [];
  let focusIdx = ready.indexOf(focusPage);
  if (focusIdx < 0) focusIdx = 0;
  const start = Math.max(
    0,
    Math.min(focusIdx, Math.max(0, ready.length - size)),
  );
  return ready.slice(start, start + size);
}

function mergeBookPages(existing: BookPage[] | undefined, incoming: BookPage[]) {
  const map = new Map((existing || []).map((page) => [page.pageNumber, page]));
  for (const page of incoming) map.set(page.pageNumber, page);
  return [...map.values()].sort((a, b) => a.pageNumber - b.pageNumber);
}

/** Bare shad / punctuation-only segments should not be read aloud. */
function isSkippableReadingText(text: string): boolean {
  return text.trim() === "།";
}

function findReadableSegmentIndex(
  segments: SentenceSegment[],
  from: number,
  direction: 1 | -1,
): number | null {
  let index = from;
  while (index >= 0 && index < segments.length) {
    if (!isSkippableReadingText(segments[index].text)) return index;
    index += direction;
  }
  return null;
}

function DetailsPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [book, setBook] = useState<Book | null>(null),
    [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState(""),
    [readyPages, setReadyPages] = useState<number[]>([]),
    [loadingMore, setLoadingMore] = useState(false);
  const tocSentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const loadedCountRef = useRef(0);
  const readyPagesRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    setBook(null);
    setReadyPages([]);
    readyPagesRef.current = [];
    loadedCountRef.current = 0;
    setError("");
    api
      .getBook(id, { loadPages: false })
      .then(async (next) => {
        if (cancelled) return;
        const ready = next.readyPages || [];
        readyPagesRef.current = ready;
        setReadyPages(ready);
        const firstBatch = ready.slice(0, DETAILS_PAGE_BATCH);
        if (!firstBatch.length) {
          setBook(next);
          return;
        }
        const pages = await api.getBookPages(id, firstBatch);
        if (cancelled) return;
        loadedCountRef.current = pages.length;
        setBook({ ...next, pages });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const loadMorePages = async () => {
    if (loadingMoreRef.current) return;
    const loadedCount = loadedCountRef.current;
    const nextNumbers = readyPagesRef.current.slice(
      loadedCount,
      loadedCount + DETAILS_PAGE_BATCH,
    );
    if (!nextNumbers.length) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const pages = await api.getBookPages(id, nextNumbers);
      loadedCountRef.current = loadedCount + pages.length;
      setBook((current) => {
        if (!current) return current;
        const merged = [...(current.pages || []), ...pages].sort(
          (a, b) => a.pageNumber - b.pageNumber,
        );
        return { ...current, pages: merged };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("somethingWrong"));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const loadedCount = book?.pages?.length || 0;
  const hasMorePages = loadedCount < readyPages.length;

  useEffect(() => {
    const sentinel = tocSentinelRef.current;
    if (!sentinel || !book || !hasMorePages) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMorePages();
        }
      },
      { root: null, rootMargin: "240px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [book, hasMorePages, loadedCount, id]);

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
  const showChat = book.status === "ready";
  return (
    <main className={`details-page${showChat ? " has-chat" : ""}`}>
      <div className="container details-container">
        <div className="details-layout">
          <div className="details-main">
            <Link to="/library" className="back">
              <ArrowLeft />
              {t("backLibrary")}
            </Link>
            <section className="book-hero">
              <Link
                to={`/books/${book.id}/read`}
                className="book-cover large"
                aria-label={t("startListening")}
              >
                {book.coverUrl ? (
                  <img src={book.coverUrl} alt="" />
                ) : (
                  <span>ཨ</span>
                )}
                <span className="cover-preview">
                  <Play />
                  {t("preview")}
                </span>
              </Link>
              <div className="book-hero-copy">
                <p className="eyebrow badge">{t("audiobook")}</p>
                <h1>{book.title}</h1>
                {book.author && <p className="lead">{book.author}</p>}
                <p className="book-hero-meta muted">
                  <span>
                    {book.pageCount} {t("pagesLabel")}
                  </span>
                  <span className="meta-sep">·</span>
                  <span className="meta-with-icon">
                    <Calendar />
                    {t("updated")} {new Date(book.updatedAt).toLocaleDateString()}
                  </span>
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
            <BookAboutCard book={book} />
            <section className="toc">
              <div className="section-heading">
                <h2>{t("availablePages")}</h2>
                <span>
                  {loadedCount} of {readyPages.length || book.pageCount}
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
                    <strong>
                      {page.title || `${t("page")} ${page.pageNumber}`}
                    </strong>
                    <small>
                      {page.segments.length} {t("sentencesLabel")}
                    </small>
                  </span>
                  <ChevronRight />
                </Link>
              ))}
              {hasMorePages && (
                <div className="toc-sentinel" ref={tocSentinelRef}>
                  {loadingMore ? (
                    <p className="muted">{t("loadingMorePages")}</p>
                  ) : null}
                </div>
              )}
            </section>
          </div>
          {showChat && <BookChatPanel bookId={book.id} />}
        </div>
      </div>
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

const ASK_PROMPTS = [
  "askBookPrompt1",
  "askBookPrompt2",
  "askBookPrompt3",
  "askBookPrompt4",
  "askBookPrompt5",
] as const;

const VOICE_LABELS: Record<string, "lhasaFemale" | "lhasaMale" | "amdoFemale" | "amdoMale" | "khamFemale" | "khamMale"> = {
  lhasa_female: "lhasaFemale",
  lhasaFemale: "lhasaFemale",
  lhasa_male: "lhasaMale",
  lhasaMale: "lhasaMale",
  amdo_female: "amdoFemale",
  amdoFemale: "amdoFemale",
  amdo_male: "amdoMale",
  amdoMale: "amdoMale",
  kham_female: "khamFemale",
  khamFemale: "khamFemale",
  kham_male: "khamMale",
  khamMale: "khamMale",
};

function formatDuration(totalMs: number): string {
  const totalMinutes = Math.max(0, Math.round(totalMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${totalMinutes}m`;
  const seconds = Math.max(1, Math.round(totalMs / 1000));
  return `${seconds}s`;
}

function bookExcerpt(book: Book): string {
  const text = (book.pages || [])
    .flatMap((page) => page.segments.map((segment) => segment.text.trim()))
    .filter(Boolean)
    .join(" ");
  return text;
}

function bookDurationMs(book: Book): number {
  return (book.pages || []).reduce(
    (sum, page) =>
      sum + page.segments.reduce((pageSum, segment) => pageSum + segment.durationMs, 0),
    0,
  );
}

function BookAboutCard({ book }: { book: Book }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const excerpt = bookExcerpt(book);
  const collapseAt = 220;
  const needsToggle = excerpt.length > collapseAt;
  const visibleText =
    !needsToggle || expanded ? excerpt : `${excerpt.slice(0, collapseAt).trimEnd()}…`;
  const languageLabel =
    book.language === "en" ? t("languageEnglish") : t("languageTibetan");
  const voiceKey = book.ttsVoice ? VOICE_LABELS[book.ttsVoice] : undefined;
  const narrationLabel = voiceKey ? t(voiceKey) : t("voiceDefault");
  const durationLabel = formatDuration(bookDurationMs(book));
  const addedOn = new Date(book.createdAt || book.updatedAt).toLocaleDateString();

  return (
    <section className="book-about">
      <div className="section-heading">
        <h2>{t("aboutBook")}</h2>
      </div>
      {excerpt ? (
        <>
          <p className="book-about-text">{visibleText}</p>
          {needsToggle && (
            <button
              type="button"
              className="text-button"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t("showLess") : t("showMore")}
            </button>
          )}
        </>
      ) : (
        <p className="muted">{book.author || book.title}</p>
      )}
      <div className="book-meta-tiles">
        <div className="book-meta-tile">
          <Headphones />
          <div>
            <span>{t("narration")}</span>
            <strong>{narrationLabel}</strong>
          </div>
        </div>
        <div className="book-meta-tile">
          <AudioLines />
          <div>
            <span>{t("language")}</span>
            <strong>{languageLabel}</strong>
          </div>
        </div>
        <div className="book-meta-tile">
          <Clock />
          <div>
            <span>{t("duration")}</span>
            <strong>{durationLabel}</strong>
          </div>
        </div>
        <div className="book-meta-tile">
          <Calendar />
          <div>
            <span>{t("addedOn")}</span>
            <strong>{addedOn}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function BookChatPanel({ bookId }: { bookId: string }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [citations, setCitations] = useState<number[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof el.scrollTo !== "function") return;
    el.scrollTo({ top: el.scrollHeight });
  }, [messages, busy, mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const send = async (text?: string) => {
    const message = (text ?? draft).trim();
    if (!message || busy) return;
    const history = messages.slice(-12);
    setDraft("");
    setError("");
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    try {
      const result = await api.chatBook(bookId, message, history);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.answer },
      ]);
      setCitations(result.citations);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("somethingWrong"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="book-chat-column">
      <button
        type="button"
        className="book-chat-fab"
        onClick={() => setMobileOpen(true)}
        aria-expanded={mobileOpen}
      >
        <Sparkles />
        <span>{t("askBook")}</span>
      </button>
      <button
        type="button"
        className={`book-chat-backdrop${mobileOpen ? " open" : ""}`}
        aria-label={t("closeChat")}
        onClick={() => setMobileOpen(false)}
      />
      <aside
        className={`book-chat${mobileOpen ? " mobile-open" : ""}`}
        aria-label={t("askBook")}
      >
        <header className="book-chat-header">
          <div className="book-chat-title">
            <Sparkles />
            <div>
              <strong>{t("askBook")}</strong>
              <small>{t("askBookHelp")}</small>
            </div>
          </div>
          <button
            type="button"
            className="icon-button book-chat-close"
            aria-label={t("closeChat")}
            onClick={() => setMobileOpen(false)}
          >
            <X />
          </button>
          <BookOpen className="book-chat-book-icon" aria-hidden="true" />
        </header>
        <div className="book-chat-panel">
          <div className="book-chat-messages" ref={listRef}>
            {!messages.length && !busy && (
              <>
                <div className="book-chat-bubble assistant">
                  {t("askBookEmpty")}
                </div>
                <div className="book-chat-prompts">
                  {ASK_PROMPTS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="book-chat-prompt"
                      disabled={busy}
                      onClick={() => void send(t(key))}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {messages.map((item, index) => (
              <div
                key={`${item.role}-${index}`}
                className={`book-chat-bubble ${item.role}`}
              >
                {item.content}
              </div>
            ))}
            {busy && (
              <p className="muted book-chat-status">{t("askBookThinking")}</p>
            )}
          </div>
          {!!citations.length && (
            <p className="book-chat-citations">
              {t("askBookCitations")}: {citations.join(", ")}
            </p>
          )}
          {error && <p className="error-text">{error}</p>}
          <form
            className="book-chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("askBookPlaceholder")}
              aria-label={t("askBookPlaceholder")}
              disabled={busy}
            />
            <button
              type="submit"
              className="book-chat-send"
              disabled={busy || !draft.trim()}
              aria-label={t("askBookSend")}
            >
              <Send />
            </button>
          </form>
          <p className="book-chat-disclaimer">{t("askBookDisclaimer")}</p>
        </div>
      </aside>
    </div>
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
    [error, setError] = useState(""),
    [readyPages, setReadyPages] = useState<number[]>([]);
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
  const activeSentenceRef = useRef<HTMLButtonElement>(null);
  const readyPagesRef = useRef<number[]>([]);
  const loadedPagesRef = useRef<Set<number>>(new Set());
  const inflightPagesRef = useRef<Set<number>>(new Set());
  const speedRef = useRef(speed);
  const playingRef = useRef(playing);
  const pageRef = useRef<BookPage | undefined>(undefined);
  const segmentIndexRef = useRef(0);
  const pageIndexRef = useRef(0);
  const readyCountRef = useRef(0);
  speedRef.current = speed;
  playingRef.current = playing;

  const loadReaderPages = async (pageNumbers: number[]) => {
    const needed = pageNumbers.filter(
      (pageNumber) =>
        !loadedPagesRef.current.has(pageNumber) &&
        !inflightPagesRef.current.has(pageNumber),
    );
    if (!needed.length) return;
    needed.forEach((pageNumber) => inflightPagesRef.current.add(pageNumber));
    try {
      const pages = await api.getBookPages(id, needed);
      pages.forEach((page) => loadedPagesRef.current.add(page.pageNumber));
      setBook((current) => {
        if (!current) return current;
        return { ...current, pages: mergeBookPages(current.pages, pages) };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("somethingWrong"));
    } finally {
      needed.forEach((pageNumber) =>
        inflightPagesRef.current.delete(pageNumber),
      );
    }
  };

  useEffect(() => {
    let cancelled = false;
    setBook(null);
    setReadyPages([]);
    setPageIndex(0);
    setSegmentIndex(0);
    setError("");
    readyPagesRef.current = [];
    loadedPagesRef.current = new Set();
    inflightPagesRef.current = new Set();
    api
      .getBook(id, { loadPages: false })
      .then((next) => {
        if (cancelled) return;
        const ready = next.readyPages || [];
        readyPagesRef.current = ready;
        setReadyPages(ready);
        setBook({ ...next, pages: [] });
        const requested = Number(searchParams.get("page"));
        const startNumber = ready.includes(requested) ? requested : ready[0];
        const startIndex = Math.max(0, ready.indexOf(startNumber));
        setPageIndex(startIndex >= 0 ? startIndex : 0);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!readyPages.length) return;
    const requested = Number(searchParams.get("page"));
    const index = readyPages.indexOf(requested);
    if (index >= 0) setPageIndex(index);
  }, [readyPages, searchParams]);

  const pageNumber = readyPages[pageIndex];
  useEffect(() => {
    if (!pageNumber) return;
    void loadReaderPages(
      pageBatchAround(readyPagesRef.current, pageNumber, READER_PAGE_BATCH),
    );
    const prefetchNumber =
      readyPagesRef.current[
        Math.min(readyPagesRef.current.length - 1, pageIndex + 3)
      ];
    if (prefetchNumber && prefetchNumber !== pageNumber) {
      void loadReaderPages(
        pageBatchAround(
          readyPagesRef.current,
          prefetchNumber,
          READER_PAGE_BATCH,
        ),
      );
    }
  }, [pageNumber, pageIndex, id]);

  useEffect(() => {
    const el = activeSentenceRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
      inline: "nearest",
    });
  }, [segmentIndex, pageIndex]);
  const page = book?.pages?.find((item) => item.pageNumber === pageNumber),
    segment = page?.segments[segmentIndex],
    total = page?.segments.reduce((a, s) => a + s.durationMs, 0) || 1,
    before =
      page?.segments
        .slice(0, segmentIndex)
        .reduce((a, s) => a + s.durationMs, 0) || 0;
  pageRef.current = page;
  segmentIndexRef.current = segmentIndex;
  pageIndexRef.current = pageIndex;
  readyCountRef.current = readyPages.length;

  const advancePlayback = () => {
    setElapsed(0);
    const currentPage = pageRef.current;
    const currentSegment = segmentIndexRef.current;
    const currentPageIndex = pageIndexRef.current;
    if (currentPage) {
      const nextReadable = findReadableSegmentIndex(
        currentPage.segments,
        currentSegment + 1,
        1,
      );
      if (nextReadable != null) {
        setSegmentIndex(nextReadable);
        return;
      }
    }
    if (currentPageIndex < readyCountRef.current - 1) {
      setPageIndex(currentPageIndex + 1);
      setSegmentIndex(0);
      return;
    }
    setPlaying(false);
  };

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
    if (!sleep || !playing) return;
    const timer = setTimeout(() => setPlaying(false), sleep * 60000);
    return () => clearTimeout(timer);
  }, [sleep, playing]);
  useEffect(() => {
    if (!page || !segment || !isSkippableReadingText(segment.text)) return;
    const nextReadable = findReadableSegmentIndex(
      page.segments,
      segmentIndex + (playing ? 1 : 0),
      1,
    );
    if (nextReadable != null && nextReadable !== segmentIndex) {
      setSegmentIndex(nextReadable);
      setElapsed(0);
      return;
    }
    if (playing) advancePlayback();
  }, [playing, segment?.id, segment?.text, pageIndex, page, segmentIndex]);
  useEffect(() => {
    if (book && pageNumber)
      setGlobalPlayer?.({
        book,
        page: pageNumber,
        segment: segmentIndex,
        playing,
      });
  }, [book, pageNumber, segmentIndex, playing]);
  useEffect(() => {
    const element = audio.current;
    if (!element || !segment?.audioUrl) return;
    if (isSkippableReadingText(segment.text)) return;

    const applyRate = () => {
      element.playbackRate = speedRef.current;
    };
    const applySeek = () => {
      if (!pendingSeek.current) return;
      element.currentTime = pendingSeek.current / 1000;
      pendingSeek.current = 0;
    };
    const onReady = () => {
      applyRate();
      applySeek();
      if (playingRef.current) {
        element.play().catch(() => setPlaying(false));
      }
    };
    const onTimeUpdate = () => {
      setElapsed(element.currentTime * 1000);
    };
    const onEnded = () => {
      advancePlayback();
    };

    element.pause();
    element.src = segment.audioUrl;
    applyRate();
    element.load();
    element.addEventListener("loadedmetadata", onReady);
    element.addEventListener("timeupdate", onTimeUpdate);
    element.addEventListener("ended", onEnded);
    if (element.readyState >= 1) onReady();

    return () => {
      element.removeEventListener("loadedmetadata", onReady);
      element.removeEventListener("timeupdate", onTimeUpdate);
      element.removeEventListener("ended", onEnded);
    };
  }, [segment?.id, segment?.audioUrl]);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    const element = audio.current;
    if (!element || !segment?.audioUrl) return;
    if (playing) {
      element.playbackRate = speedRef.current;
      if (element.paused) element.play().catch(() => setPlaying(false));
    } else {
      element.pause();
    }
  }, [playing, segment?.id]);
  if (error) return <ErrorState message={error} />;
  if (!book || !pageNumber)
    return <div className="center-screen">{t("openingBook")}</div>;
  const pageReady = Boolean(page && segment);
  const saveBookmark = () => {
    if (!page || !segment) return;
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
    if (!correcting || !page) return;
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
      <main className="container reading-area">
        <button
          type="button"
          className="back"
          onClick={() => navigate(`/books/${book.id}`)}
        >
          <ArrowLeft />
          {book.title}
        </button>
        <article className="page-paper" style={{ fontSize }}>
          {!page || !segment ? (
            <p className="muted">{t("loadingMorePages")}</p>
          ) : (
            <>
              {page.title && <p className="page-label">{page.title}</p>}
              {page.segments.map((item, i) => (
                <button
                  key={item.id}
                  ref={i === segmentIndex ? activeSentenceRef : undefined}
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
            </>
          )}
        </article>
      </main>
      <section className="player-controls" aria-label="Playback">
        <div className="player-card">
          <div className="player-tools">
            <div className="reader-page-nav">
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
                  {readyPages.map((number, i) => (
                    <option value={i} key={number}>
                      {number}
                    </option>
                  ))}
                </select>
              </label>
              <span className="muted reader-page-count">
                / {readyPages.length || book.pageCount}
              </span>
              <button
                className="icon-button"
                aria-label={t("nextPage")}
                disabled={pageIndex >= readyPages.length - 1}
                onClick={() => {
                  setPageIndex((value) =>
                    Math.min(readyPages.length - 1, value + 1),
                  );
                  setSegmentIndex(0);
                }}
              >
                <ChevronRight />
              </button>
            </div>
            <div className="reader-tools">
              <div className="font-control">
                <button
                  type="button"
                  onClick={() => {
                    const n = Math.max(18, fontSize - 2);
                    setFontSize(n);
                    store.set("dadhep.font", n);
                  }}
                >
                  A−
                </button>
                <button
                  type="button"
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
                type="button"
                className="player-bookmark"
                aria-label={t("addBookmark")}
                onClick={saveBookmark}
              >
                <Bookmark />
              </button>
            </div>
          </div>
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
              disabled={!pageReady}
              onClick={() => {
                if (!page) return;
                const previous = findReadableSegmentIndex(
                  page.segments,
                  segmentIndex - 1,
                  -1,
                );
                if (previous == null) return;
                setSegmentIndex(previous);
                setElapsed(0);
              }}
            >
              <SkipBack />
            </button>
            <button
              className="main-play"
              aria-label={playing ? t("pause") : t("play")}
              disabled={!pageReady}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause /> : <Play />}
            </button>
            <button
              aria-label={t("nextSentence")}
              disabled={!pageReady}
              onClick={() => {
                advancePlayback();
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
                  if (audio.current) audio.current.playbackRate = next;
                }}
              >
                {[0.75, 1, 1.25, 1.5, 2].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
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
    <main className="container">
      <p className="eyebrow">{t("savedPlaces")}</p>
      <h1>{t("bookmarks")}</h1>
      {items.length ? (
        <section className="content-card bookmark-list">
          <div className="section-heading">
            <h2>{t("savedPlaces")}</h2>
            <span>{items.length}</span>
          </div>
          {items.map((item) => (
            <div className="file-row bookmark-row" key={item.id}>
              <span className="bookmark-icon">
                <Bookmark />
              </span>
              <Link to={`/books/${item.bookId}/read`}>
                <strong>{item.label}</strong>
              </Link>
              <span className="bookmark-page muted">
                {t("page")} {item.pageNumber}
              </span>
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
        </section>
      ) : (
        <section className="content-card empty-state">
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
    <main className="container">
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
