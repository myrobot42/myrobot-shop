// netlify/functions/videos-refresh-now.js
// MANUAL TRIGGER (HTTP). Same logic as the scheduled videos-refresh.js, but
// invokable on demand by visiting /.netlify/functions/videos-refresh-now
// Use it to seed/repopulate data/videos.json immediately (e.g. right after
// deploy, before the first scheduled run). Safe to delete after use.

const { handler } = require("./videos-refresh");
exports.handler = handler;
