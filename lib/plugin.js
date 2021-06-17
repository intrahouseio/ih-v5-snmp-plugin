const EventEmitter = require('events');


class Plugin extends EventEmitter {

  constructor() {
    super();

    process.on('message', this.message.bind(this));
    this.unitid = process.argv[2];
    this.mode = 0;
    this.channels = [];
    this.system = {};
    this.params = {};
    this.start();
  }

  debug(data) {
    process.send({ type: 'debug', txt: data });
  }

  message(msg) {
    if (msg.type === 'get' && msg.hasOwnProperty('system')) {
      this.system = msg.system;
      this.updateMode();
    }
    if (msg.type === 'get' && msg.hasOwnProperty('params')) {
      this.params = msg.params;
      this.updateMode();
    }
    if (msg.type === 'get' && msg.hasOwnProperty('config')) {
      this.channels = msg.config;
      this.updateMode();
    }

    if (msg.type === 'act') {
      this.emit('device_action', msg.data[0]);
    }
    if (msg.type === 'command') {
      this.emit('toolbar_command', { type: msg.command, channelid: msg.id, done: () => this.toolbar_command_done(msg) });
    }
    if (msg.type === 'debug') {
      this.emit('debug', msg.mode);
    }
    if (msg.type === 'sub' && msg.hasOwnProperty('data')) {
      this.emit('info', msg.data);
    }
  }

  toolbar_command_done(data) {
    data.response = true;
    process.send(data);
  }

  updateMode() {
    this.mode++;
    if (this.mode === 3) {
      this.mode = 4;
      this.emit('start');
    }
  }

  logo() {
    this.debug('start');
    this.debug('version: 0.0.18');
  }

  getChannels() {
    return this.channels;
  }

  getSettings() {
    return Object.assign({}, this.params, this.system);
  }

  send(tablename) {
    process.send({ type: 'get', tablename: `${tablename}/${this.unitid}` });
  }

  info() {
    process.send({ type: 'sub', id: this.unitid, event: 'sendinfo', filter: { type: this.unitid } });
  }

  setChannels(data) {
    process.send({ type: 'channels', data });
  }

  setDeviceValue(dn, value, ext = {}) {
    process.send({ type: 'data', data: [{ dn, value, ext }] });
  }

  setDeviceError(id, message) {
    process.send({ type: 'data', data: [{ id, err: message }] });
  }

  start() {
    this.logo();
    this.info();
    this.send('system');
    this.send('params');
    this.send('config');
  }

}

module.exports = Plugin;
