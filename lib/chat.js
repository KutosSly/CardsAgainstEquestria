var log = require('logule').init(module);

var events = require('events');
var util = require('util');

var MessageType = require('./constants').Chat;

var _ = require('underscore');

function Message(user, type, message) {

    this.time = Date.now();

    this.user = user;
    this.type = type;
    this.message = message;

    this.toJSON = function () {
        return {
            time: this.time,
            user: this.user.toJson(),
            type: this.type,
            message: this.message
        };
    };
}

function Channel() {

    this.users = [];

    this.history = [];
    this.maxHistory = 5;

    this.addUser = function (user) {
        if (!_.contains(this.users, user)) {
            this.users.push(user);
            this.emit('join', user);
        }
    };

    this.removeUser = function (user) {
        var index = this.users.indexOf(user);
        if (index >= 0) {
            this.users.splice(index, 1);
            this.emit('leave', user);
        }
    };

    this.sendMessage = function (message) {
        if (message.user && !_.contains(this.users, message.user)) {
            return;
        }

        this.history.push(message);
        if (this.history.length > this.maxHistory) {
            this.history.splice(0, this.history.length - this.maxHistory);
        }

        this.emit('message', message);
    };

    events.EventEmitter.call(this);
}

util.inherits(Channel, events.EventEmitter);

var global = new Channel();

global.systemUser = {
    id: -1,
    name: '<system>',
    toJson: function () {
        return null;
    }
};
global.users.push(global.systemUser);

global.messages = [];
global.requests = [];

global.sendSystemMessage = function (text) {
    global.sendMessage(new Message(global.systemUser, MessageType.GAME_MESSAGE, text));
};

global.send = function () {
    _.each(global.requests, function (requests) {
        var userId = -1;
        _.each(requests, function (req) {
            var data = JSON.stringify(global.messages[req.userId]);
            req.response.send(data);

            log.trace('Sent messages to pending request of ' + req.userId);

            clearTimeout(req.timeoutId);

            userId = req.userId;
        });

        global.messages[userId] = [];
        global.requests[userId] = [];
    });
};

global.on('join', function (user) {
    global.sendSystemMessage(user.name + ' connected');

    global.messages[user.id] = [];
    global.requests[user.id] = [];
});

global.on('leave', function (user) {
    delete global.messages[user.id];
    delete global.requests[user.id];

    global.sendSystemMessage(user.name + ' disconnected');
});

global.on('message', function (message) {
    _.each(global.messages, function (queue, userId) {
        if (!message.user || userId != message.user.id) {
            queue.push(message);
        }
    });

    global.send();
});

module.exports = {
    Channel: Channel,
    Message: Message,
    global: global
};
