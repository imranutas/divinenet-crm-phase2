'use strict';

const CUSTOMER_CSV_FIELDS = Object.freeze([
  ['id', 'ID'],
  ['displayName', 'Name'],
  ['email', 'Email']
]);

function safeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function exportCustomersCsv(records) {
  if (!Array.isArray(records)) throw new Error('Customer records must be an array');

  const header = CUSTOMER_CSV_FIELDS.map(([, label]) => safeCsvCell(label)).join(',');
  const rows = records.map(record =>
    CUSTOMER_CSV_FIELDS.map(([field]) => safeCsvCell(record?.[field])).join(',')
  );

  return [header, ...rows].join('\r\n');
}

module.exports = { CUSTOMER_CSV_FIELDS, exportCustomersCsv };
