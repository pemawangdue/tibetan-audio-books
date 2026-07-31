import type {
  Book,
  BookPage,
  CorrectionRequest,
  PresignedUpload,
  ProcessingJob,
  SentenceSegment,
  UploadRequest,
} from "./types";
import { apiUrl, mockApiEnabled } from "./config";

const API_URL = apiUrl;
const MOCK_API = mockApiEnabled;
const savedVoice = () => {
  try {
    return JSON.parse(localStorage.getItem("dadhep.voice") || '"default"');
  } catch {
    return "default";
  }
};

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let tokenProvider: () => Promise<string | null> = async () => null;
export const configureTokenProvider = (provider: typeof tokenProvider) => {
  tokenProvider = provider;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await tokenProvider();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.detail || body.message || `Request failed (${response.status})`,
      response.status,
      body.code,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

interface ApiBook {
  book_id: string;
  title: string;
  status:
    | "uploading"
    | "queued"
    | "splitting"
    | "processing"
    | "completed"
    | "partial"
    | "failed";
  total_pages: number;
  completed_pages: number;
  failed_pages: number;
  cover_url?: string;
  updated_at: string;
}

interface ApiPageSummary {
  page_number: number;
  status: "queued" | "processing" | "completed" | "correcting" | "failed";
}

interface ApiProgress {
  book_id: string;
  status: ApiBook["status"];
  total_pages: number;
  completed_pages: number;
  failed_pages: number;
  ready_pages: number[];
  pages: ApiPageSummary[];
}

interface ApiSegment {
  index: number;
  text: string;
  start_ms: number;
  end_ms: number;
  audio_url?: string;
}

interface ApiPage {
  page_number: number;
  corrected_text?: string;
  ocr_text?: string;
  segments: ApiSegment[];
}

interface ApiUpload {
  upload_id: string;
  object_key: string;
  url: string;
  fields: Record<string, string>;
  expires_in: number;
}

const samplePages: BookPage[] = [
  {
    id: "p1",
    pageNumber: 1,
    title: "The first teaching",
    segments: [
      {
        id: "s1",
        text: "སེམས་ཅན་ཐམས་ཅད་བདེ་བ་དང་ལྡན་པར་གྱུར་ཅིག །",
        audioUrl: "",
        durationMs: 5200,
      },
      {
        id: "s2",
        text: "བྱམས་པ་ནི་ང་ཚོའི་ལམ་ཡིན །",
        audioUrl: "",
        durationMs: 3900,
      },
    ],
  },
];

const mockBooks: Book[] = [
  {
    id: "sample",
    title: "A Path of Compassion",
    status: "ready",
    pageCount: 1,
    updatedAt: new Date().toISOString(),
    owner: "me",
    pages: samplePages,
  },
];
const mockJobs = new Map<string, ProcessingJob>();
const uploads = new Map<string, PresignedUpload>();

function mapStatus(status: ApiBook["status"]): Book["status"] {
  if (status === "completed" || status === "partial") return "ready";
  if (status === "failed") return "failed";
  if (status === "uploading") return "uploading";
  return "processing";
}

function mapBook(book: ApiBook, pages?: BookPage[]): Book {
  return {
    id: book.book_id,
    title: book.title,
    coverUrl: book.cover_url,
    status: mapStatus(book.status),
    progress: book.total_pages
      ? Math.round(
          ((book.completed_pages + book.failed_pages) / book.total_pages) * 100,
        )
      : 0,
    pageCount: book.total_pages,
    updatedAt: book.updated_at,
    owner: "me",
    pages,
  };
}

function mapPage(page: ApiPage): BookPage {
  const fallbackText = page.corrected_text || page.ocr_text || "";
  const segments: SentenceSegment[] = page.segments.length
    ? page.segments.map((segment) => ({
        id: `${page.page_number}-${segment.index}`,
        text: segment.text,
        audioUrl: segment.audio_url || "",
        durationMs: Math.max(1, segment.end_ms - segment.start_ms),
      }))
    : [
        {
          id: `${page.page_number}-0`,
          text: fallbackText,
          audioUrl: "",
          durationMs: 1000,
        },
      ];
  return {
    id: String(page.page_number),
    pageNumber: page.page_number,
    segments,
  };
}

export const api = {
  async listBooks(): Promise<Book[]> {
    if (MOCK_API) return structuredClone(mockBooks);
    const response = await request<{ items: ApiBook[] }>("/books");
    return response.items.map((book) => mapBook(book));
  },

  async getBook(id: string): Promise<Book> {
    if (MOCK_API) {
      const book = mockBooks.find((item) => item.id === id);
      if (!book) throw new ApiError("Book not found", 404, "NOT_FOUND");
      return structuredClone(book);
    }
    const [book, progress] = await Promise.all([
      request<ApiBook>(`/books/${id}`),
      request<ApiProgress>(`/books/${id}/status`),
    ]);
    const pages = await Promise.all(
      progress.ready_pages.map((pageNumber) =>
        request<ApiPage>(`/books/${id}/pages/${pageNumber}`).then(mapPage),
      ),
    );
    pages.sort((a, b) => a.pageNumber - b.pageNumber);
    return mapBook(book, pages);
  },

  async createUpload(input: UploadRequest): Promise<PresignedUpload> {
    if (MOCK_API) {
      const result: PresignedUpload = {
        uploadId: crypto.randomUUID(),
        objectKey: `mock/${input.filename}`,
        url: "mock://upload",
        method: "POST",
        fields: {},
        expiresIn: 900,
      };
      uploads.set(result.uploadId, result);
      return result;
    }
    const result = await request<ApiUpload>("/upload-url", {
      method: "POST",
      body: JSON.stringify({
        filename: input.filename,
        content_type: input.contentType,
        size_bytes: input.size,
      }),
    });
    const upload = {
      uploadId: result.upload_id,
      objectKey: result.object_key,
      url: result.url,
      method: "POST" as const,
      fields: result.fields,
      expiresIn: result.expires_in,
    };
    uploads.set(upload.uploadId, upload);
    return upload;
  },

  async putFile(
    presigned: PresignedUpload,
    file: File,
    onProgress?: (value: number) => void,
  ): Promise<void> {
    if (MOCK_API) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      onProgress?.(100);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const body = new FormData();
      Object.entries(presigned.fields).forEach(([key, value]) =>
        body.append(key, value),
      );
      body.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", presigned.url);
      xhr.upload.onprogress = (event) =>
        event.lengthComputable &&
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      xhr.onload = () =>
        xhr.status < 300
          ? resolve()
          : reject(new ApiError("Upload failed", xhr.status));
      xhr.onerror = () =>
        reject(new ApiError("Network error while uploading", 0));
      xhr.send(body);
    });
  },

  async startProcessing(
    upload: PresignedUpload,
    title: string,
  ): Promise<ProcessingJob> {
    if (MOCK_API) {
      const job = {
        id: crypto.randomUUID(),
        status: "processing" as const,
        progress: 12,
        message: title,
      };
      mockJobs.set(job.id, job);
      return job;
    }
    const book = await request<ApiBook>("/books", {
      method: "POST",
      body: JSON.stringify({
        upload_id: upload.uploadId,
        object_key: upload.objectKey,
        title,
        language: "bo",
        tts_voice: savedVoice(),
      }),
    });
    return {
      id: book.book_id,
      bookId: book.book_id,
      status: "queued",
      progress: 0,
    };
  },

  async getJob(id: string): Promise<ProcessingJob> {
    if (MOCK_API) {
      const job = mockJobs.get(id);
      if (!job) throw new ApiError("Book not found", 404);
      job.progress = Math.min(100, job.progress + 35);
      if (job.progress >= 45) {
        job.status = "completed";
        job.bookId = "sample";
        job.readyPages = [1];
      }
      return { ...job };
    }
    const progress = await request<ApiProgress>(`/books/${id}/status`);
    const percent = progress.total_pages
      ? Math.round(
          ((progress.completed_pages + progress.failed_pages) /
            progress.total_pages) *
            100,
        )
      : 2;
    return {
      id,
      bookId: id,
      status:
        progress.status === "failed"
          ? "failed"
          : progress.ready_pages.length > 0
            ? "completed"
            : progress.status === "queued"
              ? "queued"
              : "processing",
      progress: percent,
      readyPages: progress.ready_pages,
      message: progress.ready_pages.length
        ? "The first available page is ready."
        : undefined,
    };
  },

  async correctSegment(input: CorrectionRequest): Promise<ProcessingJob> {
    if (MOCK_API) {
      return {
        id: crypto.randomUUID(),
        bookId: input.bookId,
        status: "processing",
        progress: 0,
      };
    }
    await request(`/books/${input.bookId}/pages/${input.pageNumber}`, {
      method: "PATCH",
      body: JSON.stringify({ text: input.correctedText, regenerate: true }),
    });
    return {
      id: `${input.bookId}-${input.pageNumber}`,
      bookId: input.bookId,
      status: "processing",
      progress: 0,
    };
  },

  async waitForPage(bookId: string, pageNumber: number): Promise<BookPage> {
    if (MOCK_API) {
      const page = mockBooks[0].pages?.find(
        (item) => item.pageNumber === pageNumber,
      );
      if (!page) throw new ApiError("Page not found", 404);
      return structuredClone(page);
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const progress = await request<ApiProgress>(`/books/${bookId}/status`);
      const page = progress.pages.find(
        (item) => item.page_number === pageNumber,
      );
      if (page?.status === "failed")
        throw new ApiError("Audio regeneration failed", 409);
      if (page?.status === "completed") {
        return mapPage(
          await request<ApiPage>(`/books/${bookId}/pages/${pageNumber}`),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new ApiError("Audio regeneration is still processing", 408);
  },
};
