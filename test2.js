const dgram = require('node:dgram');
const server = dgram.createSocket('udp4');

server.on('error', (err) => {
  console.error(`server error:\n${err.stack}`);
  server.close();
});

server.on('message', (msg, rinfo) => {
  console.log(`incoming => ${rinfo.address}:${rinfo.port}`);

  const rid = msg.toString('hex').slice(34, 34 + 8);
  const data = Buffer.from(`3082003802010104067075626c6963a28200290204${rid}0201000201003082001930820015060c2b06010401838e460901090042810400000001`, 'hex');
  server.send(data, rinfo.port, rinfo.address);
});

server.on('listening', () => {
  const address = server.address();
  console.log(`server listening ${address.address}:${address.port}`);
});

server.bind(161, '0.0.0.0');

