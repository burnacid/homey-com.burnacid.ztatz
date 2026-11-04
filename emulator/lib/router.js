'use strict';

/**
 * Falcon-like router: exact, case-sensitive paths; `{name}` segments match any
 * single segment (including an empty one, so '/api/v1/status/' matches
 * '/api/v1/status/{id}'); at each level a literal segment beats a field.
 */
class Router {
  constructor() {
    this.routes = [];
  }

  add(template, handler) {
    const segments = template.split('/');
    this.routes.push({ template, segments, handler });
    // literal-before-field ordering, segment by segment
    const rank = (r) => r.segments.map((s) => (s.startsWith('{') ? '1' : '0')).join('');
    this.routes.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
    return this;
  }

  match(path) {
    const parts = path.split('/');
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith('{') && seg.endsWith('}')) {
          params[seg.slice(1, -1)] = parts[i];
        } else if (seg !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params, template: route.template };
    }
    return null;
  }

  templates() {
    return this.routes.map((r) => r.template);
  }
}

module.exports = { Router };
