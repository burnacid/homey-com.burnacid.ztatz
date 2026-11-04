'use strict';

const Device = require('../../lib/Device');

const REFRESH_MS = 10 * 1000;
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Electricity delivered back to the grid, as measured by the smart meter.
 * This is not solar production, so the device is a plain sensor without
 * energy settings (the Usage device reports the export register to Energy).
 */
module.exports = class ztatzP1GenerationDevice extends Device {

	async _initDevice() {
		this.log('_initDevice');
		await this.ensureCapabilities(['measure_power', 'meter_power.generatedL1', 'meter_power.generatedL2', 'meter_power.generatedTotal']);
		await this.migrateDevice('sensor', {});

		this._flowTriggerPowerMeterL1Changed = this.homey.flow.getDeviceTriggerCard('meter_power.generatedL1.changed');
		this._flowTriggerPowerMeterL2Changed = this.homey.flow.getDeviceTriggerCard('meter_power.generatedL2.changed');
		this._flowTriggerPowerMeterTotalChanged = this.homey.flow.getDeviceTriggerCard('meter_power.generatedTotal.changed');

		this.poll('meter', () => this._syncDevice(), REFRESH_MS);
	}

	async _syncDevice() {
		const rows = await this.api.getSmartmeter();
		this.writeDebug('[smartmeter] ' + JSON.stringify(rows));
		if (rows === false) return this.fail(this.api.lastError);
		if (rows.length === 0) return this.fail('ZTATZ has no smart meter data yet');
		await this.ok();

		const r = rows[0];
		const low = Number(r.PRODUCTION_KWH_LOW);
		const high = Number(r.PRODUCTION_KWH_HIGH);
		const total = round3(low + high);

		await this.changeCapabilityValue('measure_power', Number(r.PRODUCTION_W));
		await this.changeCapabilityValue('meter_power.generatedL2', low, this._flowTriggerPowerMeterL2Changed, { 'meter_power.generatedL2': low });
		await this.changeCapabilityValue('meter_power.generatedL1', high, this._flowTriggerPowerMeterL1Changed, { 'meter_power.generatedL1': high });
		await this.changeCapabilityValue('meter_power.generatedTotal', total, this._flowTriggerPowerMeterTotalChanged, { 'meter_power.generatedTotal': total });
		return true;
	}

};
