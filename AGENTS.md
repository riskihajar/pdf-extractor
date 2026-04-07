# Repository Guide

## Stack and entrypoints

- Tech stack in active use: Next.js 16, React 19, TypeScript 5, Tailwind CSS v4, shadcn/ui, SQLite (`node:sqlite`), plus local `pdftoppm`, Tesseract, and OpenAI-compatible LLM runtime integration.
- Single-package Next.js 16 App Router app; the only top-level page is `app/page.tsx`, which server-renders `Dashboard` from `components/dashboard/dashboard.tsx` using `getJobs()` from `lib/job-actions.ts`.
- Most product behavior lives in server-side helpers under `lib/`; route handlers in `app/api/**/route.ts` are thin wrappers around `lib/job-actions.ts`.
- Persistent dev state is stored in SQLite via `lib/job-store.ts` at `.data/jobs.sqlite` by default. Uploaded PDFs and rendered PNGs live under `.data/storage*`.

## Commands

- Always run shell commands as `source ~/.zshrc && <command>` in this repo so Node/npm are on `PATH`.
- Install: `source ~/.zshrc && npm install`
- Dev server: `source ~/.zshrc && npm run dev` (uses Turbopack)
- Validation: `source ~/.zshrc && npm run lint && npm run typecheck && npm test`
- Focused tests: `source ~/.zshrc && node --import tsx --test tests/<name>.test.ts`

## Testing and runtime quirks

- Tests use the Node test runner, not Jest/Vitest. The script is `node --import tsx --test tests/**/*.test.ts`.
- Test isolation depends on `NODE_TEST_CONTEXT`; storage and SQLite paths switch to process-specific `.data/storage-<pid>` and `.data/jobs-<pid>.sqlite` when that env var is set in tests.
- Runtime probes and worker tests often stub globals like `globalThis.__testFetch`, `__testGenerateText`, and `__testOpenAIProvider`; follow that pattern instead of adding networked tests.

## Workflow gotchas

- `POST /api/jobs/upload` with `multipart/form-data` only stores the PDF and metadata; it does not render pages yet. Real render preparation happens later in the start/preparation flow, so do not assume uploads are immediately startable.
- `lib/job-actions.ts:startJob()` currently returns `null` for uploaded jobs that have no render artifacts yet. If you touch upload/start behavior, verify both `tests/pdf-upload-pipeline.test.ts` and `tests/background-preparation.test.ts` because this edge is intentional in current tests.
- Real PDF rendering shells out to `pdftoppm`, defaulting to `/opt/homebrew/bin/pdftoppm` unless `PDFTOPPM_PATH` is set. Tesseract defaults to `/opt/homebrew/bin/tesseract` unless `TESSERACT_PATH` is set.
- LLM config is server-only via env vars in `lib/env.ts`; the required minimum for a ready runtime is `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY`.

## Code style and conventions

- Formatting is Prettier with 2 spaces, semicolons off, double quotes, trailing commas `es5`, and `prettier-plugin-tailwindcss`; `npm run format` only rewrites `*.ts` and `*.tsx` files.
- TypeScript uses `strict` mode and the `@/*` path alias rooted at the repo.
- `eslint.config.mjs` ignores `.next/**`, `out/**`, `build/**`, `sample/**`, and `next-env.d.ts`; generated output under those paths should not be hand-edited.
- Visual/UI work should use shadcn/ui primitives and patterns, not ad-hoc bespoke component systems.
- shadcn is configured with the `base-mira` style and `hugeicons`; preserve existing aliases from `components.json` when adding UI primitives.
- Use `shadcn` when doing UI work that needs existing registry components, examples, add commands, or project audit guidance; prefer it before hand-rolling visual primitives.
- Use `context7` when you need current framework/library docs or API examples for repo dependencies like Next.js, React, Tailwind, shadcn, or AI SDK integrations.

## UI product guidance

- Read `UI_SPEC.md` before making substantial UI/layout changes.
- Treat the app as a document extraction workspace, not a generic analytics/dashboard shell.
- Use user-facing vocabulary like `Documents`, `Pages`, `Compare`, `Result`, and `Download`; avoid leading with internal terms like `intake`, `lane`, or `pipeline cockpit` in the main UI.
- Prioritize the hierarchy defined in `UI_SPEC.md`: document list first, selected document detail second, runtime diagnostics third.
- Keep upload/actions compact and utilitarian; avoid oversized hero sections or decorative panels for simple document actions.
