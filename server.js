var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var port = process.env.PORT || 8900;

// Track waiting players and active games
var waitingPlayers = [];
var activeGames = {};
var playerToGame = {}; // maps socket.id to game ID

// serve static files with no caching (development convenience)
app.use(express.static(__dirname + '/public', { maxAge: 0 }));

http.listen(port, function(){
  console.log('Battleship server listening on *:' + port);
});

io.on('connection', function(socket) {
  console.log('[' + new Date().toISOString() + '] Player connected: ' + socket.id);

  /**
   * Player joins the matchmaking queue
   */
  socket.on('joinQueue', function() {
    waitingPlayers.push(socket.id);
    socket.emit('waiting', { message: 'Waiting for opponent...' });
    console.log('[' + new Date().toISOString() + '] ' + socket.id + ' joined queue. Queue size: ' + waitingPlayers.length);
    
    // If we have 2 players, start a game
    if (waitingPlayers.length >= 2) {
      startGame(waitingPlayers.shift(), waitingPlayers.shift());
    }
  });

  /**
   * Handle ship placement from client
   */
  socket.on('placedShips', function(data) {
    var gameId = playerToGame[socket.id];
    if (!gameId || !activeGames[gameId]) return;
    
    var game = activeGames[gameId];
    var playerIndex = (game.player1 === socket.id) ? 0 : 1;
    game.shipsPlaced[playerIndex] = data;
    
    console.log('[' + new Date().toISOString() + '] Player ' + playerIndex + ' placed ships in game ' + gameId);
    
    // If both players have placed ships, start the game
    if (game.shipsPlaced[0] && game.shipsPlaced[1]) {
      io.to(game.gameRoom).emit('startGame', { player1Starts: true });
      game.gameStarted = true;
      game.currentPlayer = 0;
    }
  });

  /**
   * Handle shot from client
   */
  socket.on('shot', function(data) {
    var gameId = playerToGame[socket.id];
    if (!gameId || !activeGames[gameId]) return;
    
    var game = activeGames[gameId];
    var shooterIndex = (game.player1 === socket.id) ? 0 : 1;
    var opponentIndex = 1 - shooterIndex;
    var opponentId = shooterIndex === 0 ? game.player2 : game.player1;
    
    // Send shot to opponent
    io.to(opponentId).emit('opponentShot', {
      row: data.row,
      col: data.col
    });
    
    console.log('[' + new Date().toISOString() + '] Player ' + shooterIndex + ' shot (' + data.row + ',' + data.col + ') in game ' + gameId);
  });

  /**
   * Handle shot result from opponent
   */
  socket.on('shotResult', function(data) {
    var gameId = playerToGame[socket.id];
    if (!gameId || !activeGames[gameId]) return;
    
    var game = activeGames[gameId];
    var defenderIndex = (game.player1 === socket.id) ? 0 : 1;
    var attackerIndex = 1 - defenderIndex;
    var attackerId = defenderIndex === 0 ? game.player2 : game.player1;
    
    // Switch turn and send result to attacker
    game.currentPlayer = attackerIndex;
    io.to(attackerId).emit('shotResult', {
      hit: data.hit,
      sunk: data.sunk,
      gameOver: data.gameOver,
      winner: data.winner
    });
    
    if (data.gameOver) {
      endGame(gameId);
    }
  });

  /**
   * Handle player disconnect
   */
  socket.on('disconnect', function() {
    console.log('[' + new Date().toISOString() + '] Player disconnected: ' + socket.id);
    
    // Remove from waiting queue
    var waitIndex = waitingPlayers.indexOf(socket.id);
    if (waitIndex > -1) {
      waitingPlayers.splice(waitIndex, 1);
    }
    
    // Notify opponent if in game
    var gameId = playerToGame[socket.id];
    if (gameId && activeGames[gameId]) {
      var game = activeGames[gameId];
      var opponentId = game.player1 === socket.id ? game.player2 : game.player1;
      io.to(opponentId).emit('opponentDisconnected', { message: 'Opponent left the game' });
      endGame(gameId);
    }
    
    delete playerToGame[socket.id];
  });
});

/**
 * Start a new game with two players
 */
function startGame(player1Id, player2Id) {
  var gameId = 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  var gameRoom = 'game_' + gameId;
  
  activeGames[gameId] = {
    gameId: gameId,
    player1: player1Id,
    player2: player2Id,
    gameRoom: gameRoom,
    shipsPlaced: [null, null],
    gameStarted: false,
    currentPlayer: null
  };
  
  playerToGame[player1Id] = gameId;
  playerToGame[player2Id] = gameId;
  
  // in Socket.IO v4, sockets are stored in a Map
  var socket1 = io.sockets.sockets.get(player1Id);
  var socket2 = io.sockets.sockets.get(player2Id);
  
  if (socket1) socket1.join(gameRoom);
  if (socket2) socket2.join(gameRoom);
  
  // notify each player that opponent joined
  io.to(player1Id).emit('opponentJoined', { playerIndex: 0, gameId: gameId });
  io.to(player2Id).emit('opponentJoined', { playerIndex: 1, gameId: gameId });
  
  console.log('[' + new Date().toISOString() + '] Game started: ' + gameId + ' (' + player1Id + ' vs ' + player2Id + ')');
}

/**
 * End a game
 */
function endGame(gameId) {
  if (activeGames[gameId]) {
    var game = activeGames[gameId];
    delete playerToGame[game.player1];
    delete playerToGame[game.player2];
    delete activeGames[gameId];
    console.log('[' + new Date().toISOString() + '] Game ended: ' + gameId);
  }
}
