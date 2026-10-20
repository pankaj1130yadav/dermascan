# DermaScan v2 — Test Report

All results below are **real runs** performed during the v2 build (2026-10-20) in the
build sandbox (2 CPU, 7 GB RAM). Nothing here is simulated: every suite ran against
real code, and the end-to-end suite ran against the real ML models and real lesion
photographs. Raw backend test output is saved at `backend/tests/output.txt`.

## 1. Backend API tests — `backend/tests/api.test.js`

- **Framework:** Node's built-in `node:test` + supertest, against an in-memory
  MongoDB (`mongodb-memory-server`, MongoDB 8.2.6 binary) and a small stub ML
  server that returns a fixed, clearly-labelled stub payload. The stub exists so
  API plumbing (auth, storage, exports, guards) is tested deterministically;
  the **real** ML service is covered by suites 2 and 3 below.
- **Result: 14 passed / 0 failed** (run twice: once by the backend builder, once
  re-run by the coordinator after integration fixes — same result both times).
- Coverage: register validation failure + register/login (+role), analyze happy
  path (imageUrl/gradcamUrl/segUrl stored, uncertainty details + intake
  persisted), history list + profile filter, feedback 400/200, CSV export
  content-type + header row, share token + public shared fetch, per-analysis and
  full-history PDF content-type, email endpoint 501 when SMTP is unconfigured,
  profiles CRUD + validation, stats + notifications, admin 403 guard,
  review-queue 403 guard, ensemble flow.

Run it yourself: `cd backend && npm test`

## 2. ML service smoke tests — `ml-service/test_smoke.py`

- **Against the live ML service** with both real models loaded
  (MobileNetV2 shipped weights + EfficientNet-B0).
- **Result: 13/13 PASS** (coordinator run).
- Checks: `/health` with both model flags true; `/predict` returns 7-class
  predictions plus gradcam, `uncertainty {entropy, reliability, mc_std}`,
  `segmentation {overlay, coverage_percent}`, `quality`, `lesion`, `ood`;
  advisory string intact; `/predict/efficientnet` 200; `/predict/ensemble` 200
  with boolean `disagreement`; `/model-info` contains both models and the real
  `dataset_distribution` (akiec 327, bcc 514, bkl 1099, df 115, mel 1113,
  nv 6705, vasc 142 — total 10,015); `/samples` returns exactly 8 items;
  `/change-score` returns numeric area/color/change fields.

Run it yourself: start the ML service, then
`python test_smoke.py http://localhost:8000`

## 3. Coordinator end-to-end verification (live, all three services)

Setup: ML service on :8000 (real weights), backend on :5000 connected to the
in-memory MongoDB, frontend production build served on :5173, demo accounts
seeded (`npm run seed:accounts`). Test photos: two real ISIC dermoscopic images.

- **Result: 40/40 checks PASS**, including:
  - register/login; seeded admin + doctor logins
  - analyze (default) → real prediction with quality score, uncertainty
    reliability, and image + Grad-CAM + segmentation files stored and served
    from `/uploads`
  - analyze `model=both` (top-3 from both models) and `model=ensemble`
    (averaged probabilities; `disagreement: true` observed on a real photo)
  - analyze with `tta=true` + `hairRemoval=true` → flags persisted; TTA delta
    observed live (−0.0595 on the test photo)
  - history with photos, feedback, per-analysis PDF (real `%PDF`, 37 KB),
    full-history PDF, CSV export
  - share token + QR data URL + **public** shared fetch without auth
  - email endpoint returns honest **501 EmailNotConfigured** (no SMTP configured)
  - stats, rule-based insights, 4 demo doctors + booking, notifications
    (`analysis_completed`), full data export (`GET /api/export/me`)
  - doctor review queue end-to-end: request → queue → demo review → visible to
    the user as `reviewed`
  - admin guard (403 for a normal user) and admin user list with analysis counts
  - family profile tagging + history profile filter
  - `/api/change-score` numeric result; gallery flow: a HAM10000 sample whose
    true label is melanoma was run through the live backend analyze endpoint
    and predicted `mel`
  - Swagger UI served at `/api/docs`; all 10 frontend SPA routes return 200

### Bugs found and fixed during verification

1. **Demo-doctor seeding suppressed:** `seed:accounts` creates a "Dr. Demo
   Reviewer" Doctor document, and the consult route only seeded its 4 fictional
   dermatologists when the Doctor collection was completely empty — so the
   Consult page would have shown a single doctor. Fixed: seeding now checks for
   the demo doctors by name.
2. **TTA delta dropped:** the ML service returns the delta nested at
   `tta.delta_top_probability`, but the backend read flat keys, so
   `details.ttaDelta` was always null. Fixed the mapping; verified live.
3. A test-harness false alarm (not an app bug): Python `requests` file-object
   uploads send a non-image part content-type, which the backend's image filter
   correctly rejects with 400. Browser `FormData` uploads send the real MIME
   type and work — confirmed with `curl -F`.

## 4. Not executed here (honest notes)

- **GitHub Actions:** `.github/workflows/ci.yml` is provided (backend tests,
  frontend build, ML smoke) but was **not run on GitHub** during this build —
  the sandbox has no GitHub access for this repo.
- **Docker:** `docker-compose.yml` and the three Dockerfiles were syntax-checked
  by inspection/parsing only. The sandbox has **no Docker**, so the compose
  stack was never started here. The same services were verified natively
  (suites 2–3), which is what the containers wrap.
