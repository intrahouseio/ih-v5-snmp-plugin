const child = require('child_process');
const modulepath = './index.js';

const unitid = 'snmp'

const params = {

}

const system = {

}

const config = [
  {
    id: '3',
    unit: 'snmp1',
    host: '192.168.0.119',
    port: 161,
    trap_port: 162,
    community: 'public',
    transport: 'udp4',
    version: 0,
  },
  {
    id: '4',
    unit: 'snmp1',
    interval: 60,
    parentid: '3',
    number: false,
    dn: 'DIMM1',
    trap_oid: '1.0.0.0.0.0.0.0.100',
    table_oid: '1.3.6.1.2.1.2.2',
    parse: '',
    get_oid: '1.3.6.1.2.1.1.5.0',
    type: 'get',
    actions: [
      {
        act: "set",
        oid: "1.3.6.1.4.1.2.6.2.2.1.2.1",
        type: "OctetString",
      }
    ]
  },
];

const ps = child.fork(modulepath, [unitid]);

ps.on('message', data => {
  if (data.type === 'get' && data.tablename === `system/${unitid}`) {
    ps.send({ type: 'get', system });
  }

  if (data.type === 'get' && data.tablename === `params/${unitid}`) {
    ps.send({ type: 'get', params });
  }

  if (data.type === 'get' && data.tablename === `config/${unitid}`) {
    ps.send({ type: 'get', config });
  }

  if (data.type === 'data') {
    console.log('-------------data-------------', new Date().toLocaleString());
    console.log(data.data);
    console.log('');
  }

  if (data.type === 'channels') {
    console.log('-----------channels-----------', new Date().toLocaleString());
    console.log(data.data);
    console.log('');
  }

  if (data.type === 'debug') {
    console.log('-------------debug------------', new Date().toLocaleString());
    console.log(data.txt);
    console.log('');
  }
});

ps.on('close', code => {
  console.log('close');
});

ps.send({type: 'debug', mode: true });

setTimeout(() => {
  ps.send({ type: 'act', data: [ { dn: 'DIMM1', prop: 'set', val: 28 } ] })
}, 2000);
