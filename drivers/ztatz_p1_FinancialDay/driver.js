'use strict';

const Driver = require('../../lib/Driver');

module.exports = class ztatzP1FinancialDayDriver extends Driver {

    get pairName() {
        return 'P1 Financial Day';
    }

    get pairType() {
        return 'FinancialDay';
    }

};
