# DermaScan v2 — Skin Lesion Analysis (Educational Demo)

> **Medical disclaimer:** DermaScan is a student project and an **educational demo only**.
> It is **not a medical device**, not a diagnostic tool, and its predictions are experimental.
> Even the best model here misses roughly half of melanomas in validation — **never use it
> for real screening.** If you notice a changing or suspicious skin lesion, see a qualified
> dermatologist.

DermaScan classifies a photo of a skin lesion into one of 7 HAM10000 categories.
v2 keeps the v1 stack — Python FastAPI ML microservice, Node/Express + MongoDB
backend (JWT auth), React + Vite clinical-editorial frontend — and adds a second
model, Grad-CAM explainability, uncertainty estimates, photo-quality checks,
PDF reports, a stats dashboard, family profiles, a body-map tracker, a sample
gallery, demo doctor consults + review queue, and more (full status table below).

## Architecture

```
Browser (React + Vite, :5173)
   │  REST (JWT Bearer), multipart image · Socket.io (notifications)
   ▼
backend/  (Node.js + Express + Mongoose + Socket.io, :5000)
   │  POST /api/analyze → forwards image to the ML service
   ▼
ml-service/  (Python + FastAPI + PyTorch CPU, :8000)
   │  MobileNetV2 (served) + EfficientNet-B0 (comparison) + ensemble mode
   │  Grad-CAM · quality check · segmentation · uncertainty · OOD heuristic
   ▼
MongoDB  (users, analyses + photos, profiles, spots, bookings, notifications)
```

### The 7 lesion classes

| id | Name | Risk tier |
|----|------|-----------|
| mel | Melanoma | **high** |
| bcc | Basal Cell Carcinoma | **high** |
| akiec | Actinic Keratosis | moderate |
| bkl | Benign Keratosis | low |
| df | Dermatofibroma | low |
| nv | Melanocytic Nevus | low |
| vasc | Vascular Lesion | low |

## Honest model summary (v2 retrain, measured 2026-10-20)

Full detail: [ml-service/MODEL_CARD.md](ml-service/MODEL_CARD.md). Every number
below came from the actual training runs — nothing estimated or rounded up.

Both models were retrained on the **full HAM10000 dataset** (10,015 images,
stratified 80/20 split, seed 42, class-weighted loss) on a 2-CPU sandbox.

| Model | Training | Best val accuracy | Melanoma recall | Status |
|---|---|---|---|---|
| MobileNetV2 (v1) | 2,000-image subset, 4 epochs | **0.8125** | 0.48 | ✅ **Served** (default) |
| MobileNetV2 (v2) | full 10,015, 6 epochs | 0.7973 | 0.34 | Trained; **not shipped** — scored below v1 |
| EfficientNet-B0 (v2) | full 10,015, 5 epochs | 0.6221 | 0.41 | Served as comparison model |

**Ship decision:** the v2 MobileNetV2 did **not** beat v1 (0.7973 vs 0.8125), so
the app keeps serving the v1 weights (`models/mobilenetv2_skin.pth`, untouched).
The v2 checkpoint is kept as `models/mobilenetv2_full.pth` for reference.
Full-dataset training did fix some weaknesses (dermatofibroma recall
0.00 → 0.48 on the v2 MobileNet) but melanoma recall got *worse* (0.34), and
EfficientNet-B0 under-performed overall despite a better dermatofibroma recall
(0.61). **Melanoma recall of 0.34–0.48 across all models is the dominant
limitation** — roughly half of melanomas are missed. Educational demo only.

Under the sandbox CPU budget, fine-tuning used cached frozen-backbone features
for part of the schedule; integrity was verified by re-evaluating the best
checkpoints end-to-end on real validation images (metrics matched exactly).
Details and per-epoch curves are in the training JSONs and the Model page.

## Feature status (honest labels)

**Real** = genuinely implemented and verified end-to-end · **Demo** = works,
but with fictional/demo data · **Rule-based / heuristic** = transparent simple
logic, not AI · **Deferred** = not in this build (reason given).

| Feature | Status |
|---|---|
| JWT auth (register/login), analysis history | ✅ Real |
| Photo upload → prediction (MobileNetV2) | ✅ Real |
| Second model EfficientNet-B0 + side-by-side compare | ✅ Real |
| Ensemble mode (averaged probabilities, disagreement flag) | ✅ Real |
| Grad-CAM heatmap overlay | ✅ Real |
| Photo quality check (blur + brightness, scored) | ✅ Real (simple CV heuristics) |
| Uncertainty: softmax entropy + MC-dropout → reliability label | ✅ Real |
| Deep scan (test-time augmentation, 4 views) + delta | ✅ Real |
| Lesion segmentation overlay + coverage % (classical CV mask) | ✅ Real (approximate; **no mm** — no scale reference) |
| Hair-removal preprocessing (DullRazor-style) | ✅ Real (morphological; original photo kept in history) |
| Out-of-distribution photo guard | ⚠️ Heuristic (skin-coverage + entropy rules; can be wrong) |
| Uploaded photos stored + shown in history | ✅ Real (local disk `backend/uploads/`) |
| PDF report per analysis + full-history PDF | ✅ Real (pdfkit) |
| CSV export of history · full data export (JSON) | ✅ Real |
| Dashboard stats + SVG charts | ✅ Real |
| History insights ("most frequent class", risk trend…) | 🏷️ Rule-based (labelled in UI) |
| Feedback (looks right / wrong), counted on dashboard | ✅ Real |
| Family profiles + history filter by profile | ✅ Real |
| Follow-up reminders (>90 days → retake photo) | ✅ Real (in-app only) |
| Case intake form (duration, changes, family history) in PDF | ✅ Real |
| Body-map tracker (SVG front/back, spots, timelines) | ✅ Real |
| Lesion change score between two photos of a spot | ⚠️ Approximate (mask-area + colour delta) |
| Sample gallery: 8 real HAM10000 photos, true labels, live "Try this" | ✅ Real (CC BY-NC 4.0) |
| Offline banner + precomputed sample results when services are down | ✅ Real (clearly labelled; never fabricated) |
| Share link + QR code (unguessable token, public read-only page) | ✅ Real |
| WhatsApp share button | ✅ Real (wa.me intent) |
| Email report | ✅ Real **only if SMTP is configured** — otherwise the API honestly returns `501 EmailNotConfigured` and the UI says so |
| Doctor consult booking | 🎭 Demo (fictional doctors, labelled) |
| Doctor review queue (request → demo review → visible) | 🎭 Demo (demo doctor account; labelled everywhere) |
| Admin panel (users + analysis counts) | ✅ Real (role-guarded) |
| ABCDE self-assessment checker | 🏷️ Rule-based questionnaire (labelled "not a diagnosis") |
| FAQ assistant widget | 🏷️ Rule-based keyword matching (labelled) |
| UV index card (Open-Meteo, Roorkee default / geolocation) | ✅ Real (live API, no key) |
| Hindi UI toggle (EN/हिं, persisted) | ✅ Real (main UI strings; some secondary pages remain English) |
| Dark mode toggle (persisted) | ✅ Real (main surfaces; a few accent colours shared) |
| PWA (manifest + service worker + camera capture) | ✅ Real (app-shell caching) |
| Live notifications (Socket.io bell: analysis done, reminders, reviews) | ✅ Real |
| API docs (Swagger UI) | ✅ Real — `http://localhost:5000/api/docs` |
| Security: helmet headers, rate limits (auth/analyze), input validation, upload size/type limits | ✅ Real |
| Automated tests + CI workflow | ✅ Real — see [TEST_REPORT.md](TEST_REPORT.md); the GitHub Actions workflow is provided but was **not executed on GitHub** during this build |
| Docker one-command setup | ⚠️ Provided and syntax-checked; **not executed in the build sandbox** (no Docker there). The same services were verified running natively. |
| Plain-language result explanations (D1) | ⏸️ Deferred — per-class educational text already exists on the Learn page; wiring it into every result + PDF was cut to protect the verification schedule |
| Red-flag escalation banner (D2) | ⏸️ Deferred — intake answers are stored and shown in the PDF; the extra rule-based banner was cut for the same reason |
| EXIF stripping on uploads (D3) | ⏸️ Deferred — the backend has no image-processing dependency; safe EXIF removal needs one (e.g. sharp) and a test pass, rather than hand-rolled JPEG surgery on user photos |
| History text search / risk filter / date sort (D4) | ⏸️ Deferred — profile filter ships; the extra client-side filters were cut to protect the verification schedule |

## Run everything with one command (Docker)

```bash
# From the project root. Uses your existing MongoDB Atlas URI:
MONGO_URI="mongodb+srv://<user>:<password>@<cluster>/dermascan" JWT_SECRET="any-long-random-string" docker compose up --build
```

…or use the bundled local MongoDB instead (no Atlas needed):

```bash
docker compose --profile localdb up --build
```

Then open **http://localhost:5173**. Ports: frontend 5173, backend 5000,
ML service 8000, local Mongo 27017 (profile only). Uploaded photos persist in
the `dermascan-uploads` volume.

> Honest note: this compose file was written and syntax-checked by inspection;
> it was **not executed** in the build sandbox (no Docker available there). The
> three services were verified running natively — see TEST_REPORT.md.

## Manual setup (no Docker)

You need: Python 3.12, Node 20+, and a MongoDB connection string.
**Your existing MongoDB Atlas cluster/URI from v1 works as-is** — just reuse it
as `MONGO_URI` below.

### 1) ML service (port 8000)

```bash
cd ml-service
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
uvicorn app:app --port 8000
```

### 2) Backend (port 5000)

```bash
cd backend
npm install
cp .env.example .env              # set MONGO_URI (your Atlas URI) + JWT_SECRET
npm run seed:accounts             # creates the demo admin + doctor accounts
npm start
```

### 3) Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev                       # or: npm run build && npx vite preview --port 5173
```

Open **http://localhost:5173**, register an account, and analyze a lesion photo.

### Demo credentials (demo only — change/remove for any real deployment)

| Account | Email | Password | Notes |
|---|---|---|---|
| Admin | `admin@dermascan.demo` | `Admin@123` | Seeded by `npm run seed:accounts`; sees all users + counts |
| Doctor | `doctor@dermascan.demo` | `Doctor@123` | Seeded; sees the demo review queue |
| Patient | *(register your own)* | — | Normal signup flow |

SMTP (optional, for email reports): set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM` in `backend/.env`. Without them, email honestly
reports "not configured" — it never pretends to send.

## API overview

Swagger UI: **http://localhost:5000/api/docs** (OpenAPI 3, matches the real
routes). Highlights: `POST /api/analyze` (form fields: `image`, `model` =
mobilenet|efficientnet|both|ensemble, `tta`, `hairRemoval`, `profileId`,
`spotId`, intake fields), history + feedback + PDF/CSV/share endpoints,
`/api/stats`, `/api/insights`, `/api/reminders`, profiles, spots,
`/api/doctors` + bookings (demo), `/api/reviews/*` (demo doctor queue),
`/api/notifications`, `/api/export/me`, `GET /api/shared/:token` (public).
ML service: `/predict`, `/predict/efficientnet`, `/predict/compare`,
`/predict/ensemble`, `/change-score`, `/model-info`, `/samples`, `/health`.

## Testing

See **[TEST_REPORT.md](TEST_REPORT.md)** for the full record: backend API tests
**14/14 pass**, ML smoke tests **13/13 pass**, coordinator end-to-end run
**40/40 checks pass** against the live services — plus the bugs that
verification caught and fixed.

## Data & attribution

- **Dataset:** HAM10000 — Tschandl, Rosendahl & Kittler (2018), Harvard
  Dataverse, DOI **10.7910/DVN/DBW86T**, licence **CC BY-NC 4.0**. The 8
  gallery images in `ml-service/static/samples/` come from this dataset and
  carry their true dataset labels. The dataset itself (~1 GB zips in
  `ml-service/data/`) is only needed for re-training: `python train_v2.py`.
- Class distribution (full dataset): nv 6,705 · bkl 1,099 · mel 1,113 ·
  bcc 514 · akiec 327 · vasc 142 · df 115.

## Limitations (read before trusting anything)

- Melanoma recall is 0.34–0.48 across all three models — **about half of
  melanomas are missed**. The served model was chosen on overall validation
  accuracy; per-class trade-offs are documented in the model card.
- HAM10000 is heavily imbalanced (nv = 67%) and mostly light-skin dermoscopy;
  phone photos of real-world lesions will behave worse.
- Quality, OOD, segmentation, and change-score features are classical-CV
  heuristics — useful signals, not measurements.
- Consult doctors, reviews, and bookings are **demo data**, labelled as such.
- This is a final-year student project for education. It is not a medical
  device and must not be used for screening or diagnosis.
