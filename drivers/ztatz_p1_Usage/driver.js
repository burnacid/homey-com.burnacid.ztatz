'use strict';

const Driver = require('../../lib/Driver');

module.exports = class ztatzP1UsageDriver extends Driver {

    get pairName() {
        return 'P1 Usage';
    }

    get pairType() {
        return 'SmartMeter_Usage';
    }

};
