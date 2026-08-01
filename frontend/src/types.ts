export type BookStatus = 'uploading' | 'processing' | 'ready' | 'failed' | 'regenerating'

export interface SentenceSegment {
  id: string
  text: string
  audioUrl: string
  durationMs: number
}

export interface BookPage {
  id: string
  pageNumber: number
  title?: string
  segments: SentenceSegment[]
}

export interface Book {
  id: string
  title: string
  author?: string
  coverUrl?: string
  status: BookStatus
  progress?: number
  pageCount: number
  language?: string
  ttsVoice?: string
  createdAt?: string
  updatedAt: string
  owner: 'me' | 'shared'
  pages?: BookPage[]
}

export interface Bookmark {
  id: string
  bookId: string
  pageNumber: number
  segmentId: string
  label: string
  createdAt: string
}

export interface UploadRequest {
  filename: string
  contentType: string
  size: number
  uploadId?: string
  index?: number
  total?: number
}

export interface PresignedUpload {
  uploadId: string
  objectKey: string
  url: string
  method: 'POST'
  fields: Record<string, string>
  expiresIn: number
}

export interface ProcessingJob {
  id: string
  bookId?: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  readyPages?: number[]
  message?: string
}

export interface CorrectionRequest {
  bookId: string
  pageNumber: number
  correctedText: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResponse {
  answer: string
  citations: number[]
  indexStatus?: string | null
}

export interface ApiErrorShape {
  message: string
  code?: string
  status: number
  requestId?: string
}
