# DermaScan — Model Card (MobileNetV2, HAM10000)

> Every number below was measured from the actual training run on
> 2026-10-09. Nothing is estimated, projected, or copied from literature.

## Model

- Architecture: `torchvision` MobileNetV2, ImageNet-pretrained
  (`IMAGENET1K_V1` weights), classifier head replaced with
  `Linear(1280, 7)`.
- Task: 7-class skin-lesion classification.
- Classes (in model output order): `akiec`, `bcc`, `bkl`, `df`, `mel`,
  `nv`, `vasc`.
- Artefacts: `models/mobilenetv2_skin.pth` (best-val-accuracy state_dict,
  9.2 MB), `models/class_names.json`, `models/metrics.json` (raw numbers).

## Dataset

- Source: HAM10000 via Harvard Dataverse, DOI
  **10.7910/DVN/DBW86T** — `HAM10000_metadata.tab` +
  `HAM10000_images_part_1.zip` (5,000 images) +
  `HAM10000_images_part_2.zip` (5,015 images), downloaded with the public
  Dataverse API (no login).
- Usable images after filtering to the 7 classes and de-duplicating
  `image_id`: **10,015**.
- Training subset: **2,000 images**, sampled with a fixed seed
  (`random_state=42`) via scikit-learn `train_test_split` **stratified**
  on the diagnosis label, so subset proportions match the full dataset.
- Split: **1,600 train / 400 validation** (80/20, stratified,
  `random_state=42`).

### Class distribution in the 2,000-image subset

| class | count | full-dataset share |
|-------|-------|--------------------|
| akiec (Actinic Keratosis) | 65 | 3.3% |
| bcc (Basal Cell Carcinoma) | 103 | 5.1% |
| bkl (Benign Keratosis) | 220 | 11.0% |
| df (Dermatofibroma) | 23 | 1.1% |
| mel (Melanoma) | 222 | 11.1% |
| nv (Melanocytic Nevus) | 1,339 | 67.0% |
| vasc (Vascular Lesion) | 28 | 1.4% |

## Training setup

- Epochs: **4** · batch size: **32** · optimizer: **Adam, lr=1e-4** ·
  loss: CrossEntropyLoss.
- Transforms: resize 224×224, ImageNet mean/std normalization;
  train-time random horizontal flip.
- Hardware: **CPU only**, 2 threads. Wall time: **9.8 minutes**.

### Per-epoch (train loss / validation accuracy)

| epoch | train_loss | val_acc |
|-------|-----------|---------|
| 1 | 1.1094 | 0.7625 |
| 2 | 0.5861 | 0.7850 |
| 3 | 0.3913 | **0.8125** ← best, checkpoint saved |
| 4 | 0.2770 | 0.8000 |

- **Best validation accuracy: 0.8125** (epoch 3 of 4).

## Validation results (n = 400, best checkpoint)

| class | precision | recall | f1-score | support |
|-------|-----------|--------|----------|---------|
| akiec | 0.5000 | 0.4615 | 0.4800 | 13 |
| bcc | 0.6818 | 0.7143 | 0.6977 | 21 |
| bkl | 0.6757 | 0.5682 | 0.6173 | 44 |
| df | 0.0000 | 0.0000 | 0.0000 | 5 |
| mel | 0.5385 | 0.4773 | 0.5060 | 44 |
| nv | 0.8711 | 0.9328 | 0.9009 | 268 |
| vasc | 1.0000 | 0.6000 | 0.7500 | 5 |

Confusion matrix (rows = true, cols = predicted; order
akiec, bcc, bkl, df, mel, nv, vasc):

```
[[  6   0   1   0   4   2   0]
 [  1  15   0   0   2   3   0]
 [  3   1  25   0   5  10   0]
 [  0   0   1   0   0   4   0]
 [  2   0   3   0  21  18   0]
 [  0   4   7   0   7 250   0]
 [  0   2   0   0   0   0   3]]
```

Notable: the model is good at the majority class `nv` (recall 0.93) but
weak on rare classes — `df` was never predicted correctly (5/5 missed),
and melanoma recall is only 0.48 (23 of 44 melanomas missed, 18 of them
misclassified as benign nevus).

## Honest limitations

- **Small subset**: trained on 2,000 of 10,015 available images.
- **CPU, 4 epochs**: far from converged; a GPU run with more epochs and
  the full dataset would do better.
- **Severe class imbalance**: `nv` dominates (67%); rare classes
  (`df`: 23, `vasc`: 28 training images) are barely learned.
- **Melanoma recall is 0.48** — this model misses more than half of
  melanomas in validation. It must never be used for real screening.
- **Educational demo only**: this is a student project artefact, not a
  medical device. Every API response carries the advisory
  *"Educational demo — not a medical diagnosis. Consult a dermatologist."*

## Reproducibility

```
python -m venv venv && source venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python train.py            # downloads data (if missing), trains, saves models/
```

Fixed seed `42` throughout; dataset files are expected (or downloaded)
under `ml-service/data/`.

---

# V2 update (2026-10-20)

> Everything below was measured in the v2 run on 2026-10-20
> (`train_v2.py`, logs in `train_v2.log` / `train_eff.log`, raw numbers in
> `models/training_mobilenet.json` and `models/training_efficientnet.json`).
> Nothing is estimated or copied from literature.

## What changed

- **Full dataset**: all **10,015** usable HAM10000 images (deduplicated by
  `image_id`), stratified 80/20 split (**8,012 train / 2,003 val**), seed 42.
  Images extracted to `data/images/` and read from disk.
- **Class-weighted loss**: `CrossEntropyLoss` with balanced weights from the
  train counts (`nv` weight 0.213, `df` weight 12.441, `vasc` 10.040,
  `akiec` 4.369, `bcc` 2.785, `bkl` 1.302, `mel` 1.286), to fight the
  `nv` = 67% imbalance that made v1 ignore rare classes.
- **Two models**, same two-phase recipe: Phase A — backbone frozen, head
  only, Adam lr 1e-3, 2 epochs; Phase B — backbone tail unfrozen
  (MobileNetV2 `features[13:]`, EfficientNet-B0 `features[6:]`), Adam
  lr 1e-4 (head) / 1e-5 (tail). Augmentation: horizontal + vertical flips,
  rotation 15°. Batch 32.
- **CPU-feasibility note (honest)**: a naive epoch costs ~8–9 min on this
  2-CPU box (measured in the first attempt), so frozen-prefix outputs were
  cached per augmentation variant (2 variants cycled in Phase B, backbone
  in eval mode, batch-norm statistics frozen) and the head/tail were
  trained on the cached tensors. Per-epoch val accuracy below is measured
  on cached clean val features; the per-class tables and confusion
  matrices come from re-evaluating the best checkpoint **end-to-end on the
  real validation images** — and for both models that end-to-end accuracy
  matched the best cached-feature val accuracy exactly (0.7973 / 0.6221).

### Dataset distribution (full HAM10000, after dedupe)

| class | count | share |
|-------|-------|-------|
| akiec (Actinic Keratosis) | 327 | 3.3% |
| bcc (Basal Cell Carcinoma) | 514 | 5.1% |
| bkl (Benign Keratosis) | 1,099 | 11.0% |
| df (Dermatofibroma) | 115 | 1.1% |
| mel (Melanoma) | 1,113 | 11.1% |
| nv (Melanocytic Nevus) | 6,705 | 67.0% |
| vasc (Vascular Lesion) | 142 | 1.4% |

## MobileNetV2 v2 (initialised from the v1 weights)

Wall time: **24.9 min**. Per-epoch (train loss / val accuracy):

| epoch | phase | train_loss | val_acc |
|-------|-------|-----------|---------|
| 1 | A | 0.9676 | **0.7973** ← best |
| 2 | A | 0.8219 | 0.7384 |
| 3 | B | 0.7529 | 0.7629 |
| 4 | B | 0.6586 | 0.7798 |
| 5 | B | 0.7064 | 0.7803 |
| 6 | B | 0.6105 | 0.7833 |

Validation results (n = 2,003, best checkpoint, end-to-end on real images):

| class | precision | recall | f1-score | support |
|-------|-----------|--------|----------|---------|
| akiec | 0.4632 | 0.6769 | 0.5500 | 65 |
| bcc | 0.6325 | 0.7184 | 0.6727 | 103 |
| bkl | 0.6283 | 0.6455 | 0.6368 | 220 |
| df | 0.4783 | 0.4783 | 0.4783 | 23 |
| mel | 0.6847 | 0.3408 | 0.4551 | 223 |
| nv | 0.8962 | 0.9142 | 0.9051 | 1,341 |
| vasc | 0.3810 | 0.8571 | 0.5275 | 28 |

Confusion matrix (rows = true, cols = predicted; akiec, bcc, bkl, df, mel, nv, vasc):

```
[[  44    6    6    2    1    6    0]
 [   5   74    9    2    0    9    4]
 [  20   13  142    1    6   32    6]
 [   4    3    0   11    0    5    0]
 [  17    6   28    1   76   89    6]
 [   5   12   41    6   28 1226   23]
 [   0    3    0    0    0    1   24]]
```

Reading it honestly: class weighting fixed v1's dead classes — `df` recall
0.00 → 0.48, `akiec` 0.46 → 0.68, `vasc` 0.60 → 0.86 — but **melanoma
recall got worse: 0.48 (v1) → 0.34**, and overall accuracy fell slightly.

### Ship decision

**v1 weights remain shipped** as `models/mobilenetv2_skin.pth`. The rule
set before training was: ship v2 only if its best val accuracy beats v1's
0.8125. v2 scored **0.7973 < 0.8125**, so `/predict` still serves the v1
model (whose own melanoma recall, 0.4773 on its 400-image val set, is also
better than the v2 run's 0.3408). The v2 checkpoint is kept at
`models/mobilenetv2_full.pth` for comparison; no v1 backup file was
created because the v1 file was never overwritten.

## EfficientNet-B0 v2 (ImageNet init, new in v2)

Wall time: **27.7 min**. Per-epoch:

| epoch | phase | train_loss | val_acc |
|-------|-------|-----------|---------|
| 1 | A | 1.4650 | 0.5976 |
| 2 | A | 1.1324 | 0.5686 |
| 3 | B | 1.3622 | 0.4683 |
| 4 | B | 1.0956 | 0.5602 |
| 5 | B | 1.0185 | **0.6221** ← best |

Validation results (n = 2,003, best checkpoint, end-to-end on real images):

| class | precision | recall | f1-score | support |
|-------|-----------|--------|----------|---------|
| akiec | 0.2823 | 0.5385 | 0.3704 | 65 |
| bcc | 0.3514 | 0.6311 | 0.4514 | 103 |
| bkl | 0.4021 | 0.5227 | 0.4545 | 220 |
| df | 0.2222 | 0.6087 | 0.3256 | 23 |
| mel | 0.3054 | 0.4081 | 0.3493 | 223 |
| nv | 0.9536 | 0.6741 | 0.7899 | 1,341 |
| vasc | 0.2222 | 0.7857 | 0.3465 | 28 |

Confusion matrix (same order as above):

```
[[  35   14    8    4    4    0    0]
 [  11   65   10    6    3    1    7]
 [  31   22  115    7   29   14    2]
 [   2    3    3   14    0    1    0]
 [  25   23   48    4   91   28    4]
 [  19   53  102   28  171  904   64]
 [   1    5    0    0    0    0   22]]
```

EfficientNet-B0 is **clearly weaker overall** in this constrained CPU
recipe (0.6221 vs MobileNetV2's ~0.80): the weighted loss pushed it to
over-predict minority classes (melanoma recall 0.4081 is actually better
than MobileNetV2-v2's 0.3408, and `df` recall is 0.6087, but precision
collapses and `nv` recall drops to 0.6741). It is served honestly at
`/predict/efficientnet` and in the ensemble for comparison — it is not
the better model here.

## v2 API additions (all heuristics labelled as such)

- **Uncertainty**: Shannon entropy (nats) of the 7-class softmax;
  reliability bands on top-1 probability (≥0.75 high, 0.5–0.75 moderate,
  <0.5 low); `mc_std` = std of top-1 probability over 10 MC-dropout
  passes (classifier dropout only, everything else in eval mode).
- **OOD check (heuristic)**: YCbCr skin-coverage rule (77≤Cb≤127 and
  133≤Cr≤173); `is_likely_lesion_photo=false` when skin coverage < 25%
  **or** entropy > 1.8 nats.
- **Segmentation (classical CV, heuristic)**: Otsu threshold on grayscale,
  dark region kept, cleaned to the largest connected component
  (`scipy.ndimage.label`); boundary overlay drawn in magenta. Coverage is
  a **frame-coverage estimate, never a size in mm**
  (method string: `otsu_threshold_largest_component`).
- **Grad-CAM**: manual forward/backward hooks on `features[-1]`, jet-like
  numpy colormap, 0.45 alpha blend.
- **TTA ("deep scan")**: mean softmax over original + horizontal flip +
  vertical flip + centre-crop-90%; `delta_top_probability` is measured
  against the single-pass probability of the TTA top class.
- **Hair removal (DullRazor-style)**: grayscale blackhat (grey closing,
  9×9 elliptical structuring element, scipy) → hair mask (blackhat > 15)
  → diffusion inpainting (60 iterations of local averaging). A real
  before/after pair from HAM10000 (`ISIC_0024310`, hair-pixel fraction
  0.1179 — the hairiest of the 8 gallery samples) is in
  `static/samples/hair_before.jpg` / `hair_after.jpg`.
- **Ensemble** (`/predict/ensemble`): plain mean of the two models' full
  7-class probability vectors, with per-model top classes and a
  disagreement flag. Given the accuracy gap above, the ensemble is a
  comparison feature, not a claim of improvement.
- **Change score** (`/change-score`, heuristic, approximate):
  `clamp(0.6·|area Δ %| + 0.4·colour Δ, 0, 100)` from the cleaned masks
  and masked mean colours of two photos. Lighting/framing differences
  dominate; it is not a clinical measurement.
- **Photo quality**: blur via Laplacian variance (numpy), brightness =
  mean luminance; documented thresholds and score deductions in `app.py`.

## Updated honest limitations

- **Melanoma recall is the number that matters and it is still bad**:
  shipped MobileNetV2 (v1 weights) 0.4773 on its val set; the v2
  full-dataset MobileNetV2 run 0.3408; EfficientNet-B0 0.4081. All miss
  roughly half or more of melanomas. Never use any of these for screening.
- Full-dataset training did **not** beat the v1 subset model on overall
  accuracy under this CPU budget — more data did not compensate for the
  cached-feature/short-schedule recipe and the accuracy cost of the
  class-weighted loss. A GPU run with full end-to-end fine-tuning and
  more epochs remains the real fix.
- Class imbalance persists (nv 67%); weighting trades overall accuracy
  for minority-class recall, as the tables above show.
- EfficientNet-B0's Phase B initially *hurt* (0.5976 → 0.4683) before
  recovering to 0.6221 — consistent with batch-norm/stochastic-depth
  disruption when fine-tuning on cached features; reported as measured.
- Quality / lesion coverage / segmentation / OOD / change-score are
  classical-CV heuristics, not measurements.
- **Educational demo only.** Every API response carries the advisory
  *"Educational demo — not a medical diagnosis. Consult a dermatologist."*

## Reproducibility (v2)

```
python train_v2.py            # full-dataset, both models (cached-feature recipe)
python build_samples.py       # 8-sample gallery + hair before/after (real inference)
uvicorn app:app --port 8000
python test_smoke.py          # 13 checks against the running service — all PASS 2026-10-20
```
