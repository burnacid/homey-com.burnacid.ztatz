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
		this._syncDevice();

		// Set update timer
		this.intervalId = setInterval(this._syncDevice.bind(this), refreshTimeout);
		this.setSettings({
			url: device.url,
		});

		// console.log("register flow triggers");
	}

	async _deleteDevice() {
		this.log('_deleteDevice');

		clearInterval(this.intervalId);
	}

	// Update server data
	async _syncDevice() {
		try {
			let status = await this.api.getPowerGasDay();

			if (status.length != 0) {
				this.setAvailable();

				let consumptionDelta = status[0].CONSUMPTION_DELTA_KWH;
				let productionDelta = status[0].PRODUCTION_DELTA_KWH;
				let gasConsumptionDelta = status[0].CONSUMPTION_GAS_DELTA_M3;

				this.changeCapabilityValue('meter_power.consumed_today', Number(consumptionDelta));
				this.changeCapabilityValue('meter_power.production_today', Number(productionDelta));
				this.changeCapabilityValue('meter_gas.consumed_today', Number(gasConsumptionDelta));

			} else {
				this.setUnavailable('Cannot refresh / Connect');
			}


		} catch (error) {
			this.error(error);
			this.setUnavailable(error.message);
		}
	}
};