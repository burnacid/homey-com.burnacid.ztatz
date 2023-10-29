'use strict';

const Homey = require('homey');
const http = require('httpreq');
const querystring = require('qs');
const util = require('util');

class Api {

    constructor(data) {
        // Add HTTP:// if it isn't found
        if(!data.url.toLowerCase().startsWith('http')){
            data.url = "http://"+data.url
        }

        if(data.url.toLowerCase().endsWith('/')){
            data.url = data.url.substring(0,data.url.length-1)
        }

        this.config = data;
        this.lastError = null;
    }

    async processData(data) {
        if (data.error) {
            console.error('processData', data);
            throw new Error("Could not read API");
        }

        return data;
    }

    async httpResponse(result) {
        var data = result && result.body || '';

        // Authorisation error
        /*
        if (result.headers.hasOwnProperty('x-directadmin') && result.headers['x-directadmin'].includes('Unauthorized')) {
            throw new Error(this.homey.__('error.login_failed'));
        }
        */

        // HTML page is returned
        if (data.includes('<html>')) {
            console.error('HTML response', data);
            this.lastError = "Unexpected API responce";
            throw new Error("Unexpected API responce");
        }

        return await this.processData(data);
    }

    async httpRequest(params) {
        var fullUrl = this.config.url + this.command;

        var options = {
            url: fullUrl,
            method: 'GET',
            timeout: 1000
        };

        // Params is optional
        if (typeof params === 'undefined') {
            params = {};
        }

        // Build parameters
        if (Object.keys(params).length) {
            options.parameters = params;
        }

        const httpPromise = util.promisify(http.doRequest);

        // Do request
        return await httpPromise(options)
            .then(result => {
                return this.httpResponse(result);
            });
    }

    async getJsonData(data) {
        try {
            return JSON.parse(data);
        } catch (error) {
            console.error('getJsonData', error);
            this.lastError = 'ERROR: (Parsing API) '+ error
            return false;
        }
    }

    async testConnection() {
        this.command = '/api/v1/status';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0 && json != false) {
            return true;
        } else {
            return false;
        }
    }

    async getStatus() {
        this.command = '/api/v1/status?json=object';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0 && json != false) {
            return json;
        } else {
            return false;
        }
    }

    async getConfiguration() {
        this.command = '/api/v1/configuration?json=object';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0 && json != false) {
            return json;
        } else {
            return false;
        }
    }

    async getSmartmeter() {
        this.command = '/api/v1/smartmeter?limit=1';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0 && json != false) {
            return json;
        } else {
            return false;
        }
    }

    async getWatermeter(apiVersion = 1) {
        this.command = '/api/v2/watermeter/hour?limit=1&json=object';

        let data = await this.httpRequest();
        let json = this.getJsonData(data);

        if (json.length != 0 && json != false) {
            return json;
        } else {
            return false;
        }
    }

    async getFinancialDay() {
        this.command = '/api/v1/financial/day?limit=1';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0 && json != false) {
            return json;
        } else {
            return false;
        }
    }

    async getFinancialMonth() {
        this.command = '/api/v1/financial/month?limit=1';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0 && json != false) {
            return json;
        } else {
            return false;
        }
    }

    async getPowerGasDay() {
        this.command = '/api/v1/powergas/day?json=object&limit=1';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0 && json != false) {
            return json;
        } else {
            return false;
        }
    }

    async getWaterDay(apiVersion = 1) {
        this.command = '/api/v2/watermeter/day?json=object&limit=1';

        let data = await this.httpRequest();
        let json = this.getJsonData(data);

        if (json.length != 0) {
            return json;
        } else {
            return false;
        }
    }

    async getHeating() {
        this.command = '/api/v1/indoor/temperature?json=object&limit=1';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0 && json != false) {
            return json;
        } else {
            return false;
        }
    }

    getProperty(data, id) {
        for (let i = 0; i < data.length; i++) {
            let item = data[i];
            if (item[0] == id) {
                return item[1];
            }
        }

        return false;
    }

    filterValueByLabel(obj, value) {
        return obj.filter((object) => {
            return object["LABEL"] == value
        })
    }

}

module.exports = Api;