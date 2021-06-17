const Plugin = require('./lib/plugin');
const Trap = require('./lib/trap');

const snmp = require ('net-snmp');
const Uint64LE = require("int64-buffer").Uint64LE;

const plugin = new Plugin();

const REVERSE_TRAP_ORIGIN = 1
const REVERSE_TRAP_EXTRA = 2

const STORE = {
  parents: [],
  childs: {},
  workers: {
    listener: {},
    polling: {},
  },
  links: {},
  actions: {},
};


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

function setAction(parent, child) {
  if (child.dn !== '' && child.actions) {
    child.actions.forEach(i => {
      if (!STORE.actions[child.dn]) {
          STORE.actions[child.dn] = {};
      }
      STORE.actions[child.dn][i.act] = { session: null, act: i, parent };
    })
  }
}

function setChild(item) {
  STORE.childs[item.parentid].push(item);
}

function setParent(item) {
  STORE.childs[item.id] = [];
  STORE.parents.push(item);
}

function setWorkerP({ host, port, version, community, transport, dn }, type, oid, interval) {
  if (!STORE.workers.polling[port]) {
    STORE.workers.polling[port] = {}
  }
  STORE
    .workers
    .polling[port][`${host}_${oid}_${interval}`] = { host, port, version, community, transport, type, oid, interval };
}

function setWorkerL({ host, trap_port}) {
  STORE
    .workers
    .listener[`${trap_port}`] = { host, port: trap_port};
}

function setLink(oid, dn, parser, host) {
  const id = `${host}_${oid}`
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
  if (type === REVERSE_TRAP_EXTRA && item.trap_oid  !== '') {
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
  STORE.parents
    .forEach(parent => {
      const childs = STORE.childs[parent.id];

      setWorkerL(parent);

      childs
        .forEach(child => {
          mappingLinks(parent, child);
          setAction(parent, child);
        });
    })

    Object
      .keys(STORE.links)
      .forEach(key => {
        STORE.links[key] = Object.keys(STORE.links[key]).map(k => STORE.links[key][k]);
      })
}

function initStore(data = []) {
  data
    .forEach(item => {
      if (item.parentid) {
        setChild(item);
      } else {
        setParent(item);
      }
    });
    createStruct();
}

function messageTrap({ data, info }) {
  plugin.debug(`TRAP ${data.oid}, value: ${data.value.toString()}`)

  if (STORE.links[`${info.address}_${data.oid}`]) {
    STORE.links[`${info.address}_${data.oid}`]
      .forEach(link => plugin.setDeviceValue(link.dn, link.parser(checkValue(data.type, data.value))))
  }
}

function messageGet(err, info, data) {
  if (err === null) {
    data.forEach(i => plugin.debug(`GET ${info.oid}, oid: ${i.oid}, value: ${i.value.toString()}`))
    data
      .forEach(item => {
        if (STORE.links[`${info.host}_${item.oid}`]) {
          STORE.links[`${info.host}_${item.oid}`]
            .forEach(link => plugin.setDeviceValue(link.dn, link.parser(checkValue(item.type, item.value))))
        }
      })
  } else {
    if (STORE.links[`${info.host}_${info.oid}`]) {
      STORE.links[`${info.host}_${info.oid}`]
        .forEach(link => plugin.setDeviceError(link.dn, err.message))
    }
  }
}

function messageTable(err, info, data) {
  if (err === null) {
    data.forEach(i => plugin.debug(`TABLE ${info.oid}, oid: ${i.oid}, value: ${i.value.toString()}`))
    data
      .forEach(item => {
        if (STORE.links[`${info.host}_${item.oid}`]) {
          STORE.links[`${info.host}_${item.oid}`]
            .forEach(link => plugin.setDeviceValue(link.dn, link.parser(checkValue(item.type, item.value))))
        }
      })
  } else {
    Object
      .keys(STORE.childs)
      .forEach(key =>
        STORE.childs[key]
          .forEach(i => {
            if (
              i.type === 'table' &&
              i.table_oid === info.oid
            ) {
              if (STORE.links[`${info.host}_${i.get_oid}`]) {
                STORE.links[`${info.host}_${i.get_oid}`]
                  .forEach(link => plugin.setDeviceError(link.dn, err.message))
              }
            }
          })
      )
  }
}

function taskPooling(item) {
  const session = snmp.createSession (item.host, item.community, {
    sourcePort: item.port,
    version: item.version,
    transport: item.transport,
  });

  session.on("error", e => {
    if (item.type === 'get') {
      messageGet(new Error(`Request timed or ${e.message}`), item, [])
    } else {
      messageTable(new Error(`Request timed or ${e.message}`), item, [])
    }
  })

  function req() {
    if (item.type === 'get') {
      session.get([item.oid], (err, data) => messageGet(err, item, data));
    }

    if (item.type === 'table') {
      session.subtree(item.oid, data => messageTable(null, item, data), err => messageTable(err, item, []));
    }
  }

  setInterval(req, item.interval * 1000);
  req();
}

function workerListener(item) {
  const trap = new Trap({ port: item.port });
  trap.on('data', messageTrap);
}

function workerPolling(port, pool) {
  Object
    .keys(pool)
    .forEach(key => taskPooling(pool[key]));
}

function startWorkers(data = []) {
  Object
    .keys(STORE.workers.listener)
    .forEach(key => workerListener(STORE.workers.listener[key]));

  Object
    .keys(STORE.workers.polling)
    .forEach(key => workerPolling(key, STORE.workers.polling[key]));
}

plugin.on('device_action', (device) => {
  plugin.debug(device);
  if (STORE.actions[device.dn] && STORE.actions[device.dn][device.prop]) {
    const item = STORE.actions[device.dn][device.prop];
    if (item.session === null) {
      STORE.actions[device.dn][device.prop].session = snmp.createSession (item.parent.host, item.parent.community, {
        sourcePort: item.parent.port,
        version: item.parent.version,
        transport: item.parent.transport,
      });
    }
    const varbinds = [{
      oid: item.act.oid,
      type: snmp.ObjectType[item.act.type],
      value: getValue(item.act.type, device.prop === 'set' ? device.val : item.act.value),
    }];
    plugin.debug(varbinds);
    STORE.actions[device.dn][device.prop].session.set(varbinds, (err, varbinds) => {
      if (err === null) {
        plugin.setDeviceValue(device.dn, device.prop === 'on' ? 1 : 0);
      }
    })
  }
});

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

plugin.on('start', () => {
  initStore(plugin.getChannels());
  startWorkers();
});
