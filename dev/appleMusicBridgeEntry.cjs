const { validateRequest, requestExpression } = require('../electron/appleMusic/companionRequests.cjs');

// Runs inside the Android Apple Music WebView. Java asks for the page expression, then evaluates it
// directly so Apple's CSP never sees an eval().
window.__foliaAppleMusicBuild = function (message) {
    const request = validateRequest(message);
    return request ? requestExpression(request) : null;
};
