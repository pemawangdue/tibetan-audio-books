# dadhep frontend

Mobile-first React/Vite client for uploading Tibetan documents and listening to
progressively generated, sentence-synchronized audio.

## Local development

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env.local`. Set both `VITE_AUTH_MODE=mock` and
`VITE_USE_MOCK_API=true` only for explicit local fixture mode. Any other auth
mode uses Cognito and requires the configured user pool and client ID.

## Commands

- `npm test` — Vitest and Testing Library tests
- `npm run build` — TypeScript check and production build
- `npm run lint` — Oxlint

## API integration

The authenticated client in `src/api.ts` uses:

- `POST /upload-url`, followed by the returned presigned S3 form `POST`
- `POST /books`, `GET /books`, and `GET /books/:id`
- `GET /books/:id/status` and `GET /books/:id/pages/:page`
- `PATCH /books/:id/pages/:page`

The Cognito token is attached as a bearer token. The processing screen polls
book status and opens the player as soon as the first processed page is ready.
Multiple images are packaged into an ordered ZIP in the browser before upload.
