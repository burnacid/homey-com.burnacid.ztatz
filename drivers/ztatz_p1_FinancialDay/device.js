'use strict';

const Device = require('../../lib/Device');

const REFRESH_MS = 60 * 1000;
const money = (x) => Math.round(Number(x) * 100) / 100;

module.exports = class ztatzP1FinancialDayDevice extends Device {

	async _initDevice() {
		this.log('_initDevice');
		await this.ensureCapabilities(['money.todayused', 'money.todaygen', 'money.todaygas', 'money.todaywater']);
		this.poll('financial', () => this._syncDevice(), REFRESH_MS);
	}

	async _syncDevice() {
		const rows = await this.api.getFinancialDay();
		this.writeDebug('[financial/day] ' + JSON.stringify(rows));
		if (rows === false) return this.fail(this.api.lastError);
		if (rows.length === 0) return this.fail('ZTATZ has no financial data yet');
		await this.ok();

		// right after midnight the newest record is still yesterday's
		const r = this.isCurrentPeriod(rows[0].TIMESTAMP_lOCAL, 10) ? rows[0] : {};
		await this.changeCapabilityValue('money.todayused', money((r.CONSUMPTION_COST_ELECTRICITY_HIGH || 0) + (r.CONSUMPTION_COST_ELECTRICITY_LOW || 0)));
		await this.changeCapabilityValue('money.todaygen', money((r.PRODUCTION_REVENUES_ELECTRICITY_HIGH || 0) + (r.PRODUCTION_REVENUES_ELECTRICITY_LOW || 0)));
		await this.changeCapabilityValue('money.todaygas', money(r.CONSUMPTION_COST_GAS || 0));
		await this.changeCapabilityValue('money.todaywater', money(r.CONSUMPTION_COST_WATER || 0));
		return true;
	}

};
