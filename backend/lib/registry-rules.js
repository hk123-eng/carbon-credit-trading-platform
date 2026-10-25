// Registry consistency rules applied when credits are issued. Serial numbers
// follow the pattern <PREFIX>-<VINTAGE YEAR>-<6 digits>, where the prefix is
// fixed by the verification standard and the year must match the vintage.

const PREFIXES = {
  'Verra VCS': 'VCS',
  'Gold Standard': 'GS',
  'American Carbon Registry': 'ACR',
  'Climate Action Reserve': 'CAR',
  'Plan Vivo': 'PV',
};

function expectedPrefix(standard) {
  return PREFIXES[standard] || null;
}

// Returns null if the serial is valid, otherwise an error message.
function checkSerial(serial, standard, vintageYear) {
  const prefix = expectedPrefix(standard);
  const pattern = prefix ? new RegExp(`^${prefix}-(\\d{4})-\\d{6}$`) : /^[A-Z]{2,6}-(\d{4})-\d{6}$/;
  const m = pattern.exec(String(serial || ''));
  if (!m) {
    return prefix
      ? `Serial number must look like ${prefix}-${vintageYear}-000001 for ${standard} credits.`
      : `Serial number must look like ABC-${vintageYear}-000001.`;
  }
  if (Number(m[1]) !== Number(vintageYear)) {
    return `The year in the serial number (${m[1]}) must match the vintage year (${vintageYear}).`;
  }
  return null;
}

// Vintage must fall inside the project's crediting period and not be in the future.
// Years are passed as numbers (taken from the database) to avoid time-zone shifts.
function checkVintage(vintageYear, startYear, endYear, now = new Date()) {
  const y = Number(vintageYear);
  const start = Number(startYear);
  const end = Number(endYear);
  if (!Number.isInteger(y)) return 'Vintage year must be a whole year.';
  if (y > now.getUTCFullYear()) return 'Vintage year cannot be in the future.';
  if (y < start || y > end) return `Vintage year must be within the project period (${start}–${end}).`;
  return null;
}

module.exports = { PREFIXES, expectedPrefix, checkSerial, checkVintage };
