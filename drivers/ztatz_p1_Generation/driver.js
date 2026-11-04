'use strict';

const Driver = require('../../lib/Driver');

module.exports = class ztatzP1GenerationDriver extends Driver {

    get pairName() {
        return 'P1 Generation';
    }

    get pairType() {
        return 'SmartMeter_Generation';
    }

};
