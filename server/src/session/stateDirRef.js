const path = require('path');

function buildSessionStateDirRef(sessionId) {
    return path.join('.xensemble', 'state', sessionId);
}

module.exports = {
    buildSessionStateDirRef,
};
