'use strict';

const Device = require('../../lib/Device');

const REFRESH_MS = 10 * 1000;

// Status labels per phase. ZTATZ 2.4.1 used "L2" in the L3 labels, those are tried second.
const LABELS = {
	voltage: [['Huidige Voltage L1 (32.7.0)'], ['Huidige Voltage L2 (52.7.0)'], ['Huidige Voltage L3 (72.7.0)', 'Huidige Voltage L2 (72.7.0)']],
	current: [['Huidige Amperage L1 (31.7.0)'], ['Huidige Amperage L2 (51.7.0)'], ['Huidige Amperage L3 (71.7.0)', 'Huidige Amperage L2 (71.7.0)']],
	consumed: [['Huidige KW verbruik L1 (21.7.0)'], ['Huidige KW verbruik L2 (41.7.0)'], ['Huidige KW verbruik L3 (61.7.0)']],
	delivered: [['Huidige KW levering L1 (22.7.0)'], ['Huidige KW levering L2 (42.7.0)'], ['Huidige KW levering L3 (62.7.0)']],
};

class ztatzP1Phases extends Device {

	async _initDevice() {
		this.log('_initDevice');
		this.poll('phases', () => this._syncDevice(), REFRESH_MS);
	}

	async _setPhaseVisible(phase, visible) {
		const caps = ['measure_voltage.' + phase, 'measure_current.' + phase, 'measure_power.' + phase];
		if (visible && !this.hasCapability(caps[0])) {
			await this.ensureCapabilities(caps);
		} else if (!visible && this.hasCapability(caps[0])) {
			for (const cap of caps) await this.removeCapability(cap).catch(this.error);
		}
	}

	async _syncDevice() {
		const status = await this.api.getStatus();
		if (status === false) return this.fail(this.api.lastError);
		if (status.length === 0) return this.fail('ZTATZ returned no status information');
		await this.ok();

		const value = (labels) => {
			for (const label of labels) {
				const row = this.api.filterValueByLabel(status, label)[0];
				if (row) return Number(row.STATUS) || 0;
			}
			return 0;
		};
		const settings = this.getSettings();

		for (let i = 0; i < 3; i++) {
			const phase = 'L' + (i + 1);
			const voltage = value(LABELS.voltage[i]);
			// net power per phase: negative while this phase delivers (e.g. solar inverter)
			const power = Math.round((value(LABELS.consumed[i]) - value(LABELS.delivered[i])) * 1000);
			let current;
			if (voltage === 0) current = 0;
			else if (settings.calculated_amperage) current = Math.round((Math.abs(power) / voltage) * 100) / 100;
			else current = value(LABELS.current[i]);

			const visible = i === 0 || voltage !== 0 || settings.phases_all === true;
			if (i > 0) await this._setPhaseVisible(phase, visible);
			if (!visible) continue;

			await this.changeCapabilityValue('measure_power.' + phase, power);
			await this.changeCapabilityValue('measure_voltage.' + phase, voltage);
			await this.changeCapabilityValue('measure_current.' + phase, current);
		}
		return true;
	}

}

module.exports = ztatzP1Phases;
