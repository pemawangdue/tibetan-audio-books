# Dadhep AWS MVP infrastructure

AWS CDK v2 (Python) provisions the MVP as one independently deployable stack:

- Cognito self-service sign-up/sign-in with email or phone aliases.
- Private, encrypted, versioned uploads, generated-assets, and frontend S3 buckets.
- CloudFront with Origin Access Control, HTTPS-only frontend delivery, and SPA
  route rewriting. Generated audio remains private and is delivered with
  short-lived, owner-authorized S3 URLs returned by the API.
- On-demand Books, Pages, and TTL-enabled Cache DynamoDB tables. Books can be
  queried by owner/creation time or status/update time; Pages can be queried by
  processing priority or job/page number.
- Document, priority-page, and standard-page SQS queues, each with an encrypted
  DLQ. The split worker consumes documents; the page worker consumes both page
  tiers with priority receiving the larger concurrency allocation.
- Cognito-authorized HTTP API proxying `/` and `/{proxy+}` to the API Lambda.
- A reference to the existing `dadhep/monlam-api-key` Secrets Manager secret.
  CDK does **not** create or populate the secret.
- Least-privilege grants, X-Ray tracing, one-month Lambda log retention, queue,
  DLQ, Lambda error/throttle, and API 5xx alarms.

## Source layout

The deployable app intentionally packages sibling application outputs:

- Lambda code: `../backend`
- Static frontend: `../frontend/dist`

The default handlers are `app.handler.handler`, `app.split_worker.handler`, and
`app.page_worker.handler`. Override them with CDK context keys `apiHandler`,
`splitHandler`, and `pageWorkerHandler` if the backend module layout differs.
Both source paths must exist before `cdk synth` or deployment. Tests inject small
temporary assets and therefore do not require application sources.
Lambda dependencies, including PyMuPDF, are installed as Python 3.12
manylinux x86-64 wheels by the local bundler. Docker is used only as CDK's
fallback when local wheel bundling is unavailable.

## Setup and verification

Run from `infra`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
pytest
npx aws-cdk synth
```

Bootstrap a target account once, then deploy:

```powershell
npx aws-cdk bootstrap aws://ACCOUNT/REGION
npx aws-cdk deploy
```

The named Monlam secret must already exist in the deployment region. Set a
different name with `-c monlamSecretName=path/to/secret`.

## Runtime sizing and concurrency

`cdk.json` contains bounded defaults for each Lambda's memory, timeout,
ephemeral storage, and reserved concurrency. It also controls SQS batch sizes
and maximum concurrency. Override any value with `-c key=value`.

The following constraints are checked during synthesis:

- Lambda memory: 128–10240 MiB
- Ephemeral storage: 512–10240 MiB
- API timeout: 1–30 seconds; worker timeouts: 1–900 seconds
- Event source maximum concurrency is at least 2 and no greater than its
  Lambda's reserved concurrency
- Priority plus standard page concurrency cannot exceed the page worker's
  reserved concurrency

The API currently allows any browser origin because the frontend domain is not
known until deployment. For production, replace `allow_origins=["*"]` with the
deployed custom frontend origin.

Persistent buckets, Cognito users, and Books/Pages data use `RETAIN` deletion
policies. Queue and alarm thresholds are MVP defaults and should be tuned from
observed traffic.
