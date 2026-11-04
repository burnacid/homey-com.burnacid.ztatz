'use strict';

const Homey = require('homey');
const Api = require('./Api');

/**
 * Shared pairing for all ZTATZ drivers. The pair/start.html view asks for the
 * URL (and optional API key), we check it is a P1 Monitor and offer one device.
 * Subclasses define `pairName` (device name) and `pairType` (stored in the device data).
 */
class Driver extends Homey.Driver {

    get pairName() {
        return 'ZTATZ';
    }

    get pairType() {
        return this.id;
    }

    /** URL / API key of a ZTATZ device that is already added, to pre-fill the pair form. */
    knownConnection() {
        for (const driver of Object.values(this.homey.drivers.getDrivers())) {
            for (const device of driver.getDevices()) {
                const data = device.getData();
                if (data && data.url) {
                    return { url: data.url, apiKey: device.getSetting('apiKey') || '' };
                }
            }
        }
        return null;
    }

    async onPair(session) {
        let found = [];

        session.setHandler('get_defaults', async () => this.knownConnection());

        session.setHandler('search_devices', async (data) => {
            this.log('search_devices', data.url);
            found = [];

            const api = new Api({ url: data.url, apiKey: data.apiKey });
            const result = await api.testConnection();
            if (!result) {
                throw new Error(api.lastError || 'Could not connect to ZTATZ');
            }

            found = [{
                name: this.pairName,
                data: { type: this.pairType, url: api.config.url },
                settings: { apiKey: data.apiKey || '' },
            }];
            this.log('found ZTATZ', result.version, 'at', api.config.url);
            return { version: result.version, url: api.config.url };
        });

        session.setHandler('list_devices', async () => found);
    }

}

module.exports = Driver;
