var CardViewModel = function (json) {

    this.id = json.id;

    this.text = json.text;
    this.watermark = json.watermark;

    this.pick = json.pick;

    this.selected = ko.observable(false);
};

var MoveViewModel = function (id) {

    var self = this;

    this.id = id;

    this.cards = ko.observableArray();

    this.confirmed = ko.observable(false);

    this.select = function (card) {
        if (this.confirmed()) {
            return;
        }

        if (model.blackCard().pick == 1 && this.cards().length == 1 && card != this.cards()[0]) {
            this.cards.removeAll();
            this.select(card);

        } else if (this.cards().length > 0 && this.cards()[this.cards().length - 1] == card) {
            // can only remove the last selected card to keep the order
            this.cards.remove(card);
            console.log('Deselected ' + JSON.stringify(card));

        } else if (this.cards().length < model.blackCard().pick) {
            this.cards.push(card);
            console.log('Selected ' + JSON.stringify(card));
        }
    };

    this.submit = function () {
        self.confirmed(true);

        $.ajax('/ajax/game/' + model.game().id + '/move', {
            method: 'post', contentType: 'application/json',
            data: JSON.stringify(_.map(self.cards(), function (card) {
                return card.id;
            })),
            error: function () {
                self.confirmed(false);

                model.chat().receive({
                    time: Date.now(),
                    type: Chat.ERROR,
                    message: 'Something went wrong, please try again!'
                });
            }
        });

        console.log('Submitted move ' + JSON.stringify(self.cards()));
    };
};

var HandViewModel = function () {

    var self = this;

    this.cards = ko.observableArray();

    this.selected = ko.observableArray();

    this.set = function (cards) {
        this.cards.removeAll();
        _.each(cards, function (card) {
            self.cards.push(new CardViewModel(card));
        });
    };
};

var PlayerViewModel = function (json) {

    this.id = json.id;
    this.name = json.name;

    this.points = ko.observable(0);
    this.state = ko.observable();
};

var PlayViewModel = function (game, player) {

    var self = this;

    this.game = ko.observable(game);

    this.chat = ko.observable(new ChatViewModel());
    this.chat().user(player);
    this.chat().gameId(game.id);

    this.player = new PlayerViewModel(player);
    this.hand = new HandViewModel();
    this.move = ko.observable();

    this.players = ko.observableArray();
    _.each(game.players, function (player) {
        if (player.id == self.player.id) {
            self.players.push(self.player);
        } else {
            self.players.push(new PlayerViewModel(player));
        }
    });

    this.ended = ko.observable(false);
    this.winner = ko.observable();

    this.czar = ko.observable();

    this.round = ko.observable(1);

    this.blackCard = ko.observable();

    this.playedCards = ko.observableArray();
    this.playedCardsUncovered = ko.observable(false);

    this.selectedMove = ko.observable();
    this.selectedMoveSubmitted = ko.observable(false);

    this.timeLeft = ko.observable(0);
    this.timeLeftIntervalId = null;

    this.submitSelectedMove = function () {
        if (this.selectedMoveSubmitted() || !this.selectedMove()) {
            return;
        }
        this.selectedMoveSubmitted(true);

        $.ajax('/ajax/game/' + model.game().id + '/select', {
            method: 'post', contentType: 'application/json',
            data: JSON.stringify({move: this.selectedMove().id}),
            error: function () {
                self.selectedMoveSubmitted(false);

                self.chat().receive({
                    time: Date.now(),
                    type: Chat.ERROR,
                    message: 'Something went wrong, please try again!'
                });
            }
        });

        console.log('Submitted selected move ' + JSON.stringify(this.selectedMove()));
    };

    this.isHost = function () {
        return self.game().host.id == self.player.id;
    };

    this.isCzar = ko.computed(function () {
        return self.czar() && self.czar().id == self.player.id;
    });

    this.czarCanSelect = ko.computed(function () {
        return self.blackCard() != null && self.playedCardsUncovered();
    });

    this.kick = function (player) {
        if (confirm('Are you sure?')) {
            $.ajax('/ajax/game/' + self.game().id + '/kick/' + player.id, {method: 'post'});
        }
    };

    this.handleUpdate = function (update) {
        var player, move;

        var type = update.type;
        var data = update.data;

        switch (type) {
            case Game.Server.Update.PLAYER_JOIN:
                console.log('Player joined: ' + data.name + '/' + data.id);
                this.players.push(new PlayerViewModel(data));

                this.chat().receive({
                    time: Date.now(),
                    type: Chat.GAME_MESSAGE,
                    message: data.name + ' joined the game'
                });
                break;

            case Game.Server.Update.PLAYER_LEAVE:
                console.log('Player left: ' + data.id);
                player = _.find(self.players(), function (p) {
                    return p.id == data.id;
                });

                if (player == self.player) {
                    interruptListen();
                    // TODO make this prettier
                    alert('Kicked by host');
                    window.location.href = '/games';
                    return;
                }

                this.chat().receive({
                    time: Date.now(),
                    type: Chat.GAME_MESSAGE,
                    message: player.name + ' left the game (' + data.reason + ')'
                });

                // TODO this is kind of ugly
                if (player.state() == '' && !this.czarCanSelect() && this.playedCards().length > 0) {
                    this.playedCards.remove(this.playedCards()[0]);
                }

                this.players.remove(player);

                if (this.players().length < 3 && player.id != this.player.id) {
                    // TODO definitely improve this
                    alert('Game closing because there are less than 3 players. Sorry :(');
                }
                break;

            case Game.Server.Update.BLACK_CARD:
                console.log('Black card: ' + data.id + '/' + data.text);
                this.blackCard(new CardViewModel(data));
                this.playedCardsUncovered(false);

                this.updateTimeLimit();

                break;

            case Game.Server.Update.HAND:
                console.log('Hand: ' + JSON.stringify(data));
                this.hand.set(data.hand);

                var playedCards = [];
                _.each(data.played, function (json) {
                    var card = new CardViewModel(json);
                    self.hand.cards.push(card);

                    playedCards.push(card);
                });

                if (playedCards.length > 0) {
                    move = new MoveViewModel(-1);
                    _.each(playedCards, function (card) {
                        move.cards.push(card);
                    });

                    move.confirmed(true);
                    this.move(move);

                    this.player.state('');
                }

                break;

            case Game.Server.Update.MOVE:
                player = _.find(this.players(), function (p) {
                    return p.id == data.player;
                });
                console.log('Move made: ' + player.name);
                player.state('');

                if (player == this.player) {
                    this.playedCards.push(this.move());
                } else {
                    var pick = self.blackCard() != null ? self.blackCard().pick : 1; // can happen when joining in progress
                    move = new MoveViewModel(-1);
                    _.times(pick, function () {
                        move.cards.push(new CardViewModel({}));
                    });
                    this.playedCards.push(move);
                }


                break;

            case Game.Server.Update.UNCOVER:
                console.log('Uncovering cards: ' + JSON.stringify(data));

                this.playedCards.removeAll();
                _.each(data.cards, function (cards, id) {
                    var move = new MoveViewModel(id);

                    if (cards.length > 0) {
                        _.each(cards, function (card) {
                            move.cards.push(new CardViewModel(card));
                        });
                        self.playedCards.push(move);
                    }
                });
                this.playedCardsUncovered(true);

                _.each(this.players(), function (player) {
                    player.state('');
                });
                if (this.czar()) {
                    this.czar().state('Selecting');
                }

                this.timeLeft(data.timeLeft > 0 ? data.timeLeft : game.roundTimeLimit);
                this.updateTimeLimit();

                break;

            case Game.Server.Update.SELECTED:
                console.log('Czar selected ' + JSON.stringify(data));

                this.selectedMove(_.find(this.playedCards(), function (move) {
                    return move.id == data.move;
                }));
                if (this.czar()) {
                    this.czar().state('Card Czar');
                }

                player = _.find(this.players(), function (p) {
                    return p.id == data.player;
                });
                if (player) {
                    player.state('Round winner!');
                    player.points(player.points() + 1);
                }

                if (this.timeLeftIntervalId) {
                    clearInterval(this.timeLeftIntervalId);
                }

                break;

            case Game.Server.Update.ROUND:
                console.log('Starting round ' + data.round + ', czar: ' + data.czar);

                this.czar(_.find(self.players(), function (player) {
                    return player.id == data.czar;
                }));

                if (this.czar().state() == '' && !this.czarCanSelect()) {
                    this.playedCards.remove(this.playedCards()[0]);
                }

                _.each(this.players(), function (player) {
                    player.state('Playing');
                    player.points(data.points[player.id]);
                });
                if (this.czar()) {
                    this.czar().state('Card Czar');
                }

                this.move(new MoveViewModel(-1));

                this.round(data.round);

                this.playedCards.removeAll();
                this.playedCardsUncovered(false);

                this.selectedMove(null);
                this.selectedMoveSubmitted(false);

                this.timeLeft(data.timeLeft);

                this.chat().receive({
                    time: Date.now(),
                    type: Chat.GAME_MESSAGE,
                    message: 'Starting round ' + this.round()
                });

                break;

            case Game.Server.Update.STATE:
                console.log('Game state changed to ' + data.state);

                if (data.state == Game.State.ENDED) {
                    _.each(this.players(), function (p) {
                        if (p.points() >= self.game().scoreLimit) {
                            p.state('Winner!');
                            self.winner(p);
                        } else {
                            p.state('');
                        }
                    });

                    this.chat().receive({
                        time: Date.now(),
                        type: Chat.GAME_MESSAGE,
                        message: self.winner().name + ' won!'
                    });

                    this.ended(true);
                }

                break;

            case Game.Server.Update.CHAT:
                console.log('Chat message by ' + data.user.id + '/' + data.user.name + ': ' + data.type + ': ' + data.message);
                this.chat().receive(data);

                break;

            case Game.Server.Update.GAME_DATA:
                console.log('Game data updated: ' + JSON.stringify(data));

                this.game(data);

                break;

            default:
                console.log('Unknown update: ' + type + ': ' + JSON.stringify(data));
                break;
        }
    };

    this.setTimeLimit = function () {
        this.timeLeft(this.timeLeft() - 1);
        if (this.timeLeft() <= 0) {
            clearInterval(this.timeLeftIntervalId);
            this.timeLeftIntervalId = null;
        }
    }.bind(this);

    this.updateTimeLimit = function () {
        if (this.timeLeftIntervalId) {
            clearInterval(this.timeLeftIntervalId);
        }

        if (game.roundTimeLimit) {
            this.timeLeftIntervalId = setInterval(this.setTimeLimit, 1000);
        }
    };
};
