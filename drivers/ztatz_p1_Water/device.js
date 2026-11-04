'use strict';

const Device = require('../../lib/Device');

const REFRESH_MS = 60 * 1000; // ZTATZ processes water data once per minute

module.exports = class ztatzP1WaterMeterDevice extends Device {

	async _initDevice() {
		this.log('_initDevice');
		await this.migrateDevice('sensor', { cumulative: true });
		this.poll('water', () => this._syncDevice(), REFRESH_MS);
	}

	async _syncDevice() {
		const meterId = await this.waterMeterId();
		// the newest minute record of a pulse meter is still being filled, use the one before
		const rows = await this.api.getWater('minute', meterId, 2);
		this.writeDebug('[water ' + meterId + '] ' + JSON.stringify(rows));
		if (rows === false) return this.fail(this.api.lastError);
		if (rows.length === 0) return this.fail('ZTATZ has no data for water meter ' + meterId);
		await this.ok();

		const completed = rows[1] || rows[0];
		await this.changeCapabilityValue('measure_water', Number(completed.WATERMETER_CONSUMPTION_LITER)); // L in one minute = L/min
		await this.changeCapabilityValue('meter_water', Number(rows[0].WATERMETER_CONSUMPTION_TOTAL_M3));
		return true;
	}

};
