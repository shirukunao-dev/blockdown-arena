// ====================================================================
// BLOCKDOWN ARENA SERVER
// Express + WebSocket + Bot AI + Matchmaking + IAP + Play Store
// ====================================================================
const express=require('express');
const http=require('http');
const {WebSocketServer}=require('ws');
const path=require('path');
const {v4:uuidv4}=require('uuid');
const crypto=require('crypto');
const fs=require('fs');

// --- Tetris Engine ---
require(path.join(__dirname,'public','tetris-engine.js'));
const {TetrisEngine,BOARD_W,BOARD_H,VISIBLE_H,PIECE_NAMES,createRNG}=require(path.join(__dirname,'public','tetris-engine.js'));

// --- Simple DB (JSON file-based, no SQLite dependency issue) ---
const DB_PATH=path.join(__dirname,'data.json');
let DB={users:{},purchases:{},leaderboard:[],nextId:1};
if(fs.existsSync(DB_PATH)){
  try{DB=JSON.parse(fs.readFileSync(DB_PATH,'utf8'))}catch(e){}
}
function saveDB(){
  fs.writeFileSync(DB_PATH,JSON.stringify(DB,null,2));
}

// --- Constants ---
const PORT=process.env.PORT||3000;
const TICK_RATE=16; // ~60fps
const GRAVITY_FRAMES={
  easy:30,normal:20,hard:12,bot_easy:35,bot_normal:22,bot_hard:14
};
const SKILL_NAMES={0:'Unranked',500:'Bronze',1200:'Silver',2200:'Gold',3500:'Platinum',5000:'Diamond'};

// --- Account helpers ---
function hashPassword(pw){
  return crypto.createHash('sha256').update(pw+'vs-tetris-salt-2024').digest('hex');
}
function generateToken(){
  return crypto.randomBytes(32).toString('hex');
}

// --- Express setup ---
const app=express();
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

// Health endpoint for Render — prevents 30s spindown
app.get('/api/health',(req,res)=>{
  res.json({ok:true,uptime:process.uptime(),players:Object.keys(rooms).length>0,version:'1.0.0'});
});

app.post('/api/register',(req,res)=>{
  let{username,password}=req.body;
  if(!username||!password||username.length<3||password.length<3)
    return res.json({ok:false,error:'Username/password min 3 chars'});
  if(DB.users[username])return res.json({ok:false,error:'Username taken'});
  let token=generateToken();
  DB.users[username]={username,password:hashPassword(password),token,
    rating:1000,gems:0,subscription:null,wins:0,games:0,xp:0,level:1,
    cosmetics:{board:'default',trail:'none',music:'default'},
    purchases:[],created:Date.now()};
  saveDB();
  res.json({ok:true,token,user:DB.users[username]});
});

app.post('/api/login',(req,res)=>{
  let{username,password}=req.body;
  let user=DB.users[username];
  if(!user||user.password!==hashPassword(password))
    return res.json({ok:false,error:'Invalid credentials'});
  user.token=generateToken();
  saveDB();
  res.json({ok:true,token:user.token,user});
});

app.get('/api/leaderboard',(req,res)=>{
  let sorted=Object.values(DB.users).sort((a,b)=>b.rating-a.rating).slice(0,50)
    .map(u=>({username:u.username,rating:u.rating,wins:u.wins,games:u.games,level:u.level}));
  res.json({ok:true,leaderboard:sorted});
});

app.post('/api/purchase',(req,res)=>{
  let{token,itemId,receipt,platform}=req.body;
  let user=Object.values(DB.users).find(u=>u.token===token);
  if(!user)return res.json({ok:false,error:'Not logged in'});
  
  // Item defs — prices in USD (Google Play will handle actual charging)
  const ITEMS={
    'gems_small':{type:'gems',amount:100,cost:1.99},
    'gems_large':{type:'gems',amount:550,cost:9.99},
    'board_dark':{type:'cosmetic',item:'board',id:'dark',cost:200,gems:true},
    'board_neon':{type:'cosmetic',item:'board',id:'neon',cost:300,gems:true},
    'board_royal':{type:'cosmetic',item:'board',id:'royal',cost:500,gems:true},
    'trail_fire':{type:'cosmetic',item:'trail',id:'fire',cost:150,gems:true},
    'trail_ice':{type:'cosmetic',item:'trail',id:'ice',cost:150,gems:true},
    'trail_gold':{type:'cosmetic',item:'trail',id:'gold',cost:250,gems:true},
    'music_chill':{type:'cosmetic',item:'music',id:'chill',cost:300,gems:true},
    'music_boss':{type:'cosmetic',item:'music',id:'boss',cost:300,gems:true},
    'subscription_month':{type:'subscription',months:1,cost:4.99},
    'subscription_year':{type:'subscription',months:12,cost:39.99},
    'battle_pass':{type:'battle_pass',season:1,cost:7.99}
  };
  
  let item=ITEMS[itemId];
  if(!item)return res.json({ok:false,error:'Invalid item'});
  
  // Google Play receipt verification
  // In production: call https://androidpublisher.googleapis.com/androidpublisher/v3
  // For now: trust the receipt token from Play Billing client
  if(platform==='android'&&receipt){
    user.purchases.push({itemId,date:Date.now(),receipt,platform:'android'});
    // Verify purchaseToken with Google Play Developer API here in production
    // const {google} = require('googleapis');
    // const auth = new google.auth.JWT(serviceAccountEmail, null, privateKey, scopes);
    // const response = await google.androidpublisher('v3').purchases.products.get({...});
    // If verification fails: return res.json({ok:false,error:'Purchase verification failed'});
  }
  
  if(item.gems){
    if(user.gems<item.cost&&platform!=='android')return res.json({ok:false,error:'Not enough gems'});
    if(platform==='android'){
      // Play Store purchases add gems directly (Google handles the money)
      user.gems+=item.amount;
    }else{
      user.gems-=item.cost;
    }
    if(item.type==='cosmetic'){
      user.cosmetics[item.item]=item.id;
    }
  }else if(item.type==='gems'){
    user.gems+=item.amount;
    if(!user.purchases.some(p=>p.itemId===itemId&&p.date===Date.now())){
      user.purchases.push({itemId,date:Date.now(),receipt,platform:platform||'web'});
    }
  }else if(item.type==='subscription'){
    let exp=user.subscription?Math.max(user.subscription,Date.now()):Date.now();
    user.subscription=exp+item.months*30*24*60*60*1000;
    if(!user.purchases.some(p=>p.itemId===itemId&&p.date===Date.now())){
      user.purchases.push({itemId,date:Date.now(),receipt,platform:platform||'web'});
    }
  }else if(item.type==='battle_pass'){
    user.battlePass=true;
    if(!user.purchases.some(p=>p.itemId===itemId&&p.date===Date.now())){
      user.purchases.push({itemId,date:Date.now(),receipt,platform:platform||'web'});
    }
  }
  
  saveDB();
  res.json({ok:true,gems:user.gems,subscription:user.subscription,cosmetics:user.cosmetics});
});

// --- Bot AI ---
class BotPlayer{
  constructor(skill,engine,playerId){
    this.engine=engine;
    this.playerId=playerId||'bot_'+uuidv4().slice(0,8);
    this.skill=skill; // 'easy','normal','hard'
    this.name='Bot_'+['Rookie','Veteran','Pro'][['easy','normal','hard'].indexOf(skill)];
    this.inputQueue=[];
    this.thinkTimer=0;
    this.dead=false;
    this.garbageSent=0;
    this.score=0;
    this.lines=0;
  }

  think(){
    if(this.dead||!this.engine.current||this.engine.gameOver)return;
    
    let e=this.engine;
    let best=this.findBestPlacement();
    if(!best)return;
    
    let c=e.current;
    // Generate moves to reach target
    // 1. Rotate to target rotation
    let rotDiff=((best.rot-c.rot)%4+4)%4;
    for(let i=0;i<rotDiff;i++){
      this.inputQueue.push({type:'rotate_cw'});
    }
    
    // 2. Move horizontally
    let dx=best.px-c.px;
    for(let i=0;i<Math.abs(dx);i++){
      this.inputQueue.push({type:dx>0?'right':'left'});
    }
    
    // 3. Hard drop
    this.inputQueue.push({type:'hard_drop'});
    
    // Hard bot sometimes does hold
    if(this.skill==='hard'&&Math.random()<0.1&&e.canHold){
      this.inputQueue.unshift({type:'hold'});
    }
  }

  findBestPlacement(){
    let e=this.engine;
    let name=e.current.name;
    let best=null,bestScore=-999999;
    let rotations=name==='O'?1:(name==='I'?4:4);
    
    for(let rot=0;rot<rotations;rot++){
      let cells=e.getRotatedCells(name,rot);
      let startX=name==='O'?4:(name==='I'?3:3);
      
      for(let px=-2;px<=BOARD_W-2;px++){
        let py=0;
        while(e.isValid(px,py+1,cells))py++;
        if(!e.isValid(px,py,cells))continue;
        
        let board=e.board.map(r=>[...r]);
        for(let r=0;r<cells.length;r++){
          for(let c=0;c<cells[r].length;c++){
            if(cells[r][c]){
              let by=py+r,bx=px+c;
              if(by>=0&&by<BOARD_H&&bx>=0&&bx<BOARD_W)
                board[by][bx]=name;
            }
          }
        }
        
        let score=this.evaluatePlacement(board,px,py,cells,name);
        if(this.skill==='easy')score+=Math.random()*100;
        else if(this.skill==='normal')score+=Math.random()*20;
        
        if(score>bestScore){bestScore=score;best={px,py,rot}}
      }
    }
    return best;
  }

  evaluatePlacement(board,px,py,cells,name){
    let score=0;
    // Clear lines weight
    let cleared=0;
    for(let r=0;r<BOARD_H;r++){
      if(board[r].every(c=>c!==0))cleared++;
    }
    score+=cleared*500;
    
    if(this.skill==='hard'){
      // Hard bot: high weight on clears
      score+=cleared*300;
    }
    
    // Column heights
    let heights=[];
    for(let x=0;x<BOARD_W;x++){
      let h=0;
      for(let y=0;y<BOARD_H;y++){
        if(board[y][x]){h=BOARD_H-y;break}
      }
      heights.push(h);
    }
    
    // Bumpiness penalty
    let bump=0;
    for(let x=1;x<BOARD_W;x++){
      bump+=Math.abs(heights[x]-heights[x-1]);
    }
    score-=bump*(this.skill==='hard'?20:(this.skill==='normal'?30:50));
    
    // Max height penalty
    let maxH=Math.max(...heights);
    if(maxH>VISIBLE_H-2)score-=500;
    score-=maxH*(this.skill==='hard'?10:20);
    
    // Holes penalty
    let holes=0;
    for(let x=0;x<BOARD_W;x++){
      let blocked=false;
      for(let y=0;y<BOARD_H;y++){
        if(board[y][x])blocked=true;
        else if(blocked)holes++;
      }
    }
    score-=holes*(this.skill==='hard'?50:(this.skill==='normal'?80:150));
    
    // Column height difference from avg
    let avg=heights.reduce((a,b)=>a+b,0)/BOARD_W;
    for(let h of heights)score-=Math.abs(h-avg)*5;
    
    return score;
  }

  getInput(){
    if(this.dead)return null;
    this.thinkTimer--;
    if(this.thinkTimer<=0&&this.inputQueue.length===0){
      this.thinkTimer=this.skill==='easy'?8:(this.skill==='normal'?4:2);
      this.think();
    }
    if(this.inputQueue.length>0){
      return this.inputQueue.shift();
    }
    return null;
  }

  getState(){
    return {
      id:this.playerId,
      name:this.name,
      isBot:true,
      skill:this.skill,
      dead:this.dead,
      score:this.engine?this.engine.score:0,
      lines:this.engine?this.engine.lines:0,
      combo:this.engine?this.engine.combo:0,
      gameOver:this.engine?this.engine.gameOver:true
    };
  }
}

// --- Match/Room ---
class Room{
  constructor(id,type){
    this.id=id;
    this.type=type; // 'ranked','casual','vs_bot'
    this.players=[];
    this.engines={};
    this.bots=[];
    this.gameStarted=false;
    this.gameOver=false;
    this.tickInterval=null;
    this.garbageQueue={};
    this.killOrder=[];
    this.startTime=0;
  }

  addPlayer(socket,user,token){
    if(this.gameStarted)return false;
    this.players.push({socket,user,token,id:user?user.username:'guest_'+token.slice(0,6),
      spectator:false,dead:false,disconnected:false});
    return true;
  }

  addBot(skill){
    if(this.gameStarted)return false;
    let engine=new TetrisEngine({seed:Math.floor(Math.random()*99999999)});
    let bot=new BotPlayer(skill,engine);
    this.bots.push(bot);
    this.engines[bot.playerId]=engine;
    return bot;
  }

  startGame(){
    if(this.players.length+this.bots.length<1)return;
    
    // Create engines for all players
    let players=this.players;
    
    // Shared seed approach: each player gets their own engine
    // They all get the same piece sequence via shared RNG seed
    let baseSeed=Date.now()%99999999;
    
    // Assign engines
    for(let p of players){
      let seed=baseSeed+players.indexOf(p)*1000;
      let engine=new TetrisEngine({seed});
      p.id=engine.seed;
      this.engines[p.id]=engine;
    }
    
    // Start bots
    for(let bot of this.bots){
      let seed=baseSeed+this.bots.indexOf(bot)*1000+5000;
      bot.engine=new TetrisEngine({seed});
      this.engines[bot.playerId]=bot.engine;
    }
    
    this.gameStarted=true;
    this.gameOver=false;
    this.killOrder=[];
    this.startTime=Date.now();
    
    // Broadcast start to all players
    this.broadcast({
      type:'game_start',
      roomId:this.id,
      players:this.getAllPlayers().map(p=>({
        id:p.id||p.playerId,
        name:this.getPlayerName(p),
        isBot:!!p.isBot
      }))
    });
    
    // Start game loop
    this.tickInterval=setInterval(()=>this.tick(),TICK_RATE);
  }

  getPlayerName(p){
    if(p.isBot)return p.name;
    if(p.user)return p.user.username;
    return p.id||'Guest';
  }

  getAllPlayers(){
    return [...this.players.map(p=>({...p,isBot:false})),
      ...this.bots.map(b=>({socket:null,user:null,token:null,
        id:null,playerId:b.playerId,isBot:true,name:b.name,dead:b.dead}))];
  }

  broadcast(msg){
    for(let p of this.players){
      if(p.socket&&p.socket.readyState===1){
        try{p.socket.send(JSON.stringify(msg))}catch(e){}
      }
    }
  }

  tick(){
    // Tick all engines
    let players=this.getAllPlayers();
    let allDead=true;
    
    for(let p of players){
      let engine=this.engines[p.id||p.playerId];
      if(!engine)continue;
      
      // Bot input
      if(p.isBot){
        let bot=this.bots.find(b=>b.playerId===p.playerId);
        if(bot&&!bot.dead){
          let input=bot.getInput();
          while(input){
            this.processInput(bot,input,bot.playerId);
            input=bot.getInput();
          }
          bot.score=engine.score;
          bot.lines=engine.lines;
        }
      }
      
      if(!engine.gameOver)allDead=false;
      
      // Apply gravity
      let grav=GRAVITY_FRAMES.normal;
      if(p.isBot){
        let bot=this.bots.find(b=>b.playerId===p.playerId);
        grav=GRAVITY_FRAMES['bot_'+bot.skill]||20;
      }
      engine.tick(grav);
    }
    
    // Process garbage between players
    for(let p of players){
      let engine=this.engines[p.id||p.playerId];
      if(!engine)continue;
      let sent=engine.garbageSent-((p._lastSent)||0);
      p._lastSent=engine.garbageSent;
      if(sent>0){
        // Send garbage to opponents
        let opponents=players.filter(o=>o!==p&&!this.isDead(o));
        if(opponents.length>0){
          // Split garbage among alive opponents
          let perOpp=Math.floor(sent/opponents.length);
          for(let opp of opponents){
            let oppEngine=this.engines[opp.id||opp.playerId];
            if(oppEngine&&!oppEngine.gameOver){
              oppEngine.addGarbage(perOpp);
            }
          }
        }
      }
    }
    
    // Check game over for all
    for(let p of players){
      let engine=this.engines[p.id||p.playerId];
      if(engine&&engine.gameOver&&!this.isDead(p)){
        this.markDead(p);
      }
    }
    
    // Check win condition
    let alive=players.filter(p=>!this.isDead(p));
    if(alive.length<=1&&players.length>1&&!allDead){
      // Winner!
      if(alive.length===1){
        this.gameOver=true;
        let winner=alive[0];
        this.killOrder.unshift(winner.id||winner.playerId);
        clearInterval(this.tickInterval);
        this.broadcast({
          type:'game_over',
          killOrder:this.killOrder,
          winnerId:winner.id||winner.playerId,
          winnerName:this.getPlayerName(winner)
        });
        this.saveResults(players);
      }
    }
    
    // If all dead
    if(allDead&&players.length>1){
      this.gameOver=true;
      clearInterval(this.tickInterval);
      this.broadcast({type:'game_over',killOrder:this.killOrder,winnerId:null,winnerName:'Draw'});
    }
    
    // Send state update
    if(!this.gameOver){
      let states={};
      for(let p of players){
        let engine=this.engines[p.id||p.playerId];
        if(engine)states[p.id||p.playerId]=engine.getState();
      }
      this.broadcast({
        type:'game_tick',
        states,
        killOrder:this.killOrder,
        tick:Date.now()
      });
    }
  }

  isDead(p){
    if(p.isBot){
      let bot=this.bots.find(b=>b.playerId===p.playerId);
      return bot?bot.dead:p.dead;
    }
    return p.dead;
  }

  markDead(p){
    if(p.isBot){
      let bot=this.bots.find(b=>b.playerId===p.playerId);
      if(bot)bot.dead=true;
    }else{
      p.dead=true;
    }
    let id=p.id||p.playerId;
    if(!this.killOrder.includes(id))this.killOrder.push(id);
  }

  processInput(input,player,playerId){
    let engine=this.engines[playerId];
    if(!engine||engine.gameOver)return;
    switch(input.type){
      case 'left':engine.move(-1,0);break;
      case 'right':engine.move(1,0);break;
      case 'down':engine.move(0,1);break;
      case 'rotate_cw':engine.rotate(1);break;
      case 'rotate_ccw':engine.rotate(-1);break;
      case 'hard_drop':engine.hardDrop();break;
      case 'hold':engine.hold();break;
    }
  }

  handleInput(socket,msg){
    let player=this.players.find(p=>p.socket===socket);
    if(!player)return;
    let input=msg.input;
    this.processInput(input,player,player.id);
  }

  removePlayer(socket){
    let idx=this.players.findIndex(p=>p.socket===socket);
    if(idx>=0){
      let p=this.players[idx];
      p.dead=true;
      p.disconnected=true;
      this.broadcast({type:'player_left',playerId:p.id,playerName:this.getPlayerName(p)});
      // Check if room empty
      let hasPlayers=this.players.some(pp=>!pp.disconnected);
      if(!hasPlayers&&this.tickInterval){
        clearInterval(this.tickInterval);
        this.tickInterval=null;
      }
    }
  }

  saveResults(players){
    for(let p of players){
      if(!p.isBot&&p.user){
        let u=DB.users[p.user.username];
        if(u){
          u.games++;
          if(!p.dead){
            u.wins++;
            u.rating+=25;
            let exp=p.id||p.playerId;
            u.xp+=10;
            if(u.xp>=u.level*100){u.level++;u.xp=0}
          }else{
            u.rating=Math.max(0,u.rating-10);
          }
        }
      }
    }
    saveDB();
  }
}

// --- Room Manager ---
const rooms={};
const matchQueue=[]; // {socket,user,token,type}

function createRoom(type){
  let id=uuidv4().slice(0,8);
  let room=new Room(id,type);
  rooms[id]=room;
  return room;
}

function findOrCreateRoom(socket,user,token,type){
  // Find open room
  for(let id in rooms){
    let room=rooms[id];
    if(room.type===type&&!room.gameStarted&&room.players.length<4){
      room.addPlayer(socket,user,token);
      return room;
    }
  }
  // Create new
  let room=createRoom(type);
  room.addPlayer(socket,user,token);
  return room;
}

function addBotsToRoom(room,count,skill){
  for(let i=0;i<count;i++){
    room.addBot(skill);
  }
}

// --- WebSocket Server ---
const server=http.createServer(app);
const wss=new WebSocketServer({server});

function getUserByToken(token){
  return Object.values(DB.users).find(u=>u.token===token);
}

wss.on('connection',(socket,req)=>{
  let user=null,token=null;
  let currentRoom=null;
  let isAuthenticated=false;
  
  socket.on('message',(data)=>{
    try{
      let msg=JSON.parse(data.toString());
      handleMessage(socket,msg);
    }catch(e){
      socket.send(JSON.stringify({type:'error',message:'Invalid message'}));
    }
  });
  
  socket.on('close',()=>{
    if(currentRoom){
      currentRoom.removePlayer(socket);
      // Clean up empty rooms
      let hasAny=currentRoom.players.some(p=>!p.disconnected);
      if(!hasAny)delete rooms[currentRoom.id];
    }
  });
  
  function handleMessage(socket,msg){
    switch(msg.type){
      case 'auth':
        let u=getUserByToken(msg.token);
        if(u){
          user=u;
          token=msg.token;
          isAuthenticated=true;
          socket.send(JSON.stringify({type:'auth_ok',user:{
            username:u.username,rating:u.rating,gems:u.gems,
            subscription:u.subscription,cosmetics:u.cosmetics,
            wins:u.wins,games:u.games,level:u.level,xp:u.xp,
            battlePass:u.battlePass
          }}));
        }else{
          socket.send(JSON.stringify({type:'auth_error',message:'Invalid token'}));
        }
        break;
        
      case 'guest':
        isAuthenticated=true;
        token=uuidv4();
        socket.send(JSON.stringify({type:'auth_ok',user:{
          username:'Guest_'+token.slice(0,6),guest:true}}));
        break;
        
      case 'find_match':
        if(!isAuthenticated){
          socket.send(JSON.stringify({type:'error',message:'Not authenticated'}));
          return;
        }
        
        let type=msg.matchType||'casual';
        let room=findOrCreateRoom(socket,user,token,type);
        currentRoom=room;
        
        // Add bots if not enough players
        let humanCount=room.players.length;
        let botCount=Math.max(0,4-humanCount);
        if(type==='vs_bot'||(type==='casual'&&botCount>0)){
          for(let i=0;i<botCount;i++){
            let skills=['easy','normal','hard'];
            room.addBot(skills[i%3]);
          }
        }
        
        let allPlayers=room.getAllPlayers().map(p=>({
          id:p.id||p.playerId, name:p.isBot?p.name:room.getPlayerName(p), isBot:!!p.isBot
        }));
        
        socket.send(JSON.stringify({
          type:'room_joined',
          roomId:room.id,
          playerCount:room.players.length,
          botCount:room.bots.length,
          players:allPlayers
        }));
        
        // If enough players/bots, start
        if(room.players.length+room.bots.length>=2){
          setTimeout(()=>{
            if(!room.gameStarted)room.startGame();
          },2000);
          // Notify everyone
          room.broadcast({
            type:'match_ready',
            roomId:room.id,
            countdown:2,
            players:allPlayers
          });
        }
        break;
        
      case 'input':
        if(currentRoom){
          currentRoom.handleInput(socket,msg);
        }
        break;
        
      case 'replay':
        // Send final state for replay
        if(currentRoom&&currentRoom.gameOver){
          socket.send(JSON.stringify({
            type:'replay_data',
            killOrder:currentRoom.killOrder
          }));
        }
        break;
        
      case 'leaderboard':
        let sorted=Object.values(DB.users).sort((a,b)=>b.rating-a.rating).slice(0,50)
          .map(u=>({username:u.username,rating:u.rating,wins:u.wins,games:u.games,level:u.level}));
        socket.send(JSON.stringify({type:'leaderboard',entries:sorted}));
        break;
        
      case 'ping':
        socket.send(JSON.stringify({type:'pong',t:Date.now()}));
        break;
    }
  }
});

// --- Start ---
server.listen(PORT,()=>{
  console.log('=== BLOCKDOWN ARENA ===');
  console.log(`Server running on port ${PORT}`);
  console.log(`Android app connects to ws://YOUR_IP:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /api/register — create account');
  console.log('  POST /api/login — login');
  console.log('  POST /api/purchase — IAP + subscription');
  console.log('  GET  /api/leaderboard — rankings');
  console.log('  GET  /api/health — uptime check');
});
