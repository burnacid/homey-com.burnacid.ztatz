'use strict';

const Homey = require('homey');
const Api = require('./Api');

class Device extends Homey.Device {

    onInit() {
        this.log('onInit');

        const device = this.getData();
        this.api = new Api(device);

        this.setSettings({
            url: device.url,
        });

        this._initDevice();
    }

    onDeleted() {
        this.log('onDeleted');
        this._deleteDevice();
    }


    onAdded() {
        this.log('onAdded');
        this._syncDevice();
    }

    /*
    onRenamed () {
        this.log('onRenamed');
    }
    */

    changeCapabilityValue(capability,value,flowTrigger=null,tokens=null,state=null) {
        let currentValue = this.getCapabilityValue(capability)
        if(currentValue != value){
            this.setCapabilityValue(capability,value);

            if(flowTrigger != null){
                flowTrigger.trigger(this, tokens, state).catch(this.error);
            }
        }
    }
};

module.exports = Device;