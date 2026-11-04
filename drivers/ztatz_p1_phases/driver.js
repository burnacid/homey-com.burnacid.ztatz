'use strict';

const Driver = require('../../lib/Driver');

module.exports = class ztatzP1PhasesDriver extends Driver {

    get pairName() {
        return 'P1 Phases';
    }

    get pairType() {
        return 'Phases';
    }

};
