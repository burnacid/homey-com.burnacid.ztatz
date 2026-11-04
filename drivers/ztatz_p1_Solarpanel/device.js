'use strict';

const Device = require('../../lib/Device');

const REFRESH_MS = 30 * 1000;

/**
 * Solar production from the ZTATZ kWh (S0) pulse meter.
 * ZTATZ adds pulses to the record of the current minute, so the newest
 * minute record is incomplete; power is taken from the last completed minute.
 */
module.exports = class ztatzP1SolarpanelDevice extends Device {

	async _initDevice() {
		this.log('_initDevice');
		await this.ensureCapabilities(['measure_power', 'meter_power.high', 'meter_power.low', 'meter_power']);
		if (this.hasCapability('version_number')) {
			await this.removeCapability('version_number').catch(this.error);
		}
		this._lastMinute = null;
		this.poll('solar', () => this._syncDevice(), REFRESH_MS);
	}

	async _syncDevice() {
		const rows = await this.api.getSolarpanel();
		this.writeDebug('[powerproduction/minute] ' + JSON.stringify(rows));
		if (rows === false) return this.fail(this.api.lastError);
		if (rows.length === 0) return this.fail('ZTATZ has no kWh meter (S0) production data, is the S0 meter enabled?');
		await this.ok();

		const latest = rows[0];
		const completed = rows[1] || rows[0];
		if (completed.TIMESTAMP_lOCAL !== this._lastMinute) {
			this._lastMinute = completed.TIMESTAMP_lOCAL;
			const kwh = Number(completed.PRODUCTION_KWH_HIGH) + Number(completed.PRODUCTION_KWH_LOW);
			await this.changeCapabilityValue('measure_power', Math.round(kwh * 60 * 1000)); // kWh per minute -> W
		}

		await this.changeCapabilityValue('meter_power.high', Number(latest.PRODUCTION_KWH_HIGH_TOTAL));
		await this.changeCapabilityValue('meter_power.low', Number(latest.PRODUCTION_KWH_LOW_TOTAL));
		await this.changeCapabilityValue('meter_power', Number(latest.PRODUCTION_KWH_TOTAL));
		return true;
	}

};
