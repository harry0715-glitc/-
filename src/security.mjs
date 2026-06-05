export const ADMIN_USERNAME = 'admin';
export const MIN_ADMIN_SECRET_LENGTH = 6;

export function normalizeAdminUsername(value = '') {
  return String(value).trim().toLowerCase();
}

export function isFixedAdminUsername(value = '') {
  return normalizeAdminUsername(value) === ADMIN_USERNAME;
}

export function validateAdminSecret(value = '') {
  return String(value).length >= MIN_ADMIN_SECRET_LENGTH;
}

export function maskIdNumber(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 1)}${text.slice(1, -2).replace(/./g, '*')}${text.slice(-2)}`;
}

export function maskPhone(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  if (digits.length < 7) return text.replace(/.(?=..)/g, '*');
  return `${digits.slice(0, 2)}** *** ${digits.slice(-3)}`;
}
