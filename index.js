/**
 * SNMP plugin V5.5
 */
const util = require('util');

// const plugin = require('ih-plugin-api')();
const app = require('./app');

(async () => {
  let plugin;
  try {
    const opt = getOptFromArgs();
    const pluginapi = opt && opt.pluginapi ? opt.pluginapi : 'ih-plugin-api';
    plugin = require(pluginapi+'/index.js')();

    plugin.log('SNMP plugin has started.', 0);

    plugin.params = await plugin.params.get();
    plugin.log('Received params...', 1);

    plugin.channels = await plugin.channels.get();
    
    plugin.log('Received channels...'+util.inspect(plugin.channels), 1);

    app(plugin);
  } catch (err) {
    plugin.exit(8, `Error! Message: ${util.inspect(err)}`);
  }
})();



function getOptFromArgs() {
  let opt;
  try {
    opt = JSON.parse(process.argv[2]); //
  } catch (e) {
    opt = {};
  }
  return opt;
}
