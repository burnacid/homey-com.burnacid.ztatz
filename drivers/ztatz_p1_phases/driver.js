'use strict';

const Homey = require('homey');
const Api = require('../../lib/Api');
const Driver = require('../../lib/Driver');

let foundDevices = [];

class ztatzP1Phases extends Driver {

    async _onPairSearchDevices(data) {
        this.log('_onPairSearchDevices');

        foundDevices = []

        const api = new Api(data);

        await api.testConnection()
            .then(result => {
                if (result) {

                    foundDevices = [{
                        name: "P1 Phases",
                        data: data
                    }];
                } else {
                    this.log('No Result');
                    console.error('processData', data);
                    throw new Error("Error processing API data");
                }
            }).catch(error => {
                return error;
            });

        return true
    }

    async _onPairListDevices() {
        this.log('_onPairListDevices');
        this.log(foundDevices);

        return foundDevices;
    }

}


module.exports = ztatzP1Phases;
