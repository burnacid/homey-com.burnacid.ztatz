'use strict';

const Homey = require('homey');
const Api = require('./Api');

/**
 * Base class for all ZTATZ devices.
 *
 * Subclasses implement `_initDevice()` and register their refresh functions
 * with `this.poll(name, fn, intervalMs)`. A refresh function returns true when
 * it updated the device, or calls `this.fail(message)` (which returns false).
 */
class Device extends Homey.Device {

    async onInit() {
        this.log('onInit');
        const data = this.getData();

        this.api = new Api({ url: data.url, apiKey: this.getSetting('apiKey') });
        this.config = this.getSettings();
        this.config.debug = false;
        this._timers = [];
        this._busy = {};
        this._warning = false;

        await this.setSettings({ url: this.api.config.url, debug: false }).catch(this.error);

        try {
            await this._initDevice();
        } catch (error) {
            this.error('init failed', error);
            await this.setUnavailable(error.message).catch(this.error);
        }
    }

    async onSettings({ newSettings, changedKeys }) {
        this.config = newSettings;
        if (changedKeys.includes('apiKey')) {
            this.api.setApiKey(newSettings.apiKey);
        }
    }

    onDeleted() {
        this.log('onDeleted');
        this._stopPolling();
    }

    onUninit() {
        this._stopPolling();
    }

    // --- polling -----------------------------------------------------------------

    /** Run `fn` now and then every `interval` ms, never overlapping itself. */
    poll(name, fn, interval) {
        const run = async () => {
            if (this._busy[name]) {
                this._warning = true;
                await this.setWarning('Refresh seems to take long...').catch(this.error);
                this.writeDebug('[' + name + '] already refreshing');
                return;
            }
            this._busy[name] = true;
            try {
                const ok = await fn();
                if (ok !== false && this._warning) {
                    this._warning = false;
                    await this.unsetWarning().catch(this.error);
                }
            } catch (error) {
                this.error('[' + name + ']', error);
                await this.setUnavailable(error.message).catch(this.error);
            } finally {
                this._busy[name] = false;
            }
        };
        this._timers.push(this.homey.setInterval(run, interval));
        run();
    }

    _stopPolling() {
        for (const timer of this._timers || []) {
            this.homey.clearInterval(timer);
        }
        this._timers = [];
    }

    /** Mark the device available (only calls Homey when the state changes). */
    async ok() {
        if (!this.getAvailable()) {
            await this.setAvailable().catch(this.error);
        }
        return true;
    }

    /** Mark the device unavailable with a message; returns false. */
    async fail(message) {
        this.writeDebug('[ERROR] ' + message);
        await this.setUnavailable(message || 'Cannot refresh / connect').catch(this.error);
        return false;
    }

    // --- helpers -------------------------------------------------------------------

    async changeCapabilityValue(capability, value, flowTrigger = null, tokens = null, state = null) {
        if (!this.hasCapability(capability)) {
            this.writeDebug(capability + " doesn't exist");
            return false;
        }
        if (value === null || value === undefined || Number.isNaN(value)) {
            this.writeDebug(capability + ' got no valid value: ' + value);
            return false;
        }
        try {
            if (this.getCapabilityValue(capability) !== value) {
                await this.setCapabilityValue(capability, value);
                if (flowTrigger) {
                    await flowTrigger.trigger(this, tokens || {}, state || {});
                }
            }
            return true;
        } catch (error) {
            this.error('changeCapabilityValue', capability, error.message);
            return false;
        }
    }

    async ensureCapabilities(capabilities) {
        for (const capability of capabilities) {
            if (!this.hasCapability(capability)) {
                await this.addCapability(capability).catch(this.error);
            }
        }
    }

    /** Update class / energy settings of devices that were paired by an older app version. */
    async migrateDevice(deviceClass, energy) {
        if (deviceClass && this.getClass() !== deviceClass) {
            await this.setClass(deviceClass).catch(this.error);
        }
        if (energy && typeof this.setEnergy === 'function') {
            const current = (typeof this.getEnergy === 'function' && this.getEnergy()) || {};
            if (JSON.stringify(current) !== JSON.stringify(energy)) {
                await this.setEnergy(energy).catch(this.error);
            }
        }
    }

    writeDebug(msg) {
        if (this.config && this.config.debug) {
            this.log(msg);
        }
    }

    /** Local 'YYYY-MM-DD HH:MM:SS' in the Homey timezone (same format as ZTATZ timestamps). */
    localNow() {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: this.homey.clock.getTimezone(),
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }).formatToParts(new Date());
        const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
        return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second;
    }

    /** True when a ZTATZ local timestamp lies in the current day (length 10) or month (length 7). */
    isCurrentPeriod(localTimestamp, length = 10) {
        return String(localTimestamp || '').slice(0, length) === this.localNow().slice(0, length);
    }

    /** Pick the water meter: 1 = pulse meter, 2 = digital P1 meter (detected once). */
    async waterMeterId() {
        let id = String(this.getSetting('waterMeterId') || '1');
        if (!this.getStoreValue('waterMeterChecked')) {
            // only decide once one of the meters has data
            const pulse = await this.api.getWater('hour', 1, 1);
            if (Array.isArray(pulse) && pulse.length > 0) {
                await this.setStoreValue('waterMeterChecked', true).catch(this.error);
            } else if (Array.isArray(pulse)) {
                const digital = await this.api.getWater('hour', 2, 1);
                if (Array.isArray(digital) && digital.length > 0) {
                    id = '2';
                    this.log('digital water meter detected');
                    await this.setSettings({ waterMeterId: id }).catch(this.error);
                    await this.setStoreValue('waterMeterChecked', true).catch(this.error);
                }
            }
        }
        return id;
    }

}

module.exports = Device;
