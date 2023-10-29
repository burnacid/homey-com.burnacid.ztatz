'use strict';

const Homey = require('homey');
const Device = require('../../lib/Device.js');
const boolean = require('boolean');

const refreshTimeout = 1000 * 60; // 1 minuten

module.exports = class ztatzP1WaterMeterDevice extends Device {

	// this method is called when the Device is inited
	async _initDevice() {
		this.log('_initDevice');
		const device = this.getData();
		this.config = {
			url: device.url,
			waterApiVersion: "1"
		}

		// Register flowcard triggers
		//this._registerFlowCardTriggers();

		// Set update timer
		this.intervalId = setInterval(this._syncDevice.bind(this), refreshTimeout);
		this.setSettings(this.config);

		// Update server data
		this._syncDevice();

		console.log("register flow triggers");
		// register Flow triggers
		//this._flowTriggerWaterUsageChanged = this.homey.flow.getDeviceTriggerCard('measure_water.changed');
		//this._flowTriggerWaterMeterLhanged = this.homey.flow.getDeviceTriggerCard('meter_water.changed');
	}

	async _deleteDevice() {
		this.log('_deleteDevice');

		clearInterval(this.intervalId);
	}

	// Update server data
	async _syncDevice() {
		try {
			let status = await this.api.getWatermeter(this.config.waterApiVersion);

			if(status == false){
				this.setUnavailable(this.api.lastError)
				return
			} 

			if (status.length != 0) {
				if('title' in status){
					if(status.title == "404 Not Found"){
						this.config.waterApiVersion = "2";
						this.setSettings(this.config);
						this.log("Set WaterAPI to version 2")

						status = await this.api.getWatermeter(this.config.waterApiVersion);
					}
				}

				this.setAvailable();

				let TotalUsage = status[0].WATERMETER_CONSUMPTION_TOTAL_M3;
				let currentUsage = status[0].WATERMETER_CONSUMPTION_LITER;

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