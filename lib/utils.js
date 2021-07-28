/**
 * 
 */

 function checkScanObj(item) {
  let errstr = '';
  if (!item.host) errstr += 'No host! ';
  if (!item.port) errstr += 'No port! ';
  if (!item.oid) errstr += 'No table oid! ';
  return errstr;
 }

 function getScanId(item) {
  return `${item.host}_${item.port}_${item.oid}`;
 }


module.exports = {
  checkScanObj,
  getScanId
}