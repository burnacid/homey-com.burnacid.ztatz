'use strict';

const Device = require('../../lib/Device');

const REFRESH_MS = 60 * 1000; // ZTATZ updates the day records once per minute

module.exports = class ztatzP1DailyUsageDevice extends Device {

	async _initDevice() {
		this.log('_initDevice');
		this._flowTriggerGasUsageTodayReset = this.homey.flow.getDeviceTriggerCard('meter_gas.consumed_today.reset');
		this._flowTriggerPowerMeterProductionReset = this.homey.flow.getDeviceTriggerCard('meter_power.production_today.reset');
		this._flowTriggerPowerMeterConsumptionReset = this.homey.flow.getDeviceTriggerCard('meter_power.consumed_today.reset');
		this._flowTriggerWaterMeterConsumptionReset = this.homey.flow.getDeviceTriggerCard('meter_water.consumed_today.reset');

		this.poll('day', () => this._syncDevice(), REFRESH_MS);
	}

	/**
	 * Set a "today" counter. A large drop means a new day started: fire the
	 * reset trigger with yesterday's total.
	 */
	async _setDaily(capability, value, trigger, tokenName) {
		const current = this.getCapabilityValue(capability);
		if (current !== null && current * 0.2 > value) {
			return this.changeCapabilityValue(capability, value, trigger, { [tokenName]: current });
		}
		return this.changeCapabilityValue(capability, value);
	}

	async _syncDevice() {
		const days = await this.api.getPowerGasDay();
		this.writeDebug('[powergas/day] ' + JSON.stringify(days));
		if (days === false) return this.fail(this.api.lastError);
		if (days.length === 0) return this.fail('ZTATZ has no day data yet');

		const meterId = await this.waterMeterId();
		const water = await this.api.getWater('day', meterId, 1);
		this.writeDebug('[water/day ' + meterId + '] ' + JSON.stringify(water));
		if (water === false) return this.fail(this.api.lastError);
		await this.ok();

		// Right after midnight the newest day record is still yesterday's.
		const day = days[0];
		const today = this.isCurrentPeriod(day.TIMESTAMP_lOCAL);
		if (!today) this.writeDebug('[INFO] last day record is not from today, using 0');

		await this._setDaily('meter_power.consumed_today', today ? Number(day.CONSUMPTION_DELTA_KWH) : 0,
			this._flowTriggerPowerMeterConsumptionReset, 'meter_power.todaystotalconsumed');
		await this._setDaily('meter_power.production_today', today ? Number(day.PRODUCTION_DELTA_KWH) : 0,
			this._flowTriggerPowerMeterProductionReset, 'meter_power.todaystotalproduced');
		await this._setDaily('meter_gas.consumed_today', today ? Number(day.CONSUMPTION_GAS_DELTA_M3) : 0,
			this._flowTriggerGasUsageTodayReset, 'meter_gas.todaystotal');

		if (water.length > 0) {
			await this.ensureCapabilities(['meter_water.consumed_today']);
			const litres = this.isCurrentPeriod(water[0].TIMESTAMP_lOCAL) ? Number(water[0].WATERMETER_CONSUMPTION_LITER) : 0;
			await this._setDaily('meter_water.consumed_today', litres,
				this._flowTriggerWaterMeterConsumptionReset, 'meter_water.resetconsumed_today');
		} else if (this.hasCapability('meter_water.consumed_today')) {
			await this.removeCapability('meter_water.consumed_today').catch(this.error);
		}
		return true;
	}

};
