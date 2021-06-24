const EventEmitter = require('events');

const dgram = require('dgram');
const ASN1 = require ('@lapo/asn1js');


function parseVaribleValue(data) {
  return data.content();
}

function parseVarible(data) {
  if (data.length == 2) {
    return { oid: data[0].content(), value: parseVaribleValue(data[1])}
  }
  return null;
}


function parseTrap(data) {
  const temp = [];
  if (data.sub !== null) {
    const item1 = data.sub[data.sub.length - 1]
    if (item1.sub !== null) {
      const item2 = item1.sub[item1.sub.length - 1]
      if (item2.sub !== null) {
        item2.sub.forEach(v => {
          if (v.sub !== null) {
            const varible = parseVarible(v.sub)
            temp.push(varible)
          }
        })
      }
    }
  }
  return temp;
}


class Trap extends EventEmitter {

  constructor(options) {
    super();
    // this.server = dgram.createSocket({ type:'udp4', reuseAddr: true });
    this.server = dgram.createSocket({ type:'udp4' });
    this.server.on('message', this.message.bind(this));
    this.server.bind(options.port || 162);
  }

  message(msg, info) {
    const data = parseTrap(ASN1.decode(msg));
    data.forEach(item => this.emit('data', { data: item , info }))
  }
}

module.exports = Trap;
