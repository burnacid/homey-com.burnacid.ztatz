'use strict';

const Driver = require('../../lib/Driver');

module.exports = class ztatzP1SolarpanelDriver extends Driver {

    get pairName() {
        return 'ZTATZ Solarpanel Meter';
    }

    get pairType() {
        return 'SmartMeter_Solarpanels';
    }

};
