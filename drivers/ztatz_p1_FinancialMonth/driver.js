'use strict';

const Driver = require('../../lib/Driver');

module.exports = class ztatzP1FinancialMonthDriver extends Driver {

    get pairName() {
        return 'P1 Financial Month';
    }

    get pairType() {
        return 'FinancialMonth';
    }

};
