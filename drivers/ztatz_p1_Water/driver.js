'use strict';

const Driver = require('../../lib/Driver');

module.exports = class ztatzP1WaterDriver extends Driver {

    get pairName() {
        return 'P1 Water';
    }

    get pairType() {
        return 'SmartMeter_Water';
    }

};
