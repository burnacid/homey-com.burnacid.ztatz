'use strict';

const Driver = require('../../lib/Driver');

module.exports = class ztatzP1DailyUsageDriver extends Driver {

    get pairName() {
        return 'P1 Daily Usage';
    }

    get pairType() {
        return 'SmartMeter_Usage';
    }

};
