// Lightweight integration-state helper. In live mode this reflects
// integration_connections; in demo mode it is a localStorage flag toggled by the
// Settings "Connect Gmail & Calendar" button, so the connected/disconnected
// email flows (A1) are both demonstrable without real OAuth.

const GMAIL_KEY = 'compass-gmail-connected';

export function gmailConnected(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(GMAIL_KEY) === '1';
}

export function setGmailConnected(v: boolean) {
  if (typeof localStorage === 'undefined') return;
  if (v) localStorage.setItem(GMAIL_KEY, '1');
  else localStorage.removeItem(GMAIL_KEY);
  window.dispatchEvent(new Event('compass-gmail-changed'));
}
