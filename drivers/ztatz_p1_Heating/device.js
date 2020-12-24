'use strict';

const Homey = require('homey');
const Device = require('../../lib/Device.js');
const boolean = require('boolean');

const refreshTimeout = 1000 * 30; // 30 sec

module.exports = class ztatzP1HeatingDevice extends Device {

	// this method is called when the Device is inited
	async _initDevice() {
		this.log('_initDevice');
		const device = this.getData();

		this.setUnavailable('Please remove this device and add the new device types.');

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
		this._flowTriggerHeatingInChanged = new Homey.FlowCardTriggerDevice('measure_temperature.in.changed').register();
		this._flowTriggerHeatingOutChanged = new Homey.FlowCardTriggerDevice('measure_temperature.out.changed').register();
	}

	async _deleteDevice() {
		this.log('_deleteDevice');

		clearInterval(this.intervalId);
	}

	// Update server data
	async _syncDevice() {
		try {
			let status = await this.api.getHeating();

			if (status.length != 0) {
				this.setAvailable();

				let heatingIn = status[0][3]
				let heatingOut = status[0][7]

				this.changeCapabilityValue('measure_temperature.in', Number(heatingIn), this._flowTriggerHeatingInChanged, {'measure_temperature.in.temperature': Number(heatingIn)});
				this.changeCapabilityValue('measure_temperature.out', Number(heatingOut), this._flowTriggerHeatingOutChanged, {'measure_temperature.out.temperature': Number(heatingOut)});

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