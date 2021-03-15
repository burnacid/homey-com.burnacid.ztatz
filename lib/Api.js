'use strict';

const Homey = require('homey');
const http = require('httpreq');
const querystring = require('qs');
const util = require('util');

class Api {

    constructor(data) {
        this.config = data;
    }

    async processData(data) {
        if (data.error) {
            console.error('processData', data);
            throw new Error(this.homey.__('error.permission_denied'));
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
            throw new Error(this.homey.__('error.invalid_data'));
        }

        return await this.processData(data);
    }

    async httpRequest(params) {
        var fullUrl = this.config.url + this.command;

        var options = {
            url: fullUrl,
            method: 'GET',
            timeout: 5000
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
            throw new Error(this.homey.__('error.invalid_data'));
        }
    }

    async testConnection() {
        this.command = '/api/v1/status';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0) {
            return true;
        } else {
            return false;
        }
    }

    async getStatus() {
        this.command = '/api/v1/status';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0) {
            return json;
        } else {
            return false;
        }
    }

    async getSmartmeter() {
        this.command = '/api/v1/smartmeter?limit=1';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0) {
            return json;
        } else {
            return false;
        }
    }

    async getWatermeter(apiVersion = 1) {
        this.command = '/api/v'+apiVersion+'/watermeter/hour?limit=1';

        let data = await this.httpRequest();
        let json = this.getJsonData(data);

        if (json.length != 0) {
            return json;
        } else {
            return false;
        }
    }

    async getFinancialDay() {
        this.command = '/api/v1/financial/day?limit=1';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0) {
            return json;
        } else {
            return false;
        }
    }

    async getFinancialMonth() {
        this.command = '/api/v1/financial/month?limit=1';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0) {
            return json;
        } else {
            return false;
        }
    }

    async getPowerGasDay() {
        this.command = '/api/v1/powergas/day?json=object&limit=1';

        const data = await this.httpRequest();
        const json = this.getJsonData(data);
        if (json.length != 0) {
            return json;
        } else {
            return false;
        }
    }

    async getWaterDay(apiVersion = 1) {
        this.command = '/api/v'+apiVersion+'/watermeter/day?json=object&limit=1';

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
        if (json.length != 0) {
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

    /*
    async getAdditionalDomains () {
        if (domain !== null) {
            this.command = 'ADDITIONAL_DOMAINS?domain=' + domain + '&json=yes';
        } else {
            this.command = 'ADDITIONAL_DOMAINS?json=yes';
        }

        const data = await this.httpRequest();
        return this.getJsonData(data);
    }

    async getAdminStats () {
        this.command = 'ADMIN_STATS?json=yes';
        const data = await this.httpRequest();
        return this.getJsonData(data);
    }

    async getLicense () {
        this.command = 'LICENSE?json=yes';
        const data = await this.httpRequest();
        return this.getJsonData(data);
    }

    async getPopStats (domain) {
        this.command = 'POP?domain=' + domain + '&action=full_list';
        let data = await this.httpRequest();
        let popObj = { count: 0, usage: 0 };

        if (data.length === 0) {
            return popObj;
        }

        let lines = querystring.parse(data);

        for (var user in lines) {
            let userdata = querystring.parse(lines[user]);
            popObj.count++;
            popObj.usage += parseFloat(userdata.usage);
        }

        return popObj;
    }
    */

}

module.exports = Api;