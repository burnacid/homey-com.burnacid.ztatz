const Homey = require('homey');
const Api = require('../../lib/Api');
const Driver = require('../../lib/Driver');

let foundDevices = [];

module.exports = class ztatzP1SmartMeterNoGenDriver extends Driver {

  // This method is called when a user is adding a device
  // and the 'list_devices' view is called   

    async _onPairSearchDevices (data, callback) {
        this.log('_onPairSearchDevices');
        
        foundDevices = []

        const api = new Api(data);

        await api.testConnection()
            .then( result => {
                if(result){

                    foundDevices = [{
                        name: "P1 SmartMeter ("+data.url+")",
                        data: data
                    }];
                }else{
                    this.log('No Result');
                    console.error('processData', data);
                    throw new Error(Homey.__('error.permission_denied'));
                }
            }). catch( error => {
                callback(error);
            });

        callback(null, true);
    }

    async _onPairListDevices (data, callback) {
        this.log('_onPairListDevices');
        this.log(foundDevices);

        callback(null, foundDevices);
    }

}