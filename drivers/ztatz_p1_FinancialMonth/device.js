'use strict';

const Device = require('../../lib/Device');

const REFRESH_MS = 60 * 1000;
const money = (x) => Math.round(Number(x) * 100) / 100;

module.exports = class ztatzP1FinancialMonthDevice extends Device {

	async _initDevice() {
		this.log('_initDevice');
		await this.ensureCapabilities(['money.monthused', 'money.monthgen', 'money.monthgas', 'money.monthwater']);
		this.poll('financial', () => this._syncDevice(), REFRESH_MS);
	}

	async _syncDevice() {
		const rows = await this.api.getFinancialMonth();
		this.writeDebug('[financial/month] ' + JSON.stringify(rows));
		if (rows === false) return this.fail(this.api.lastError);
		if (rows.length === 0) return this.fail('ZTATZ has no financial data yet');
		await this.ok();

		// on the first of the month the newest record can still be last month's
		const r = this.isCurrentPeriod(rows[0].TIMESTAMP_lOCAL, 7) ? rows[0] : {};
		await this.changeCapabilityValue('money.monthused', money((r.CONSUMPTION_COST_ELECTRICITY_HIGH || 0) + (r.CONSUMPTION_COST_ELECTRICITY_LOW || 0)));
		await this.changeCapabilityValue('money.monthgen', money((r.PRODUCTION_REVENUES_ELECTRICITY_HIGH || 0) + (r.PRODUCTION_REVENUES_ELECTRICITY_LOW || 0)));
		await this.changeCapabilityValue('money.monthgas', money(r.CONSUMPTION_COST_GAS || 0));
		await this.changeCapabilityValue('money.monthwater', money(r.CONSUMPTION_COST_WATER || 0));
		return true;
	}

};
