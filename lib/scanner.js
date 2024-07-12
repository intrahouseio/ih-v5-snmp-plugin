/**
 * Сессии сканирования (чтение таблиц)
 * Результат отправляется конкретному uuid
 *
 */

const util = require('util');
const snmp = require('net-snmp');

const utils = require('./utils');

class Scanner {
  constructor(plugin) {
    this.plugin = plugin;
    this.scanSession = {};
  }

  // Обработка запроса на сканирование
  request(scanObj) {
    this.plugin.log('Scan REQ')
    const errStr = utils.checkScanObj(scanObj);
    if (errStr) {
      this.plugin.send({ uuid:scanObj.uuid, type: 'scan', error: errStr }); // Отправить сообщение об ошибке
      return;
    }

    const scanid = utils.getScanId(scanObj);
    // if (!this.scanSession[scanid]) {
      this.scanSession[scanid] = { clients: new Set() };
      this.start(scanObj, scanid);
    // }

    // Всех подписчиков записать в список, чтобы им потом отправить результат
    this.scanSession[scanid].clients.add(scanObj.uuid);
  }

  // Запуск сессии сканирования
  start(item, scanid) {
    const self = this;
    this.plugin.log('Scan START item='+util.inspect(item))
    const community = item.community || 'public';
    const session = snmp.createSession(item.host, community, {
      retries: 0,
      timeout: 5000,
      sourcePort: item.port,
      transport: 'udp4',
      version: 0
    });

    session.on('error', err => {
      // this.sendScanError(scanid, e);
      this.plugin.log('session ERROR: '+util.inspect(err));
    });

    try {
      this.plugin.log(`<= SCAN TABLE request host ${item.host}, oid ${item.oid}`, 1);
      session.walk(
        item.oid,
        20,
        // data => this.plugin.log('DATA='+util.inspect(data)),
        // err => this.plugin.log('ERR='+util.inspect(err))
        //data => feedCb(data),
        //err => doneCb(err)
        data => this.sendScanResult(scanid, data),
        err => this.sendScanError(scanid, err)
        
      );
    } catch (e) {
      this.sendScanError(scanid, e);
    }
    function feedCb (varbinds) {
      for (var i = 0; i < varbinds.length; i++) {      
        self.plugin.log((varbinds[i]));
      }
    }
  
    function doneCb (error) {
      if (error) {
        self.plugin.log(error.toString ());
      }
    }
  }

  

  sendScanResult(scanid, data) {
    //this.plugin.log('Scan RESULT scanid='+scanid+' data='+util.inspect(data))
    if (!this.scanSession[scanid]) return;
    /*data.forEach(item => {
      item.topic = item.oid;
      item.title = this.checkValue(item.type, item.value);
    })*/
    //this.plugin.log('Scan RESULT scanid='+scanid+' data='+util.inspect(data))
    this.scanSession[scanid].clients.forEach(uuid => {
      this.plugin.send({ uuid, type: 'scan', op:'table', data: [] });
    });
    this.scanSession[scanid] = ''; // Сессия завершена? Отписки не ждем?
  }

  sendScanError(scanid, err) {
    this.plugin.log('sendScanError START')
    let errStr = typeof err == 'object' ? err.message : err;
    if (!errStr) errStr = 'Scan error!';
    this.plugin.log('Scan ' + scanid + ' error: ' + errStr);

    if (!this.scanSession[scanid]) return;
    this.scanSession[scanid].clients.forEach(uuid => {
      this.plugin.send({ uuid, type: 'scan', error: errStr });
    });
  }
  
  checkValue(type, value) {
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
    
    if (type == 4) {
      return value.toString();
    }
    
    return value;
  }
}

module.exports = Scanner;
