# DermaScan frontend

React + Vite single-page app for DermaScan, an educational skin-lesion
awareness demo (fine-tuned MobileNetV2 on the backend).

## Configuration

The backend base URL is read from the build-time env variable `VITE_API_URL`.
If it is not set, the app talks to `http://localhost:5000`.

Create a `.env` file from the example:

```
cp .env.example .env
```

## Scripts

- `npm run dev` — start the Vite dev server on http://localhost:5173
- `npm run build` — production build into `dist/`
- `npm run preview` — serve the production build locally

## Routes

- `/` — landing (hero, how-it-works, 7 lesion types, disclaimer)
- `/learn` — ABCDE rule, when to see a doctor
- `/analyze` — image upload + top-3 predictions + risk callout (auth required)
- `/history` — past analyses with per-card delete (auth required)
- `/login`, `/register` — auth forms

All auth state (JWT + user) is persisted in `localStorage` under the
`dermascan_token` / `dermascan_user` keys.

## Standing rule

Every result page and the footer carry the disclaimer: "Educational demo —
not a medical device. Model predictions are experimental." Predictions are
presented as educational signals only, never as diagnoses.
