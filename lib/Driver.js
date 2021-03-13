'use strict';

const Homey = require('homey');

const Api = require('./../lib/Api');

class Driver extends Homey.Driver {

    onPair(socket) {
        socket.setHandler('search_devices', async (data) => {
            if (this._onPairSearchDevices) {
                this._onPairSearchDevices(data);
            } else {
                new Error('missing _onPairSearchDevices');
            }
        });

        socket.setHandler('list_devices', async (data) => {
            if (this._onPairListDevices) {
                return this._onPairListDevices(data);
            } else {
                new Error('missing _onPairListDevices');
            }
        });
    }

};

module.exports = Driver;