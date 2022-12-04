'use strict';

const Homey = require('homey');
const Device = require('../../lib/Device.js');
const boolean = require('boolean');

const refreshTimeout = 1000 * 10; // 10 sec

class ztatzP1Phases extends Device {

  // this method is called when the Device is inited
	async _initDevice() {
		this.log('_initDevice');
		const device = this.getData();

		// Set update timer
		this.intervalId = setInterval(this._syncDevice.bind(this), refreshTimeout);
		this.setSettings({
			url: device.url
		});

		console.log("register flow triggers");
		// register Flow triggers

	}

	async _deleteDevice() {
		this.log('_deleteDevice');

		clearInterval(this.intervalId);
	}
  
	// Update server data
	async _syncDevice() {
		try {
			let status = await this.api.getStatus();
			if (status.length != 0) {
				this.setAvailable();
				const settings = this.getSettings();

				let L1Voltage = this.api.filterValueByLabel(status,"Huidige Voltage L1 (32.7.0)")[0]['STATUS']
				let L2Voltage = this.api.filterValueByLabel(status,"Huidige Voltage L2 (52.7.0)")[0]['STATUS']
				let L3Voltage = this.api.filterValueByLabel(status,"Huidige Voltage L2 (72.7.0)")[0]['STATUS']

				let L1Power = this.api.filterValueByLabel(status,"Huidige KW verbruik L1 (21.7.0)")[0]['STATUS']*1000
				let L2Power = this.api.filterValueByLabel(status,"Huidige KW verbruik L2 (41.7.0)")[0]['STATUS']*1000
				let L3Power = this.api.filterValueByLabel(status,"Huidige KW verbruik L3 (61.7.0)")[0]['STATUS']*1000

				// Remove Phases
				if(L2Voltage == 0){
					if(this.hasCapability('measure_voltage.L2')){
						this.removeCapability('measure_voltage.L2');
						this.removeCapability('measure_current.L2');
						this.removeCapability('measure_power.L2');
					}
				}else{
					if(!this.hasCapability('measure_voltage.L2')){
						this.addCapability('measure_voltage.L2');
						this.addCapability('measure_current.L2');
						this.addCapability('measure_power.L2');
					}
				}

				if(L3Voltage == 0){
					if(this.hasCapability('measure_voltage.L3')){
						this.removeCapability('measure_voltage.L3');
						this.removeCapability('measure_current.L3');
						this.removeCapability('measure_power.L3');
					}
				}else{
					if(!this.hasCapability('measure_voltage.L3')){
						this.addCapability('measure_voltage.L3');
						this.addCapability('measure_current.L3');
						this.addCapability('measure_power.L3');
					}
				}

				let L1Amperage = 0;
				let L2Amperage = 0;
				let L3Amperage = 0;

				if(settings.calculated_amperage){
					L1Amperage = L1Power / L1Voltage;
					L2Amperage = L2Power / L2Voltage;
					L3Amperage = L3Power / L3Voltage;
				}else{
					L1Amperage = this.api.filterValueByLabel(status,"Huidige Amperage L1 (31.7.0)")[0]['STATUS']

					if(L2Voltage != 0){
						L2Amperage = this.api.filterValueByLabel(status,"Huidige Amperage L2 (51.7.0)")[0]['STATUS']
					}
					if(L3Voltage != 0){
						L3Amperage = this.api.filterValueByLabel(status,"Huidige Amperage L2 (71.7.0)")[0]['STATUS']
					}
				}

				this.changeCapabilityValue('measure_voltage.L1', Number(L1Voltage));
				this.changeCapabilityValue('measure_power.L1', Number(L1Power));
				this.changeCapabilityValue('measure_current.L1', Number(L1Amperage));

				if(L2Voltage != 0){
					this.changeCapabilityValue('measure_voltage.L2', Number(L2Voltage));
					this.changeCapabilityValue('measure_current.L2', Number(L2Amperage));
					this.changeCapabilityValue('measure_power.L2', Number(L2Power));
				}

				if(L3Voltage != 0){
					this.changeCapabilityValue('measure_current.L3', Number(L3Amperage));
					this.changeCapabilityValue('measure_voltage.L3', Number(L3Voltage));
					this.changeCapabilityValue('measure_power.L3', Number(L3Power));
				}

			} else {
				this.setUnavailable('Cannot refresh / Connect');
			}


		} catch (error) {
			this.error(error);
			this.setUnavailable(error.message);
		}
	}
}

module.exports = ztatzP1Phases;
