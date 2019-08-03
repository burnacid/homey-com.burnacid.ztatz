'use strict';

const Homey = require('homey');
const Api = require('./Api');

class Device extends Homey.Device {

    onInit () {
        this.log('onInit');

        const device = this.getData();
        this.api = new Api(device);

        this.setSettings({
            url: device.url,
        });

        this._initDevice();
    }

    onDeleted () {
        this.log('onDeleted');
        this._deleteDevice();
    }

    /*
    onAdded () {
        this.log('onAdded');
        this._syncDevice();
    }

    onRenamed () {
        this.log('onRenamed');
    }
    */

};

module.exports = Device;