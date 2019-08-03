'use strict';

const Homey = require('homey');
const Device = require('../../lib/Device.js');
const boolean = require('boolean');

const refreshTimeout = 1000 * 10; // 10 sec

module.exports = class ztatzP1PowerUsageDevice extends Device {

	// this method is called when the Device is inited
	async _initDevice () {
        this.log('_initDevice');
		const device = this.getData();

        // Register flowcard triggers
        //this._registerFlowCardTriggers();

        // Update server data
        //this._syncDevice();

        // Set update timer
		this.intervalId = setInterval(this._syncDevice.bind(this), refreshTimeout);
		this.setSettings({
			url: device.url,
		});
	}

	async _deleteDevice () {
        this.log('_deleteDevice');

        clearInterval(this.intervalId);
    }

	// Update server data
    async _syncDevice () {
        try {
			let status = await this.api.getStatus();

			if(status.length != 0){
				this.setAvailable();

				let currentL1Use = this.api.getProperty(status,74);
				let currentL2Use = this.api.getProperty(status,75);
				let currentL3Use = this.api.getProperty(status,76);

				let todayHighUsed = this.api.getProperty(status,9);
				let todayLowUsed = this.api.getProperty(status,8);

				let totalUsage = Number(currentL1Use) + Number(currentL2Use) + Number(currentL3Use);

				this.setCapabilityValue('p1_kwh_used', Number(totalUsage));
				this.setCapabilityValue('p1_kwh_usedToday', Number(todayHighUsed) + Number(todayLowUsed));

			}else{
				this.setUnavailable('Cannot refresh / Connect');
			}

            
        } catch (error) {
            this.error(error);
            this.setUnavailable(error.message);
        }
    }
	
	// this method is called when the Device has requested a state change (turned on or off)
	//async p1_kwh_used( value, opts ) {

		// ... set value to real device, e.g.
		// await setMyDeviceState({ on: value });

		// or, throw an error
		// throw new Error('Switching the device failed!');
	//}

}