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
		this.config = this.getSettings();
		this.config.debug = false
		this.setSettings({
			debug: false
		})

		// Test water API version
		let status = await this.api.getWaterDay(this.config.apiVersionWater);
		if(status === false || status.title == "404 Not Found"){
			if(this.config.apiVersionWater == "v2"){
				this.config.apiVersionWater = "v1"
			}else{
				this.config.apiVersionWater = "v2"
			}

			status = await this.api.getWaterDay(this.config.apiVersionWater);

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
		this._flowTriggerGasUsageTodayReset = this.homey.flow.getDeviceTriggerCard('meter_gas.consumed_today.reset');
		this._flowTriggerPowerMeterProductionReset = this.homey.flow.getDeviceTriggerCard('meter_power.production_today.reset');
		this._flowTriggerPowerMeterConsumptionReset = this.homey.flow.getDeviceTriggerCard('meter_power.consumed_today.reset');
		this._flowTriggerWaterMeterConsumptionReset = this.homey.flow.getDeviceTriggerCard('meter_water.consumed_today.reset');
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
		this.writeDebug("Refresh from "+ this.config.url)
		try {
			let statusPowerGas = await this.api.getPowerGasDay();
			this.writeDebug("["+this.config.url+"] [STATUS] "+ JSON.stringify(statusPowerGas))
			let statusWaterMeter = await this.api.getWaterDay(this.config.apiVersionWater);
			this.writeDebug("["+this.config.url+"/"+this.config.apiVersionWater+"] [STATUS] "+ JSON.stringify(statusWaterMeter))

			if(statusPowerGas == false){
				this.setUnavailable(this.api.lastError)
				this.writeDebug("["+this.config.url+"] [ERROR] "+ this.api.lastError)
				return
			}

			if (statusPowerGas.length != 0) {
				this.setAvailable();

				let consumptionDelta = statusPowerGas[0].CONSUMPTION_DELTA_KWH;
				let productionDelta = statusPowerGas[0].PRODUCTION_DELTA_KWH;
				let gasConsumptionDelta = statusPowerGas[0].CONSUMPTION_GAS_DELTA_M3;

				// Check of record is from today
				let statusPowerGasDate = new Date(Date.parse(statusPowerGas[0].TIMESTAMP_LOCAL)).toDateString()
				if(!this.api.isToday(statusPowerGasDate)){
					this.writeDebug("["+this.config.url+"/"+this.config.apiVersionWater+"] [INFO] Last record not today. Setting values to 0")
					consumptionDelta = 0;
					productionDelta = 0;
					gasConsumptionDelta = 0;
				}		

				let currentConsumptionDelta = this.getCapabilityValue('meter_power.consumed_today');
				if((currentConsumptionDelta * 0.2) > Number(consumptionDelta)){
					this.changeCapabilityValue('meter_power.consumed_today', Number(consumptionDelta), this._flowTriggerPowerMeterConsumptionReset, {'meter_power.todaystotalconsumed': currentConsumptionDelta});
				}else{
					this.changeCapabilityValue('meter_power.consumed_today', Number(consumptionDelta));
				}

				let currentProductionDelta = this.getCapabilityValue('meter_power.production_today');
				if((currentProductionDelta * 0.2) > Number(productionDelta)){
					this.changeCapabilityValue('meter_power.production_today', Number(productionDelta), this._flowTriggerPowerMeterProductionReset, {'meter_power.todaystotalproduced': currentProductionDelta});
				}else{
					this.changeCapabilityValue('meter_power.production_today', Number(productionDelta));
				}

				let currentGasValue = this.getCapabilityValue('meter_gas.consumed_today');
				if((currentGasValue * 0.2) > Number(gasConsumptionDelta)){
					this.changeCapabilityValue('meter_gas.consumed_today', Number(gasConsumptionDelta), this._flowTriggerGasUsageTodayReset, {'meter_gas.todaystotal': currentGasValue});
				}else{
					this.changeCapabilityValue('meter_gas.consumed_today', Number(gasConsumptionDelta));
				}

				if(statusWaterMeter.length != 0){
					// If water is not present add it
					if(!this.hasCapability('meter_water.consumed_today')){
						this.addCapability('meter_water.consumed_today');
						this._flowTriggerWaterMeterConsumptionReset = this.homey.flow.getDeviceTriggerCard('meter_water.consumed_today.reset');
					}
					
					let waterConsumptionDelta = statusWaterMeter[0].WATERMETER_CONSUMPTION_LITER;

					// Check of record is from today
					let statusWaterMeterDate = new Date(Date.parse(statusWaterMeter[0].TIMESTAMP_LOCAL)).toDateString()
					if(!this.api.isToday(statusWaterMeterDate)){
						this.writeDebug("["+this.config.url+"/"+this.config.apiVersionWater+"] [INFO] Last record not today. Setting values to 0")
						waterConsumptionDelta = 0;
					}					

					let currentWaterValue = this.getCapabilityValue('meter_water.consumed_today');
					if((currentWaterValue * 0.2) > Number(waterConsumptionDelta)){
						this.changeCapabilityValue('meter_water.consumed_today', Number(waterConsumptionDelta), this._flowTriggerWaterMeterConsumptionReset, {'meter_water.resetconsumed_today': currentWaterValue});
					}else{
						this.changeCapabilityValue('meter_water.consumed_today', Number(waterConsumptionDelta));
					}
				}else{
					// If water is present remove it
					if(this.hasCapability('meter_water.consumed_today')){
						this.removeCapability('meter_water.consumed_today');
					}

					// No longer needed SDKv3
					//if(this._flowTriggerWaterMeterConsumptionReset){
					//	   this._flowTriggerWaterMeterConsumptionReset.unregister();
					//}
				}

			} else {
				this.setUnavailable('Cannot refresh / Connect');
			}


		} catch (error) {
			this.error(error);
			this.setUnavailable(error.message);
		}
	}
};