// Central HTTP helper for the DermaScan frontend (v2).
//
// - Backend base URL: VITE_API_URL || http://localhost:5000
// - ML service base URL: VITE_ML_URL || http://localhost:8000 (called directly)
// - The JWT stored by AuthContext is attached as a Bearer token automatically.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const ML_URL = import.meta.env.VITE_ML_URL || 'http://localhost:8000';

function getToken() {
  return localStorage.getItem('dermascan_token');
}

export function resolveApiUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  let body = null;
  try { body = await res.json(); } catch { /* no JSON body */ }
  if (!res.ok) {
    const err = new Error((body && (body.message || body.error)) || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function jsonOptions(method, data) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

// --- Blob downloads (auth header included) ---------------------------------
async function fetchBlob(path) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const err = new Error((body && (body.message || body.error)) || `Download failed (${res.status})`);
    err.status = res.status; err.body = body;
    throw err;
  }
  return res.blob();
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function downloadPdf(id) {
  const blob = await fetchBlob(`/api/history/${id}/report.pdf`);
  saveBlob(blob, `dermascan-report-${id}.pdf`);
  return blob;
}

export async function downloadCsv() {
  const blob = await fetchBlob('/api/history/export.csv');
  saveBlob(blob, 'dermascan-history.csv');
  return blob;
}

// --- Auth -------------------------------------------------------------------
export function loginUser(email, password) {
  return request('/api/auth/login', jsonOptions('POST', { email, password }));
}
export function registerUser(name, email, password) {
  return request('/api/auth/register', jsonOptions('POST', { name, email, password }));
}

// --- Analysis ---------------------------------------------------------------
export function analyzeImage(file, opts = {}) {
  const formData = new FormData();
  formData.append('image', file);
  if (opts.model) formData.append('model', opts.model);
  if (opts.profileId) formData.append('profileId', opts.profileId);
  if (opts.spotId) formData.append('spotId', opts.spotId);
  if (opts.tta) formData.append('tta', 'true');
  if (opts.hairRemoval) formData.append('hairRemoval', 'true');
  if (opts.intake) {
    const intake = opts.intake;
    formData.append('intake', JSON.stringify(intake));
    if (intake.duration) formData.append('intakeDuration', intake.duration);
    if (intake.familyHistory) formData.append('intakeFamilyHistory', intake.familyHistory);
    if (intake.notes) formData.append('intakeNotes', intake.notes);
    if (Array.isArray(intake.changes)) formData.append('intakeChanges', JSON.stringify(intake.changes));
  }
  return request('/api/analyze', { method: 'POST', body: formData });
}

export function fetchHistory(params = {}) {
  const q = new URLSearchParams();
  if (params.profileId) q.set('profileId', params.profileId);
  if (params.spotId) q.set('spotId', params.spotId);
  const qs = q.toString();
  return request(`/api/history${qs ? `?${qs}` : ''}`);
}
export function fetchAnalysis(id) { return request(`/api/history/${id}`); }
export function deleteAnalysis(id) { return request(`/api/history/${id}`, { method: 'DELETE' }); }
export function postFeedback(id, verdict) { return request(`/api/history/${id}/feedback`, jsonOptions('POST', { verdict })); }
export function emailReport(id, email) { return request(`/api/history/${id}/email`, jsonOptions('POST', { email })); }
export function shareAnalysis(id) { return request(`/api/history/${id}/share`, { method: 'POST' }); }
export function fetchShared(token) {
  // Public endpoint — no auth header needed, plain fetch keeps it anonymous.
  return fetch(`${API_URL}/api/shared/${encodeURIComponent(token)}`).then(async (res) => {
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      const err = new Error((body && (body.message || body.error)) || `Request failed (${res.status})`);
      err.status = res.status; err.body = body; throw err;
    }
    return body;
  });
}

// --- Profiles ---------------------------------------------------------------
export function fetchProfiles() { return request('/api/profiles'); }
export function createProfile(data) { return request('/api/profiles', jsonOptions('POST', data)); }
export function updateProfile(id, data) { return request(`/api/profiles/${id}`, jsonOptions('PUT', data)); }
export function deleteProfile(id) { return request(`/api/profiles/${id}`, { method: 'DELETE' }); }

// --- Body spots ---------------------------------------------------------------
export function fetchSpots(params = {}) {
  const q = new URLSearchParams();
  if (params.profileId) q.set('profileId', params.profileId);
  const qs = q.toString();
  return request(`/api/spots${qs ? `?${qs}` : ''}`);
}
export function createSpot(data) { return request('/api/spots', jsonOptions('POST', data)); }
export function updateSpot(id, data) { return request(`/api/spots/${id}`, jsonOptions('PUT', data)); }
export function deleteSpot(id) { return request(`/api/spots/${id}`, { method: 'DELETE' }); }

// --- Dashboard ---------------------------------------------------------------
export function fetchStats() { return request('/api/stats'); }
export function fetchInsights() { return request('/api/insights'); }
export function fetchReminders() { return request('/api/reminders'); }

// --- Doctors / bookings (demo) ------------------------------------------------
export function fetchDoctors() { return request('/api/doctors'); }
export function fetchBookings() { return request('/api/bookings'); }
export function createBooking(data) { return request('/api/bookings', jsonOptions('POST', data)); }
export function cancelBooking(id) { return request(`/api/bookings/${id}`, { method: 'DELETE' }); }
export const deleteBooking = cancelBooking;

// --- Admin ---------------------------------------------------------------------
export function fetchAdminUsers() { return request('/api/admin/users'); }
export function fetchAdminStats() { return request('/api/admin/stats'); }

// --- Addendum: intake / reviews / full report / notifications ------------------
export function updateIntake(id, intake) { return request(`/api/history/${id}/intake`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intake) }); }
export function requestReview(id) { return request(`/api/history/${id}/request-review`, { method: 'POST' }); }
export function fetchReviewQueue() { return request('/api/reviews/queue'); }
export function respondReview(id, comment) { return request(`/api/reviews/${id}/respond`, jsonOptions('POST', { comment })); }
export async function downloadFullReport() {
  const blob = await fetchBlob('/api/history/full-report.pdf');
  saveBlob(blob, 'dermascan-full-report.pdf');
  return blob;
}
export function fetchNotifications() { return request('/api/notifications'); }
export function markNotificationsRead() { return request('/api/notifications/read', { method: 'POST' }); }

// --- ML service (direct) ---------------------------------------------------------
async function mlFetch(path) {
  const res = await fetch(`${ML_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    const err = new Error(`ML service request failed (${res.status})`);
    err.status = res.status; throw err;
  }
  return res.json();
}
export function fetchModelInfo() { return mlFetch('/model-info'); }
export function fetchSamples() { return mlFetch('/samples'); }
export function sampleImageUrl(file) { return `${ML_URL}/static/${file}`; }

// --- Health ping (offline banner) ---------------------------------------------
export async function pingHealth() {
  const check = async (url) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      return res.ok;
    } catch { return false; }
  };
  const [api, ml] = await Promise.all([check(`${API_URL}/health`), check(`${ML_URL}/health`)]);
  return { api, ml, ok: api && ml, anyOk: api || ml };
}

export { API_URL, ML_URL };
