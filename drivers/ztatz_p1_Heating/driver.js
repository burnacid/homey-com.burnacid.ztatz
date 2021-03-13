const Homey = require('homey');
const Api = require('../../lib/Api');
const Driver = require('../../lib/Driver');

let foundDevices = [];

module.exports = class ztatzP1HeatingDriver extends Driver {

    // This method is called when a user is adding a device
    // and the 'list_devices' view is called   

    async _onPairSearchDevices(data) {
        this.log('_onPairSearchDevices');

        foundDevices = []

        const api = new Api(data);

        await api.testConnection()
            .then(result => {
                if (result) {

                    foundDevices = [{
                        name: "P1 Heating (" + data.url + ")",
                        data: data
                    }];
                } else {
                    this.log('No Result');
                    console.error('processData', data);
                    throw new Error(Homey.__('error.permission_denied'));
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