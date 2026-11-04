'use strict';

const Device = require('../../lib/Device');

const REFRESH_MS = 30 * 1000;

/** Central heating supply ("in") and return ("out") temperature from ZTATZ. */
module.exports = class ztatzP1HeatingDevice extends Device {

	async _initDevice() {
		this.log('_initDevice');
		this._flowTriggerHeatingInChanged = this.homey.flow.getDeviceTriggerCard('measure_temperature.in.changed');
		this._flowTriggerHeatingOutChanged = this.homey.flow.getDeviceTriggerCard('measure_temperature.out.changed');
		this._flowTriggerHeatingDeltaChanged = this.homey.flow.getDeviceTriggerCard('measure_temperature.delta.changed');
		this.poll('heating', () => this._syncDevice(), REFRESH_MS);
	}

	async _syncDevice() {
		const rows = await this.api.getHeating();
		this.writeDebug('[indoor/temperature] ' + JSON.stringify(rows));
		if (rows === false) return this.fail(this.api.lastError);
		if (rows.length === 0) return this.fail("ZTATZ doesn't contain heating information (is the heating sensor enabled?)");
		await this.ok();

		const heatingIn = Number(rows[0].ROOM_TEMPERATURE_IN);
		const heatingOut = Number(rows[0].ROOM_TEMPERATURE_OUT);
		const heatingDelta = Math.round((heatingIn - heatingOut) * 100) / 100;

		await this.changeCapabilityValue('measure_temperature.in', heatingIn, this._flowTriggerHeatingInChanged, { 'measure_temperature.in.temperature': heatingIn });
		await this.changeCapabilityValue('measure_temperature.out', heatingOut, this._flowTriggerHeatingOutChanged, { 'measure_temperature.out.temperature': heatingOut });
		await this.changeCapabilityValue('measure_temperature.delta', heatingDelta, this._flowTriggerHeatingDeltaChanged, { 'measure_temperature.delta.temperature': heatingDelta });
		return true;
	}

};
