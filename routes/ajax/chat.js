var log = require('logule').init(module);

var _ = require('underscore');

var Chat = require('../../lib/chat');
var Users = require('../../lib/users');

var post = function (req, res) {
    var user = req.session.user ? Users.get(req.session.user.id) : null;
    if (!user) {
        res.send(403);
        return;
    }

    // TODO clean up validation

    var type = parseInt(req.body.type);
    if (type < 0 || type > 1) {
        res.send(400);
        return;
    }

    var text = req.body.message;
    if (!text || text.length == 0 || text.length > 8192) {
        res.send(400);
        return;
    }

    var message = new Chat.Message(user, type, text);

    log.trace('Global chat message from ' + user.id + '/' + user.name + ': ' + JSON.stringify(message));

    Chat.global.sendMessage(message);

    res.send(200);
};

var listen = function (req, res) {
    var user = req.session.user ? Users.get(req.session.user.id) : null;
    if (!user) {
        res.send(403);
        return;
    }

    res.type('application/json');

    var max = Date.now() - 90000;
    _.each(Chat.global.requests[user.id], function (request) {
        if (request.created > max) {
            return;
        }

        clearTimeout(request.timeoutId);
        log.trace('Removed outdated listen request for ' + user.id + '/' + user.name);
    });

    Chat.global.requests[user.id].push({
        timeoutId: setTimeout(function () {
            res.send(JSON.stringify([]));

            log.trace('Chat listen request by ' + user.id + '/' + user.name + ' returned empty');
        }, 90000),
        created: Date.now(),
        userId: user.id,
        response: res
    });

    var messages = Chat.global.messages[user.id];
    if (messages && messages.length > 0) {
        log.trace('Sending buffered messages because of ' + user.id + '/' + user.name);
        Chat.global.send();
    } else {
        log.trace('Holding back messages response for ' + user.id + '/' + user.name);
    }
};

var history = function (req, res) {
    var user = req.session.user ? Users.get(req.session.user.id) : null;
    if (!user) {
        res.send(403);
        return;
    }

    var messages = [];
    _.each(Chat.global.history, function (message) {
        messages.push(message);
    });

    res.type('application/json');
    res.send(JSON.stringify(messages));
};

module.exports = function (app) {
    app.post('/ajax/chat/post', post);
    app.get('/ajax/chat/listen', listen);
    app.post('/ajax/chat/history', history);
};
