// ====================================================================
// Tetris Engine — SRS, Wall Kicks, T-Spin, Garbage, VS Scoring
// Works in Node.js (module.exports) and Browser (window.TetrisEngine)
// ====================================================================
(function(){
  const BOARD_W = 10, BOARD_H = 22, VISIBLE_H = 20;

  const PIECE_SHAPES = {
    I: {color:'#00f0f0',cells:[[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
      [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
      [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
      [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]]]},
    O: {color:'#f0f000',cells:[[[1,1],[1,1]],[[1,1],[1,1]],[[1,1],[1,1]],[[1,1],[1,1]]]},
    T: {color:'#a000f0',cells:[[[0,1,0],[1,1,1],[0,0,0]],
      [[0,1,0],[0,1,1],[0,1,0]],
      [[0,0,0],[1,1,1],[0,1,0]],
      [[0,1,0],[1,1,0],[0,1,0]]]},
    S: {color:'#00f000',cells:[[[0,1,1],[1,1,0],[0,0,0]],
      [[0,1,0],[0,1,1],[0,0,1]],
      [[0,0,0],[0,1,1],[1,1,0]],
      [[1,0,0],[1,1,0],[0,1,0]]]},
    Z: {color:'#f00000',cells:[[[1,1,0],[0,1,1],[0,0,0]],
      [[0,0,1],[0,1,1],[0,1,0]],
      [[0,0,0],[1,1,0],[0,1,1]],
      [[0,1,0],[1,1,0],[1,0,0]]]},
    J: {color:'#0000f0',cells:[[[1,0,0],[1,1,1],[0,0,0]],
      [[0,1,1],[0,1,0],[0,1,0]],
      [[0,0,0],[1,1,1],[0,0,1]],
      [[0,1,0],[0,1,0],[1,1,0]]]},
    L: {color:'#f0a000',cells:[[[0,0,1],[1,1,1],[0,0,0]],
      [[0,1,0],[0,1,0],[0,1,1]],
      [[0,0,0],[1,1,1],[1,0,0]],
      [[1,1,0],[0,1,0],[0,1,0]]]}
  };

  const PIECE_NAMES = ['I','O','T','S','Z','J','L'];

  // SRS Wall Kicks: [dx, dy] where +dy = DOWN (negated from standard SRS)
  // For JLSTZ
  const KICK_JLSTZ = {
    '0>R':[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    'R>2':[[0,0],[1,0],[1,-1],[0,2],[1,2]],
    '2>L':[[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    'L>0':[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    'R>0':[[0,0],[1,0],[1,-1],[0,2],[1,2]],
    '2>R':[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    'L>2':[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '0>L':[[0,0],[1,0],[1,1],[0,-2],[1,-2]]
  };
  const KICK_I = {
    '0>R':[[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    'R>2':[[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
    '2>L':[[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    'L>0':[[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
    'R>0':[[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    '2>R':[[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
    'L>2':[[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    '0>L':[[0,0],[-1,0],[2,0],[-1,2],[2,-1]]
  };

  // --- 7-Bag Randomizer ---
  function createBag(rng){
    let bag=[];
    function fill(){bag=[...PIECE_NAMES];for(let i=bag.length-1;i>0;i--){let j=Math.floor(rng()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]]}}
    return {
      next(){
        if(bag.length===0)fill();
        return bag.pop();
      },
      reset(){bag=[]}
    };
  }

  // --- Seeded RNG ---
  function createRNG(seed){
    let s=seed||Date.now();
    return function(){
      s=(s*1664525+1013904223)&0xffffffff;
      return (s>>>0)/4294967296;
    };
  }

  // --- Engine ---
  class TetrisEngine{
    constructor(opts){
      opts=opts||{};
      this.seed=opts.seed||Date.now();
      this.rng=createRNG(this.seed);
      this.bag=createBag(this.rng);
      this.board=Array.from({length:BOARD_H},()=>Array(BOARD_W).fill(0));
      this.score=0;
      this.lines=0;
      this.combo=-1;
      this.backToBack=false;
      this.garbageQueue=[];
      this.gameOver=false;
      this.paused=false;
      this.canHold=true;
      this.holdPiece=null;
      this.current=null;
      this.nextPieces=[];
      this.frames=0;
      this.gravityTimer=0;
      this.lockTimer=0;
      this.lockResets=0;
      this.lockMoves=0;
      this.hasDropped=false;
      this.lastAction='';
      this.lastActionPos=null;
      this.tSpin=false;
      this.clearCount=0;
      this.garbageSent=0;
      this.garbageReceived=0;
      this.maxCombo=0;
      this.placementX=0;
      this.placementY=0;
      this.placementRot=0;
      this.apex=false;
      
      // Fill next queue
      for(let i=0;i<4;i++)this.nextPieces.push(this.bag.next());
      
      this.spawnPiece();
    }

    spawnPiece(){
      if(this.nextPieces.length<4)this.nextPieces.push(this.bag.next());
      let name=this.nextPieces.shift();
      this.nextPieces.push(this.bag.next());
      let shape=PIECE_SHAPES[name];
      let cells=shape.cells[0];
      let px=Math.floor((BOARD_W-cells[0].length)/2);
      let py=cells[0][1]?0:-1;
      // Check if I piece at top
      if(name==='I')py=0;
      if(name==='O')py=0;
      this.current={name,cells,rot:0,px,py};
      this.canHold=true;
      this.hasDropped=false;
      this.lockTimer=0;
      this.lockResets=0;
      this.lockMoves=0;
      this.tSpin=false;
      this.lastAction='spawn';
      this.lastActionPos={x:px,y:py};
      this.placementX=px;
      this.placementY=py;
      this.placementRot=0;
      
      if(!this.isValid(px,py,cells)){
        this.gameOver=true;
        this.current=null;
      }
    }

    getBoardCell(row,col){
      if(row<0||row>=BOARD_H||col<0||col>=BOARD_W)return 1;
      return this.board[row][col];
    }

    isValid(px,py,cells){
      for(let r=0;r<cells.length;r++){
        for(let c=0;c<cells[r].length;c++){
          if(cells[r][c]){
            let bx=px+c,by=py+r;
            if(bx<0||bx>=BOARD_W||by>=BOARD_H)return false;
            if(by>=0&&this.board[by][bx])return false;
          }
        }
      }
      return true;
    }

    getRotatedCells(name,rot){
      return PIECE_SHAPES[name].cells[((rot%4)+4)%4];
    }

    move(dx,dy){
      if(!this.current||this.gameOver)return false;
      let c=this.current;
      let cells=c.name==='O'?c.cells:this.getRotatedCells(c.name,c.rot);
      if(this.isValid(c.px+dx,c.py+dy,cells)){
        if(dx!==0){this.lockMoves++;if(this.lockMoves>=15)return true}
        c.px+=dx;
        c.py+=dy;
        this.lastAction='move';
        if(dy===0)this.resetLockIfNeeded();
        return true;
      }
      return false;
    }

    rotate(dir){
      if(!this.current||this.gameOver)return false;
      if(this.current.name==='O')return true;
      let c=this.current;
      let oldRot=c.rot;
      let newRot=((oldRot+dir)%4+4)%4;
      let cells=this.getRotatedCells(c.name,newRot);
      let kicks=c.name==='I'?KICK_I:KICK_JLSTZ;
      let key=oldRot+'>'+newRot;
      let offsets=kicks[key];
      if(!offsets)return false;
      for(let [dx,dy] of offsets){
        if(this.isValid(c.px+dx,c.py+dy,cells)){
          c.px+=dx;
          c.py+=dy;
          c.rot=newRot;
          c.cells=cells;
          this.lastAction='rotate';
          this.resetLockIfNeeded();
          return true;
        }
      }
      return false;
    }

    resetLockIfNeeded(){
      if(!this.hasDropped&&this.lockResets<15){
        this.lockTimer=0;
        this.lockResets++;
      }
    }

    hardDrop(){
      if(!this.current||this.gameOver)return;
      let c=this.current;
      let dy=0;
      let cells=c.name==='O'?c.cells:this.getRotatedCells(c.name,c.rot);
      while(this.isValid(c.px,c.py+dy+1,cells))dy++;
      c.py+=dy;
      this.hasDropped=true;
      this.score+=dy*2;
      this.lockPiece();
    }

    getGhostY(){
      if(!this.current||this.gameOver)return 0;
      let c=this.current;
      let cells=c.name==='O'?c.cells:this.getRotatedCells(c.name,c.rot);
      let dy=0;
      while(this.isValid(c.px,c.py+dy+1,cells))dy++;
      return c.py+dy;
    }

    hold(){
      if(!this.current||!this.canHold||this.gameOver)return;
      let name=this.current.name;
      this.canHold=false;
      if(this.holdPiece){
        let tmp=this.holdPiece;
        this.holdPiece=name;
        this.spawnSpecific(tmp);
      }else{
        this.holdPiece=name;
        this.spawnPiece();
      }
      this.lastAction='hold';
    }

    spawnSpecific(name){
      let shape=PIECE_SHAPES[name];
      let cells=shape.cells[0];
      let px=Math.floor((BOARD_W-cells[0].length)/2);
      let py=0;
      this.current={name,cells,rot:0,px,py};
      this.canHold=false;
      this.hasDropped=false;
      this.lockTimer=0;
      this.lockResets=0;
      this.lockMoves=0;
      this.tSpin=false;
      this.lastAction='spawn';
      if(!this.isValid(px,py,cells)){
        this.gameOver=true;
      }
    }

    lockPiece(){
      if(!this.current||this.gameOver)return;
      let c=this.current;
      let cells=c.name==='O'?c.cells:this.getRotatedCells(c.name,c.rot);
      this.placementX=c.px;
      this.placementY=c.py;
      this.placementRot=c.rot;
      
      for(let r=0;r<cells.length;r++){
        for(let cn=0;cn<cells[r].length;cn++){
          if(cells[r][cn]){
            let bx=c.px+cn,by=c.py+r;
            if(by>=0&&by<BOARD_H&&bx>=0&&bx<BOARD_W){
              this.board[by][bx]=c.name;
            }
          }
        }
      }
      
      // Check T-spin
      this.tSpin=this.detectTSpin(c);
      
      let cleared=this.clearLines();
      
      if(cleared>0){
        let name=c.name;
        let isTSpin=this.tSpin;
        
        // VS scoring
        let send=0;
        if(isTSpin){
          if(cleared===1)send=2; // T-spin single
          else if(cleared===2)send=4; // T-spin double
          else if(cleared===3)send=6; // T-spin triple
        }else{
          if(cleared===1)send=0;
          else if(cleared===2)send=1;
          else if(cleared===3)send=2;
          else if(cleared===4)send=4;
        }
        
        // Combo bonus
        this.combo++;
        if(this.combo>0)send+=this.combo;
        if(this.combo>this.maxCombo)this.maxCombo=this.combo;
        
        // Back-to-back bonus
        if((isTSpin||cleared===4)&&this.backToBack){
          send+=1;
        }
        if(isTSpin||cleared===4){
          this.backToBack=true;
        }else{
          this.backToBack=false;
        }
        
        this.garbageSent+=send;
        this.score+=cleared*100*(1+isTSpin?1:0);
        this.lines+=cleared;
        this.clearCount=cleared;
      }else{
        this.combo=-1;
        this.clearCount=0;
      }
      
      // Queue garbage
      if(this.garbageQueue.length>0){
        this.receiveGarbage();
      }
      
      this.spawnPiece();
    }

    detectTSpin(c){
      if(c.name!=='T')return false;
      // T-spin: check 4 corners of the 3x3 bounding box
      // At least 3 corners must be filled, and the last rotation must be a rotation
      if(this.lastAction!=='rotate'&&this.lastAction!=='spawn')return false;
      let cells=this.getRotatedCells(c.name,c.rot);
      let corners=[[0,0],[0,2],[2,0],[2,2]];
      let filled=0;
      for(let [cr,cc] of corners){
        let bx=c.px+cc,by=c.py+cr;
        if(by<0||by>=BOARD_H||bx<0||bx>=BOARD_W||this.board[by][bx])filled++;
      }
      return filled>=3;
    }

    clearLines(){
      let cleared=[];
      for(let r=BOARD_H-1;r>=0;r--){
        if(this.board[r].every(c=>c!==0)){
          cleared.push(r);
        }
      }
      if(cleared.length===0)return 0;
      for(let r of cleared.sort((a,b)=>a-b)){
        this.board.splice(r,1);
        this.board.unshift(Array(BOARD_W).fill(0));
      }
      return cleared.length;
    }

    receiveGarbage(){
      if(this.gameOver||!this.current)return;
      let lines=this.garbageQueue.shift();
      if(!lines)return;
      this.garbageReceived+=lines.length;
      // Insert garbage lines from bottom
      for(let row of lines){
        this.board.shift();
        this.board.push(row);
      }
    }

    addGarbage(amount){
      if(amount<=0)return;
      for(let i=0;i<amount;i++){
        let hole=Math.floor(this.rng()*BOARD_W);
        let row=Array(BOARD_W).fill('G');
        row[hole]=0;
        this.garbageQueue.push(row);
      }
    }

    tick(gravityFrames){
      if(this.gameOver||this.paused)return;
      this.frames++;
      if(this.current){
        this.gravityTimer++;
        if(this.gravityTimer>=gravityFrames){
          this.gravityTimer=0;
          if(!this.move(0,1)){
            this.lockTimer++;
            if(this.lockTimer>=30||this.hasDropped){
              this.lockPiece();
            }
          }else{
            this.lockTimer=0;
          }
        }
      }
    }

    getVisibleBoard(){
      return this.board.slice(2);
    }

    getState(){
      let board=this.getVisibleBoard();
      let ghostY=this.current?this.getGhostY():0;
      return {
        board,
        current:this.current?{name:this.current.name,rot:this.current.rot,
          px:this.current.px,py:this.current.py-2}:null,
        ghostY:this.current?ghostY-2:0,
        next:this.nextPieces.slice(0,4),
        hold:this.holdPiece,
        score:this.score,
        lines:this.lines,
        combo:this.combo,
        b2b:this.backToBack,
        garbageReceived:this.garbageReceived,
        gameOver:this.gameOver,
        clearCount:this.clearCount,
        clearType:this.tSpin?'tspin':(this.clearCount>0?'normal':'')
      };
    }

    toJSON(){
      return {
        seed:this.seed,
        board:this.board,
        score:this.score,
        lines:this.lines,
        combo:this.combo,
        backToBack:this.backToBack,
        garbageQueue:this.garbageQueue,
        gameOver:this.gameOver,
        canHold:this.canHold,
        holdPiece:this.holdPiece,
        nextPieces:this.nextPieces,
        current:this.current,
        frames:this.frames,
        gravityTimer:this.gravityTimer,
        lockTimer:this.lockTimer,
        lockResets:this.lockResets,
        lockMoves:this.lockMoves,
        hasDropped:this.hasDropped,
        garbageSent:this.garbageSent,
        garbageReceived:this.garbageReceived,
        maxCombo:this.maxCombo,
        clearCount:this.clearCount,
        tSpin:this.tSpin,
        bag:this.bag
      };
    }
  }

  const exports={TetrisEngine,BOARD_W,BOARD_H,VISIBLE_H,PIECE_NAMES,PIECE_SHAPES,
    createRNG,createBag};
  
  if(typeof module!=='undefined'&&module.exports){
    module.exports=exports;
  }else if(typeof window!=='undefined'){
    window.TetrisEngine=TetrisEngine;
    window.BOARD_W=BOARD_W;
    window.BOARD_H=BOARD_H;
    window.VISIBLE_H=VISIBLE_H;
    window.PIECE_NAMES=PIECE_NAMES;
    window.PIECE_SHAPES=PIECE_SHAPES;
    window.engineExports=exports;
  }
})();
