'use strict';

const Homey = require('homey');
const Api = require('./Api');

class Device extends Homey.Device {

    onInit() {
        this.log('onInit');

        const device = this.getData();
        this.api = new Api(device);

        this.setSettings({
            url: device.url,
        });

        console.log(device);

        this._initDevice();
    }

    onDeleted() {
        this.log('onDeleted');
        this._deleteDevice();
    }


    onAdded() {
        this.log('onAdded');
        this._syncDevice();
    }

    /*
    onRenamed () {
        this.log('onRenamed');
    }
    */

    changeCapabilityValue(capability,value,flowTrigger=null,tokens=null,state=null) {
        try{
            if(!this.hasCapability(capability)){
                this.log(capability + " doesn't exist")
                return false
            }

            let currentValue = this.getCapabilityValue(capability)
            if(currentValue != value){
                this.setCapabilityValue(capability,value);

                if(flowTrigger != null){
                    flowTrigger.trigger(this, tokens, state).catch(this.error);
                }
            }
        }catch(error) {
            this.log(error.message)
        }
    }

    writeDebug(msg){
        if(this.config.debug){
            this.log(msg)
        }
    }

    unixTimestamp () {  
        return Math.floor(Date.now() / 1000)
    }

    timestampWithinToday(timestamp){
        let now = this.unixTimestamp()
        let diff = now - timestamp
        this.writeDebug("[Time Calculation] "+now+" - "+timestamp+" (Difference: "+diff+")")
        if(diff < 86400){
            return true
        }else{
            return false
        }
    }
    
};

module.exports = Device;