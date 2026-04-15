// auth.js — shared across all pages
// Usage: getToken(), getUser(), logout(), requireLogin()

function getToken() { return localStorage.getItem('sctms_token'); }
function getUser()  { try { return JSON.parse(localStorage.getItem('sctms_user') || 'null'); } catch { return null; } }
function saveAuth(token, user) { localStorage.setItem('sctms_token', token); localStorage.setItem('sctms_user', JSON.stringify(user)); }
function logout()   { localStorage.removeItem('sctms_token'); localStorage.removeItem('sctms_user'); window.location.href = 'login.html'; }
function requireLogin() { if (!getToken()) { window.location.href = 'login.html'; return false; } return true; }
