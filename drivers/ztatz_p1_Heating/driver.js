'use strict';

const Driver = require('../../lib/Driver');

module.exports = class ztatzP1HeatingDriver extends Driver {

    get pairName() {
        return 'P1 Heating';
    }

    get pairType() {
        return 'Heating';
    }

};
