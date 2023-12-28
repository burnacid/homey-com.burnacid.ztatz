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
		this.config = this.getSettings();
		this.config.debug = false
		this.refreshing = false
		this.setSettings({
			debug: false
		})

		// Test water API version
		let status = await this.api.getWatermeter(this.config.apiVersionWater);
		if(status === false || status.title == "404 Not Found"){
			if(this.config.apiVersionWater == "v2"){
				this.config.apiVersionWater = "v1"
			}else{
				this.config.apiVersionWater = "v2"
			}

			status = await this.api.getWatermeter(this.config.apiVersionWater);

			if(status !== false){
				this.log("API Version switched to "+ this.config.apiVersionWater)
				this.setSettings({
					apiVersionWater: this.config.apiVersionWater
				})
			}
		}

		// Register flowcard triggers
		//this._registerFlowCardTriggers();

		// Set update timer
		this.intervalId = setInterval(this._syncDevice.bind(this), refreshTimeout);

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

	async onSettings({ oldSettings, newSettings, changedKeys }) {
		this.config = newSettings
	}

	// Update server data
	async _syncDevice() {
		if(this.refreshing){
			this.setWarning("Refresh seems to take long...")
			this.writeDebug("Already refreshing")
			return
		}

		this.writeDebug("Refresh from "+ this.config.url)
		try {
			this.refreshing = true
			let status = await this.api.getWatermeter(this.config.apiVersionWater);
			this.writeDebug("["+this.config.url+"] [STATUS] "+ JSON.stringify(status))
			this.refreshing = false

			if(status == false){
				this.setUnavailable(this.api.lastError)
				this.writeDebug("["+this.config.url+"] [ERROR] "+ this.api.lastError)
				return
			} 

			if (status.length != 0) {
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