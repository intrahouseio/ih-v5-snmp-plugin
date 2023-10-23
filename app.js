/**
 * app.js
 * snmp
 * smart:1 - присылает dn (chan)
 */
const util = require('util');
const snmp = require('net-snmp');

const Trap = require('./lib/trap');
const Scanner = require('./lib/scanner');

const Uint64LE = require('int64-buffer').Uint64LE;

const REVERSE_TRAP_ORIGIN = 1;
const REVERSE_TRAP_EXTRA = 2;

const STORE = {
  parents: [],
  childs: {},
  workers: {
    listener: {},
    polling: {}
  },
  links: {},
  actions: {}
};
let queue = [];
let semaphor; 

const sleep = ms => new Promise(resolve => (nextTimer1 = setTimeout(resolve, ms)));

module.exports = async function (plugin) {
  const scanner = new Scanner(plugin);

  initStore(plugin.channels);
  startWorkers();

  plugin.onAct(message => {
    plugin.log('ACT data=' + util.inspect(message.data), 1);
    if (!message.data) return;
    message.data.forEach(item => deviceAction(item));
  });

  plugin.onScan(params => {
    scanner.request(params);
  });

  function createFunction(string) {
    if (string !== '') {
      try {
        return new Function('value', `return ${string}`);
      } catch (e) {
        return new Function('value', `return String(value)`);
      }
    }
    return new Function('value', `return String(value)`);
  }

  function getValue(type, value) {
    switch (type) {
      case 'Integer':
        return Number(value);
      case 'Boolean':
        return Boolean(value);
      case 'OctetString':
        return String(value);
      default:
        return value;
    }
  }

  /*
  function setAction(parent, child) {
    if (child.dn !== '' && child.actions) {
      child.actions.forEach(i => {
        if (!STORE.actions[child.dn]) {
          STORE.actions[child.dn] = {};
        }
        STORE.actions[child.dn][i.act] = { session: null, act: i, parent };
      });
    }
  }
  */

  function setAction(parent, child) {
    if (child.w) {
      if (!STORE.actions[child.dn]) {
        STORE.actions[child.dn] = {};
      }
      STORE.actions[child.dn] = { session: null, parent };
    }
  }

  function setChild(item) {
    if (!STORE.childs[item.parentid]) STORE.childs[item.parentid] = [];
    STORE.childs[item.parentid].push(item);
  }

  function setParent(item) {
    STORE.childs[item.id] = [];
    STORE.parents.push(item);
  }

  function setWorkerP({ host, port, version, community, transport, dn }, type, oid, interval) {
    if (!interval) {
      plugin.log('Empty polling interval! oid = ' + oid + ' skipped!\n', 1);
      return;
    }

    if (!STORE.workers.polling[host+'_'+port]) {
      STORE.workers.polling[host+'_'+port] = {};
    }

    plugin.log(`START polling ${host} oid:${oid} interval: ${interval} \n`, 1);
    if (type == 'get') {
      if (STORE.workers.polling[host+'_'+port][`${host}_${interval}`] == undefined) {
        STORE.workers.polling[host+'_'+port][`${host}_${interval}`] = {
          host,
          port,
          version,
          community,
          transport,
          type,
          oid: [oid],
          interval
        };
      } else {
        STORE.workers.polling[host+'_'+port][`${host}_${interval}`].oid.push(oid)
      }
    }
    if (type == 'table') {
      STORE.workers.polling[host+'_'+port][`${host}_${oid}_${interval}`] = {
        host,
        port,
        version,
        community,
        transport,
        type,
        oid,
        interval
      };
    }


  }

  function setWorkerL({ host, trap_port, usetrap }) {
    if (usetrap) {
      STORE.workers.listener[`${trap_port}`] = { host, port: trap_port };
    }
  }

  function setLink(oid, dn, parser, host) {
    const id = `${host}_${oid}`;
    if (!STORE.links[id]) {
      STORE.links[id] = {};
    }
    STORE.links[id][dn] = { dn, parser: createFunction(parser) };
  }

  function mappingGet(parent, child) {
    setWorkerP(parent, 'get', child.get_oid, child.interval);
    setLink(child.get_oid, child.dn, child.parse, parent.host);
  }

  function mappingTable(parent, child) {
    setWorkerP(parent, 'table', child.table_oid, child.interval);
    setLink(child.get_oid, child.dn, child.parse, parent.host);
  }

  function mappingTrap(type, item, host) {
    if (type === REVERSE_TRAP_EXTRA && item.trap_oid !== '') {
      setLink(item.trap_oid, item.dn, item.parse, host);
    }

    if (type === REVERSE_TRAP_ORIGIN && item.get_oid !== '') {
      setLink(item.get_oid, item.dn, item.parse, host);
    }
  }

  function mappingLinks(parent, child) {
    switch (child.type) {
      case 'trap':
        mappingTrap(REVERSE_TRAP_ORIGIN, child, parent.host);
        break;
      case 'get':
        mappingGet(parent, child);
        mappingTrap(REVERSE_TRAP_EXTRA, child, parent.host);
        break;
      case 'table':
        mappingTable(parent, child);
        mappingTrap(REVERSE_TRAP_EXTRA, child, parent.host);
        break;
      default:
        break;
    }
  }

  function createStruct() {
    STORE.parents.forEach(parent => {
      const childs = STORE.childs[parent.id];

      setWorkerL(parent);

      childs.forEach(child => {
        mappingLinks(parent, child);
        setAction(parent, child);
      });
    });

    Object.keys(STORE.links).forEach(key => {
      STORE.links[key] = Object.keys(STORE.links[key]).map(k => STORE.links[key][k]);
    });
    plugin.log('createStruct STORE.actions=' + util.inspect(STORE.actions, null, 4), 1);
  }

  function initStore(data = []) {
    data.forEach(item => {

      if (item.parentid) {
        setChild(item);
      } else {
        item.port = Number(item.port);
        item.version = Number(item.version);
        setParent(item);
      }
    });
    createStruct();
  }

  function messageTrap({ data, info }) {
    plugin.log(`<= TRAP ${data.oid}, value: ${data.value.toString()}`, 1);
    const res = [];
    if (STORE.links[`${info.address}_${data.oid}`]) {
      STORE.links[`${info.address}_${data.oid}`].forEach(link =>
        // plugin.setDeviceValue({dn:link.dn, value:link.parser(checkValue(data.type, data.value))})
        res.push({ dn: link.dn, value: link.parser(checkValue(data.type, data.value)) })
      );
    }
    if (res.length) plugin.sendData(res);
  }

  function messageGet(err, info, data) {
    const res = [];
    if (err == null) {
      data.forEach(i =>
        plugin.log(`=> GET response host: ${info.host}, oid: ${i.oid}, value: ${i.value.toString()}`, 1)
      );

      data.forEach(item => {
        if (STORE.links[`${info.host}_${item.oid}`]) {
          STORE.links[`${info.host}_${item.oid}`].forEach(link =>
            res.push({ dn: link.dn, value: checkValue(item.type, item.value), chstatus: 0 })
          );
        }
      });
    } else if (STORE.links[`${info.host}_${info.oid}`]) {
      plugin.log(`=> GET error host:${info.host}, oid: ${info.oid} err: ${err.message}`, 1);
      STORE.links[`${info.host}_${info.oid}`].forEach(link => {
        res.push({ dn: link.dn, err: err.message, chstatus: 1 });
      });
    }
    if (res.length) plugin.sendData(res);
  }

  function messageTable(err, info, data) {
    const res = [];
    if (err === null) {
      data.forEach(i =>
        plugin.log(`=> TABLE response host: ${info.host}, oid: ${i.oid}, value: ${i.value.toString()}`, 1)
      );
      data.forEach(item => {
        if (STORE.links[`${info.host}_${item.oid}`]) {
          STORE.links[`${info.host}_${item.oid}`].forEach(link =>
            res.push({ dn: link.dn, value: checkValue(item.type, item.value), chstatus: 0 })
          );
        }
      });
    } else {
      Object.keys(STORE.childs).forEach(key =>
        STORE.childs[key].forEach(i => {
          if (i.type === 'table' && i.table_oid === info.oid) {
            if (STORE.links[`${info.host}_${i.get_oid}`]) {
              STORE.links[`${info.host}_${i.get_oid}`].forEach(link => res.push({ dn: link.dn, err: err.message, chstatus: 1 }));
            }
          }
        })
      );
    }
    if (res.length) plugin.sendData(res);
  }

  async function taskPooling(item, index) {
    let oidarr = item.oid.slice(0);


    const session = snmp.createSession(item.host, item.community, {
      retries: 0,
      timeout: 5000,
      sourcePort: item.port,
      version: item.version,
      transport: item.transport
    });


    session.on('error', e => {
      if (item.type === 'get') {
        messageGet(new Error(`Request timed or ${e.message}`), item, []);
      } else {
        messageTable(new Error(`Request timed or ${e.message}`), item, []);
      }
    });

    await sleep(index* 100);

    async function req(arr) {
      return new Promise((resolve, reject) => {
        if (item.type === 'get') {
          plugin.log(`<= GET request host ${item.host}, oid ${arr}`, 1);
          session.get(arr, (err, data) => {

            if (err) {
              plugin.log("err " + util.inspect(err), 1)
              resolve(err)
            } else {
              messageGet(err, item, data);
              resolve(data);
            }
          });
        }

        if (item.type === 'table') {
          plugin.log(`<= TABLE request host ${item.host}, oid ${item.oid}`, 1);
          session.subtree(
            item.oid,
            data => {
              messageTable(null, item, data)
              resolve(data);
            },
            err => {
              messageTable(err, item, []);
              resolve(err);
            }
          );
        }
      })

    }
    async function sendNext() {
      if (!semaphor) {
        semaphor = true;
        if (item.type == 'get') {
          while (oidarr.length > 0) {
            await sleep(10)
            const res = await req(oidarr.splice(0, 10));
          }
          oidarr = item.oid.slice(0);
        }
        if (item.type == 'table') await req();
        semaphor = false;
      }      
      setTimeout(sendNext, item.interval * 1000);

    }
    sendNext();
  }

  function workerListener(item) {
    try {
      const trap = new Trap({ port: item.port });
      trap.on('data', messageTrap);

      trap.server.on('error', err => {
        let errStr = 'Ошибка трапа: ';
        if (err.code == 'EADDRINUSE' && err.syscall == 'bind') {
          errStr += 'порт ' + err.port + ' занят другим процессом!';
        } else {
          errStr += util.inspect(err);
        }
        plugin.exit(1, errStr);
      });
    } catch (e) {
      plugin.exit(1, 'Connection error: ' + util.inspect(e));
    }
  }

  function workerPolling(pool) {
    //plugin.log("pool " + util.inspect(pool))
    Object.keys(pool).forEach((key, index) => taskPooling(pool[key], index));
  }

  function startWorkers() {
    Object.keys(STORE.workers.listener).forEach(key => workerListener(STORE.workers.listener[key]));
    Object.keys(STORE.workers.polling).forEach(key => workerPolling(STORE.workers.polling[key]));
    //plugin.log("Store " + util.inspect(STORE.workers.polling))
  }

  /*
  function deviceAction(device) {
    plugin.log(device);
    if (STORE.actions[device.dn] && STORE.actions[device.dn][device.prop]) {
      const item = STORE.actions[device.dn][device.prop];
      if (item.session === null) {
        STORE.actions[device.dn][device.prop].session = snmp.createSession(item.parent.host, item.parent.community, {
          sourcePort: item.parent.port,
          version: item.parent.version,
          transport: item.parent.transport
        });
      }
      const varbinds = [
        {
          oid: item.act.oid,
          type: snmp.ObjectType[item.act.type],
          value: getValue(item.act.type, device.prop === 'set' ? device.val : item.act.value)
        }
      ];
      plugin.log(varbinds);
      STORE.actions[device.dn][device.prop].session.set(varbinds, err => {
        if (err === null) {
          // plugin.setDeviceValue(device.dn, device.prop === 'on' ? 1 : 0);
          plugin.sendData([{ dn: device.dn, value: device.prop === 'on' ? 1 : 0 }]);
        }
      });
    }
  }
  */

  function deviceAction(actObj) {
    // plugin.log('DO DEVICE ACTION '+util.inspect(actObj));
    if (STORE.actions[actObj.dn]) {
      const item = STORE.actions[actObj.dn];
      if (item.session === null) {
        STORE.actions[actObj.dn].session = snmp.createSession(item.parent.host, item.parent.community, {
          sourcePort: item.parent.port,
          version: item.parent.version,
          transport: item.parent.transport
        });
      }
      const varbinds = [
        {
          oid: actObj.diffw ? actObj.set_oid : actObj.get_oid,
          type: snmp.ObjectType[actObj.set_type],
          value: getValue(actObj.set_type, actObj.val)
        }
      ];

      //plugin.log(varbinds, 1);
      STORE.actions[actObj.dn].session.set(varbinds, err => {
        if (err === null) {
          // plugin.setDeviceValue(device.dn, device.prop === 'on' ? 1 : 0);
          plugin.sendData([{ dn: actObj.dn, value: actObj.value }]);
        }
      });
    }
  }

  function checkValue(type, value) {
    if (type === 70) {
      const temp = [0, 0, 0, 0, 0, 0, 0, 0];
      const temp2 = Uint8Array.from(value).reverse();
      temp2.forEach((i, k) => {
        temp[k] = i;
      });
      return new Uint64LE(new Buffer(temp)).toNumber();
    }

    if (type === 68) {
      const temp2 = Uint8Array.from(value).reverse();
      const b = new Buffer(temp2);
      return b.readFloatLE();
    }
    return value;
  }

  /*
  // Перенесено в модуль scanner
  function scanning(item) {
    let errstr = '';
    if (!item.host) errstr += 'No host! ';
    if (!item.port) errstr += 'No port! ';
    if (!item.oid) errstr += 'No table oid! ';
    if (errstr) {
      scanError(errstr);
      return;
    }

    const scanSession = snmp.createSession(item.host, item.community, {
      retries: 0,
      timeout: 5000,
      sourcePort: item.port,
      version: item.version,
      transport: item.transport
    });

    scanSession.on('error', e => {
      scanError(e);
    });

    try {
      plugin.log(`<= SCAN TABLE request host ${item.host}, oid ${item.oid}`, 1);
      scanSession.subtree(
        item.oid,
        data => scanResult(data),
        err => scanError(err, item)
      );
    } catch (e) {
      scanError(util.inspect(e), item);
    }

    function scanError(err) {
      plugin.log('Scan error: '+err);
      plugin.send({ ...item, type: 'scan', err });
    }

    function scanResult(data) {
      plugin.send({ ...item, type: 'scan', data });
    }
  }
  */
};
