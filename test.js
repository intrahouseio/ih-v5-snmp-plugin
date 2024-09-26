const snmp = require('net-snmp');

const session = snmp.createSession('192.168.0.222', 'public', { 
  retries: 0,
  timeout: 5000,
  port: 161, 
  transport: 'udp4',
  version: snmp.Version2c,
  sourcePort: 163,
});

session.get(['1.3.6.1.4.1.51014.9.1.9.0'], function(error, varbinds) {
  console.log('msg');
  if (error) {
    console.error(error);
  } else {
    console.log(varbinds);
  }
});

setInterval(() => {}, 10000);