'use strict';

const Homey = require('homey');
const Device = require('../../lib/Device.js');
const boolean = require('boolean');

const refreshTimeout = 1000 * 300; // 5 minuten

module.exports = class ztatzP1WaterMeterDevice extends Device {

	// this method is called when the Device is inited
	async _initDevice() {
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

		console.log("register flow triggers");
		// register Flow triggers
		this._flowTriggerWaterUsageChanged = new Homey.FlowCardTriggerDevice('measure_water.changed').register();
		this._flowTriggerWaterMeterLhanged = new Homey.FlowCardTriggerDevice('meter_water.changed').register();
	}

	async _deleteDevice() {
		this.log('_deleteDevice');

		clearInterval(this.intervalId);
	}

	// Update server data
	async _syncDevice() {
		try {
			let status = await this.api.getWatermeter();

			if (status.length != 0) {
				this.setAvailable();

				let TotalUsage = status[0][4]
				let currentUsage = status[0][3]

				this.changeCapabilityValue('measure_water', Number(currentUsage));
				this.changeCapabilityValue('meter_water', Number(TotalUsage));

			} else {
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