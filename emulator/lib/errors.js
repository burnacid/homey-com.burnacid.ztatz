'use strict';

const { dumps } = require('./pyjson');
const { dumpMapping } = require('./pyyaml');

// apierror.py — every API error is a "500 Internal Server Error".
const API_GENERAL_ERROR = { title: 'ERROR: unexpected error.', description: 'Got the following message: ', code: '00001' };
const API_DB_ERROR = { title: 'ERROR: database query.', description: 'Could not query the database got the following message: ', code: '00002' };
const API_PARAMETER_ERROR = { title: 'ERROR: parameter not valid.', description: 'Could not process your input, parameter(s) : ', code: '00003' };
const API_TIMESTAMP_ERROR = { title: 'ERROR: timestamp value.', description: 'timestamp has wrong format: ', code: '00004' };
const API_PARAMETER_MISSING_ERROR = { title: 'ERROR: parameter missing.', description: 'Could not process your input, parameter(s) is missing: ', code: '00005' };

/** falcon.HTTPError equivalent. `body` is falcon's to_dict() (title, description?, code?). */
class HttpError extends Error {
  constructor(status, body, headers = {}) {
    super(body.title);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

const STATUS_500 = '500 Internal Server Error';

function apiError(def, detail) {
  return new HttpError(STATUS_500, { title: def.title, description: def.description + detail, code: def.code });
}

// apiutil.santize_html
function santizeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/>/g, '&gt;')
    .replace(/</g, '&lt;');
}

// --- Accept negotiation: falcon req.client_prefers(('application/x-yaml', 'application/json'))
// Falcon 4 picks the candidate with the highest quality; ties go to the first
// candidate (YAML). A missing Accept header counts as "*/*".
function parseAccept(header) {
  return String(header || '*/*').split(',').map((part) => {
    const [range, ...params] = part.trim().split(';').map((p) => p.trim());
    let q = 1;
    for (const p of params) {
      const [k, v] = p.split('=').map((x) => x.trim());
      if (k === 'q') q = Number(v);
    }
    const [type, subtype = '*'] = range.toLowerCase().split('/');
    return { type, subtype, q: Number.isFinite(q) ? q : 0 };
  }).filter((r) => r.type);
}

function quality(ranges, mime) {
  const [type, subtype] = mime.split('/');
  let best = null;
  for (const r of ranges) {
    const typeOk = r.type === '*' || r.type === type;
    const subOk = r.subtype === '*' || r.subtype === subtype;
    if (!typeOk || !subOk) continue;
    const fitness = (r.type === type ? 100 : 0) + (r.subtype === subtype ? 10 : 0);
    if (!best || fitness > best.fitness) best = { fitness, q: r.q };
  }
  return best ? best.q : 0;
}

function preferredErrorType(acceptHeader) {
  const ranges = parseAccept(acceptHeader);
  const yaml = quality(ranges, 'application/x-yaml');
  const json = quality(ranges, 'application/json');
  if (yaml === 0 && json === 0) return null;
  return json > yaml ? 'application/json' : 'application/x-yaml';
}

/** apiutil.p1_serializer: body + content type for an error response. */
function serializeError(err, acceptHeader) {
  const type = preferredErrorType(acceptHeader);
  const headers = { Vary: 'Accept', ...err.headers };
  if (type === 'application/json') {
    return { type, headers, body: dumps(err.body, { ensureAscii: false }) };
  }
  if (type === 'application/x-yaml') {
    return { type, headers, body: dumpMapping(err.body) };
  }
  return { type: 'application/json', headers, body: '' };
}

module.exports = {
  API_GENERAL_ERROR,
  API_DB_ERROR,
  API_PARAMETER_ERROR,
  API_TIMESTAMP_ERROR,
  API_PARAMETER_MISSING_ERROR,
  HttpError,
  apiError,
  santizeHtml,
  serializeError,
  preferredErrorType,
};
