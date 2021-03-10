'use strict';

const Homey = require('homey');
const Device = require('../../lib/Device.js');
const boolean = require('boolean');

const refreshTimeout = 1000 * 10; // 10 sec

module.exports = class ztatzP1SmartMeterDevice extends Device {

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
		this._flowTriggerPowerMeterL1Changed = this.homey.flow.getDeviceTriggerCard('meter_power.generatedL1.changed');
		this._flowTriggerPowerMeterL2Changed = this.homey.flow.getDeviceTriggerCard('meter_power.generatedL2.changed');
	}

	async _deleteDevice() {
		this.log('_deleteDevice');

		clearInterval(this.intervalId);
	}

	// Update server data
	async _syncDevice() {
		try {
			let status = await this.api.getSmartmeter();

			if (status.length != 0) {
				this.setAvailable();

				let generationLow = status[0][5]
				let generationHigh = status[0][6]
				let currentGeneration = status[0][9]

				this.changeCapabilityValue('measure_power', Number(currentGeneration));
				this.changeCapabilityValue('meter_power.generatedL2', Number(generationLow), this._flowTriggerPowerMeterL2Changed, {'meter_power.generatedL2': Number(generationLow)});
				this.changeCapabilityValue('meter_power.generatedL1', Number(generationHigh), this._flowTriggerPowerMeterL1Changed, {'meter_power.generatedL1': Number(generationHigh)});

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