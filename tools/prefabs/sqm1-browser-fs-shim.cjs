'use strict';

function unavailable() {
  throw new Error('Filesystem access is unavailable in the offline browser converter');
}

module.exports = new Proxy({}, {get: () => unavailable});
