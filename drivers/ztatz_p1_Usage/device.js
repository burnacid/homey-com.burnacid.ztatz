'use strict';

const Device = require('../../lib/Device');

const REFRESH_MS = 10 * 1000; // ZTATZ stores a smart meter record every ~10 s
const VERSION_REFRESH_MS = 5 * 60 * 1000;
const round3 = (x) => Math.round(x * 1000) / 1000;

const ENERGY = {
	cumulative: true,
	cumulativeImportedCapability: 'meter_power.total',
	cumulativeExportedCapability: 'meter_power.exported',
};

module.exports = class ztatzP1UsageDevice extends Device {

	async _initDevice() {
		this.log('_initDevice');

		// devices paired with older versions miss capabilities / energy settings
		await this.ensureCapabilities([
			'measure_power', 'meter_power.consumedL1', 'meter_power.consumedL2', 'meter_power.total',
			'meter_power.exported', 'meter_gas', 'tariff_high', 'version_number',
		]);
		await this.migrateDevice('sensor', ENERGY);

		this._flowTriggerPowerMeterL1Changed = this.homey.flow.getDeviceTriggerCard('meter_power.consumedL1.changed');
		this._flowTriggerPowerMeterL2Changed = this.homey.flow.getDeviceTriggerCard('meter_power.consumedL2.changed');
		this._flowTriggerPowerMeterTotalChanged = this.homey.flow.getDeviceTriggerCard('meter_power.consumedTotal.changed');
		this._flowTriggerGasMeterChanged = this.homey.flow.getDeviceTriggerCard('meter_gas.changed');
		this._flowTriggerVersionChanged = this.homey.flow.getDeviceTriggerCard('version_number.changed');

		this.poll('meter', () => this._syncMeter(), REFRESH_MS);
		this.poll('version', () => this._syncVersion(), VERSION_REFRESH_MS);
	}

	async _syncMeter() {
		const rows = await this.api.getSmartmeter();
		this.writeDebug('[smartmeter] ' + JSON.stringify(rows));
		if (rows === false) return this.fail(this.api.lastError);
		if (rows.length === 0) return this.fail('ZTATZ has no smart meter data yet');
		await this.ok();

		const r = rows[0];
		const usageLow = Number(r.CONSUMPTION_KWH_LOW);
		const usageHigh = Number(r.CONSUMPTION_KWH_HIGH);
		const usageTotal = round3(usageLow + usageHigh);
		const exportTotal = round3(Number(r.PRODUCTION_KWH_LOW) + Number(r.PRODUCTION_KWH_HIGH));
		const gas = Number(r.CONSUMPTION_GAS_M3);

		// net power: negative while delivering to the grid
		await this.changeCapabilityValue('measure_power', Number(r.CONSUMPTION_W) - Number(r.PRODUCTION_W));
		await this.changeCapabilityValue('meter_power.consumedL2', usageLow, this._flowTriggerPowerMeterL2Changed, { 'meter_power.consumedL2': usageLow });
		await this.changeCapabilityValue('meter_power.consumedL1', usageHigh, this._flowTriggerPowerMeterL1Changed, { 'meter_power.consumedL1': usageHigh });
		await this.changeCapabilityValue('meter_power.total', usageTotal, this._flowTriggerPowerMeterTotalChanged, { 'meter_power.consumedTotal': usageTotal });
		await this.changeCapabilityValue('meter_power.exported', exportTotal);
		await this.changeCapabilityValue('meter_gas', gas, this._flowTriggerGasMeterChanged, { meter_gas: gas });
		await this.changeCapabilityValue('tariff_high', r.TARIFCODE === 'P');
		return true;
	}

	/**
	 * ZTATZ only fills the "Laatste P1 monitor versie ..." rows when a newer
	 * version exists (and the version check is enabled), and clears them again
	 * after updating. Only a real new version may fire the flow trigger.
	 */
	async _syncVersion() {
		const status = await this.api.getStatus();
		const configuration = await this.api.getConfiguration();
		if (status === false || configuration === false) {
			this.writeDebug('[version] ' + this.api.lastError);
			return true; // the meter poll decides availability
		}

		const statusValue = (label) => (this.api.filterValueByLabel(status, label)[0] || {}).STATUS;
		const latestNumber = Number(statusValue('Laatste P1 monitor versie nummer:')) || 0;
		const currentNumber = Number((this.api.filterValueByLabel(configuration, 'Versie nummer:')[0] || {}).PARAMETER) || 0;
		const flag = statusValue('Nieuwe versie van P1 monitor software beschikbaar:');
		const newAvailable = flag === undefined ? latestNumber > currentNumber : flag === '1';

		if (!newAvailable || latestNumber <= 0) {
			await this.changeCapabilityValue('version_number', 0);
			return true;
		}

		await this.changeCapabilityValue('version_number', latestNumber, this._flowTriggerVersionChanged, {
			version: String(statusValue('Laatste P1 monitor versie:') || ''),
			version_number: latestNumber,
			version_url: String(statusValue('Laatste P1 monitor versie URL:') || ''),
			version_date: String(statusValue('Laatste P1 monitor versie datum:') || ''),
			version_name: String(statusValue('Laatste P1 monitor versie tekst:') || ''),
			current_version_number: currentNumber,
		});
		return true;
	}

};
