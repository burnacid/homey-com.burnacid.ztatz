'use strict';

const http = require('httpreq');

const TIMEOUT_MS = 8000;
// Devices on the same P1 Monitor ask for the same data; reuse responses for a few seconds.
const CACHE_MS = 5000;
const cache = new Map();

/**
 * Client for the ZTATZ / P1 Monitor API.
 *
 * Every data method returns the parsed JSON (an array, possibly empty) or
 * `false` on failure. On failure `lastError` holds a readable message and
 * `lastStatus` the HTTP status code (0 when the request itself failed).
 */
class Api {

    constructor(data) {
        let url = String(data.url || '').trim();
        if (!url.toLowerCase().startsWith('http')) {
            url = 'http://' + url;
        }
        url = url.replace(/\/+$/, '');

        this.config = { ...data, url };
        this.apiKey = data.apiKey || null;
        this.lastError = null;
        this.lastStatus = null;
    }

    setApiKey(apiKey) {
        this.apiKey = apiKey || null;
    }

    _doRequest(url) {
        const headers = { Accept: 'application/json' };
        if (this.apiKey) {
            headers['X-APIkey'] = this.apiKey;
        }
        return new Promise((resolve) => {
            http.doRequest({ url, method: 'GET', headers, timeout: TIMEOUT_MS }, (error, result) => {
                if (error) {
                    resolve({ status: 0, error: 'Cannot connect to ZTATZ (' + (error.message || error.code || error) + ')' });
                    return;
                }
                resolve(this._parseResponse(result));
            });
        });
    }

    _parseResponse(result) {
        const status = result.statusCode;
        const body = result.body || '';

        if (status === 200 && !body.includes('<html')) {
            try {
                return { status, data: JSON.parse(body) };
            } catch (e) {
                return { status, error: 'Unexpected response from ZTATZ (' + e.message + ')' };
            }
        }

        // ZTATZ (falcon) errors: {"title": ..., "description": ..., "code": ...}
        try {
            const err = JSON.parse(body);
            if (err && err.title) {
                return { status, error: 'ZTATZ: ' + err.title + (err.description ? ' ' + err.description : '') };
            }
        } catch (e) {
            // not JSON, e.g. an nginx error page
        }
        if (status === 401 || status === 403) {
            return { status, error: 'ZTATZ refused access (HTTP ' + status + '), check the API key' };
        }
        return { status, error: 'Unexpected response from ZTATZ (HTTP ' + status + ')' };
    }

    /** GET a ZTATZ API path and return the parsed JSON, or false. */
    async getJson(path) {
        const url = this.config.url + path;
        const key = url + '|' + (this.apiKey || '');
        const now = Date.now();

        let entry = cache.get(key);
        if (!entry || now - entry.time > CACHE_MS) {
            entry = { time: now, promise: this._doRequest(url) };
            cache.set(key, entry);
            // keep the cache small
            for (const [k, e] of cache) {
                if (now - e.time > CACHE_MS) cache.delete(k);
            }
        }

        const result = await entry.promise;
        this.lastStatus = result.status;
        if (result.error) {
            cache.delete(key);
            this.lastError = result.error;
            return false;
        }
        this.lastError = null;
        return result.data;
    }

    /** Checks that the URL is a P1 Monitor. Returns { version } or false. */
    async testConnection() {
        const data = await this.getJson('/api/v1/configuration/0?json=object');
        if (!Array.isArray(data)) {
            if (data !== false) this.lastError = 'This does not look like a ZTATZ P1 Monitor';
            return false;
        }
        const row = data[0] || {};
        return { version: String(row.PARAMETER || '') };
    }

    getStatus() {
        return this.getJson('/api/v1/status?json=object');
    }

    getConfiguration() {
        return this.getJson('/api/v1/configuration?json=object');
    }

    getSmartmeter() {
        return this.getJson('/api/v1/smartmeter?limit=1&json=object');
    }

    /** Last two S0 minute records; the newest one is still being filled. */
    getSolarpanel() {
        return this.getJson('/api/v1/powerproduction/minute?limit=2&json=object');
    }

    getFinancialDay() {
        return this.getJson('/api/v1/financial/day?limit=1&json=object');
    }

    getFinancialMonth() {
        return this.getJson('/api/v1/financial/month?limit=1&json=object');
    }

    getPowerGasDay() {
        return this.getJson('/api/v1/powergas/day?limit=1&json=object');
    }

    getHeating() {
        return this.getJson('/api/v1/indoor/temperature?limit=1&json=object');
    }

    /**
     * Water meter records. meterId 1 is the pulse (GPIO) meter, 2..5 are
     * digital meters read from the P1 telegram. ZTATZ older than 3.3.0 has
     * no watermeterdigital route; fall back to the deprecated /api/v2/watermeter.
     */
    async getWater(period, meterId = 1, limit = 1) {
        const query = '?limit=' + limit + '&json=object';
        const data = await this.getJson('/api/v2/watermeterdigital/' + period + '/' + meterId + query);
        if (data === false && this.lastStatus === 404 && String(meterId) === '1') {
            return this.getJson('/api/v2/watermeter/' + period + query);
        }
        return data;
    }

    filterValueByLabel(rows, label) {
        return rows.filter((row) => row.LABEL === label);
    }

}

module.exports = Api;
