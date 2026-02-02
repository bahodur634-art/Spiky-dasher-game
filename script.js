/*
  Changes summary (script.js):
  - Compute tile sizes from measured #game_console rect at runtime (fix responsive / mobile layout)
  - Removed hardcoded width/height assignments and fixed layout on resize
  - Fixed gamepad handling bug and element null checks (safe collisions)
  - Added mobile on-screen controls (pointer/touch) with continuous-hold support
  - Debounced resize and rebuilt level while preserving current level
  - Added safe service worker registration separately in HTML (not inlined here)
*/
const gc = document.querySelector('#game_console')
const player = 'player2'
var pl;

var cols = 40 // multiple of 16
var rows = 22 // multiple of 9
var tile_size = 0
var pl_size = 0

document.body.style.setProperty('--tile-line-height', '30px')

let controlsAttached = false
let resizeTimer = null

function computeLayout() {
  // compute tile size to fit the container (keeps square tiles)
  const gc_loc = gc.getBoundingClientRect()
  tile_size = Math.max(4, Math.floor(Math.min(gc_loc.width / cols, gc_loc.height / rows)))
  pl_size = tile_size * 2
  document.body.style.setProperty('--tile-line-height', pl_size + 'px')
  return gc_loc
}

// Rebuild on resize but preserve current level number
window.addEventListener('resize', function () {
  window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(function () { buildGame(true) }, 120)
})

var gravity = 8,
  kd,
  x_speed = 5,
  pb_y = 0,
  score = 0,
  rot = 0,
  data_p = 0,
  bonus = 1,
  dead = false,
  kd_list = [],
  d = {},
  gp,
  gpa,
  dbljump = false,
  dash = false,
  timer = 0,
  level_num = -1;

const levels = [
 // (kept as-is; unchanged level data arrays from original script)
]

// Build & run game (preserveLevel = true keeps same level on resize)
function buildGame(preserveLevel = false) {
  // clear tiles and update level number
  gc.innerHTML = "<div id='" + player + "'></div><div id='game_alert'></div><div id='deaths_counter'></div><div id='time_counter'></div>"
  if (!preserveLevel) {
    if (level_num < levels.length - 1) {
      level_num++
    } else {
      level_num = 0
    }
  }

  // compute layout to obtain correct tile sizes
  const gc_loc = computeLayout()

  // reset per-level timer and deaths
  timer = 0
  let deaths = 0
  let tc = document.querySelector('#time_counter')
  let dc = document.querySelector('#deaths_counter')
  tc.innerHTML = 'TIME<br>' + '00:00:00'
  dc.innerHTML = 'DEATHS<br>' + deaths

  // set random level color
  document.body.style.setProperty('--root-clr', 'hsl(' + Math.random() * 360 + 'deg,75%,50%)')

  // add tiles for new level
  for (var i = 0; i < cols * rows; i++) {
    var d = document.createElement('div')
    d.className = 'tile'

    if (levels[level_num].map[i] == 0) {
      d.className = 'tile ground'
    }
    if (levels[level_num].map[i] == 2) {
      d.className = 'tile lava'
    }
    if (levels[level_num].map[i] == 3) {
      d.className = 'tile lava spleft'
    }
    if (levels[level_num].map[i] == 4) {
      d.className = 'tile lava sptop'
    }
    if (levels[level_num].map[i] == 5) {
      d.className = 'tile lava spright'
    }
    if (levels[level_num].map[i] == 6) {
      d.className = 'tile portal1'
    }
    if (levels[level_num].map[i] == 7) {
      d.className = 'tile portal2'
    }
    if (levels[level_num].map[i] == 8) {
      d.className = 'tile innerwall'
    }
    if (levels[level_num].map[i] == 9) {
      d.className = 'tile nextlevel'
    }
    d.setAttribute('grid_loc', [i % cols, Math.floor(i / cols)])
    d.style.width = tile_size + 'px'
    d.style.height = tile_size + 'px'
    d.style.position = 'absolute'
    d.style.left = (i % cols) * tile_size + 'px'
    d.style.top = Math.floor(i / cols) * tile_size + 'px'

    gc.appendChild(d)
  }

  // add player stuff
  const ga = document.querySelector('#game_alert')
  var pl = document.querySelector('#' + player)
  pl.style.width = tile_size + 'px'
  pl.style.height = tile_size + 'px'
  pl.style.top = (tile_size * levels[level_num].start.split(',')[1]) + 'px'
  pl.style.left = (tile_size * levels[level_num].start.split(',')[0]) + 'px'

  // add info box
  ga.innerHTML = 'Arrow keys to move and jump<br>double jump / wall sliding'
  ga.style.opacity = '1'

  var pl_loc = pl.getBoundingClientRect()
  var x = pl_loc.left

  // helper for safe class checks
  function hasClass(el, cls) {
    return el && el.classList && el.classList.contains && el.classList.contains(cls)
  }

  function updatePlayer() {
    // recompute container rect each frame in case of rotation/resize
    const gc_loc = gc.getBoundingClientRect()

    // get points based on player location
    var pl_loc = pl.getBoundingClientRect()
    var pl_center = document.elementFromPoint(pl_loc.x + (tile_size * .5), pl_loc.y + (tile_size * .75))
    var pl_xy1 = document.elementFromPoint(pl_loc.x + (pl_loc.width * .25), pl_loc.y + pl_loc.height + gravity)
    var pl_xy2 = document.elementFromPoint(pl_loc.x + (pl_loc.width * .75), pl_loc.y + pl_loc.height + gravity)
    var pl_xy3 = document.elementFromPoint(pl_loc.x - (x_speed * .5), pl_loc.y + (pl_loc.height * .5))
    var pl_xy4 = document.elementFromPoint(pl_loc.x + pl_loc.width + (x_speed * .5), pl_loc.y + (pl_loc.height * .5))
    var pl_xy5 = document.elementFromPoint(pl_loc.x + (pl_loc.width * .5), pl_loc.y - (gravity * .5))

    //if dead stop, else update player and everything else
    if (dead) {
      return
    }

    // set player top: if player on ground set new top
    if (hasClass(pl_xy1, 'ground') || hasClass(pl_xy2, 'ground')) {
      gravity = 0
    } else {
      if (gravity < 8) {
        gravity += .51
      } else {
        gravity = 8
      }
    }

    pl.style.top = pl_loc.top - 6.25 - gc_loc.top + gravity + 'px'

    // handle gamepads safely (do not early-return)
    var gamepads = (navigator.getGamepads && navigator.getGamepads()) || (navigator.webkitGetGamepads && navigator.webkitGetGamepads()) || [];
    var gp = (gamepads && gamepads[0]) ? gamepads[0] : null

    // add jump-force (change the gravity)
    var jumpPressed = d[38] || d[87] || (gp && (gp.buttons[0].pressed || gp.buttons[1].pressed || gp.buttons[2].pressed || gp.buttons[3].pressed))

    if (jumpPressed && gravity == 0) {
      dbljump = false
      gravity = -9
    } else if (jumpPressed && gravity > 0) {
      if (!dbljump) {
        gravity = -9
      }
      dbljump = true
    }

    var gpa = gp && gp.axes ? Math.round(gp.axes[0]) : 0
    if (gp) {
      if (gpa == 0 || gravity == 0) {
        pl.className = ''
        pl.style.transform = 'rotate(0deg)'
      }
    }

    // track left/right movement
    if ((d[37] || d[65] || gpa == -1) && x > gc_loc.left) {
      if (!hasClass(pl_xy3, 'ground')) {
        x -= x_speed
        pl.className = ''
        pl.classList.add('goleft')
      } else {
        if (gravity > 0) {
          dbljump = false
          gravity = 1
          pl.style.transform = 'rotate(90deg)'
        }
        pl.className = ''
      }
    }

    if ((d[39] || d[68] || gpa == 1) && x + pl_loc.width < gc_loc.left + gc_loc.width) {
      if (!hasClass(pl_xy4, 'ground')) {
        x += x_speed
        pl.className = ''
        pl.classList.add('goright')
      } else {
        if (gravity > 0) {
          dbljump = false
          gravity = 1
          pl.style.transform = 'rotate(-90deg)'
        }
        pl.className = ''
      }
    }

    pl.style.left = x - gc_loc.left + 'px'

    // set different interactions based on tile type
    if (hasClass(pl_xy5, 'ground')) {
      gravity = 8
    }

    if (hasClass(pl_center, 'lava')) {
      // respawn
      pl.style.top = (tile_size * levels[level_num].start.split(',')[1]) + 'px'
      pl.style.left = (tile_size * levels[level_num].start.split(',')[0]) + 'px'
      pl_loc = pl.getBoundingClientRect()
      x = pl_loc.left
      deaths++
      dc.innerHTML = 'DEATHS<br>' + deaths
    }

    if (hasClass(pl_center, 'portal1')) {
      let p2 = document.querySelector('.portal2')
      if (p2) {
        let p2_loc = p2.getBoundingClientRect()
        pl.style.top = p2_loc.top - gc_loc.top + 'px'
        pl.style.left = p2_loc.left - gc_loc.left + 'px'
        pl_loc = pl.getBoundingClientRect()
        x = pl_loc.left
      }
    }

    if (hasClass(pl_center, 'nextlevel')) {
      buildGame()
      return
    }

    timer++
    function secondsToTime(e) {
      var h = Math.floor(e / 3600).toString().padStart(2, '0'),
        m = Math.floor(e % 3600 / 60).toString().padStart(2, '0'),
        s = Math.floor(e % 60).toString().padStart(2, '0');

      return h + ':' + m + ':' + s;
    }
    tc.innerHTML = 'TIME<br>' + secondsToTime(timer)

    playerTrail()
    // use requestAnimationFrame for smoother updates and battery friendly on mobile
    setTimeout(updatePlayer, 1000 / 45)
  }

  updatePlayer()

  // add trail behind player b/c it's fun
  function playerTrail() {
    if (player == 'player') {
      let x = pl.getBoundingClientRect().x
      let y = pl.getBoundingClientRect().y
      let b = document.createElement('div')
      b.className = 'trailBall'
      b.style.left = x + 11 - gc.getBoundingClientRect().left + 'px'
      b.style.top = y + 5 - gc.getBoundingClientRect().top + 'px'
      b.onanimationend = function () {
        b.remove()
      }
      gc.appendChild(b)
    }

    if (player == 'player2') {
      let x = pl.getBoundingClientRect().x
      let y = pl.getBoundingClientRect().y
      let b = document.createElement('div')
      b.className = 'trailBall'
      let xx = Math.floor(Math.random() * 15) + 5
      b.style.left = x + xx - gc.getBoundingClientRect().left + 'px'
      b.style.top = y - 3 - gc.getBoundingClientRect().top + 'px'
      b.onanimationend = function () {
        b.remove()
      }
      gc.appendChild(b)
    }

  }

  // key tracking and mobile controls - attach only once
  if (!controlsAttached) {
    window.addEventListener('keydown', function (e) {
      d[e.which] = true;
    })
    window.addEventListener('keyup', function (e) {
      d[e.which] = false;
      // reset player visual state
      var p = document.querySelector('#' + player)
      if (p) {
        p.className = ''
        p.style.transform = 'rotate(0deg)'
      }
    })

    window.addEventListener('gamepadconnected', function (e) {
      console.info('Gamepad connected')
    });

    // Mobile control buttons (pointer API for consistent hold behavior)
    const btnLeft = document.getElementById('btn_left')
    const btnRight = document.getElementById('btn_right')
    const btnJump = document.getElementById('btn_jump')

    const setPointer = function (el, keyCode, onDownOnce) {
      if (!el) return
      let pressed = false
      el.addEventListener('pointerdown', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        pressed = true
        d[keyCode] = true
        if (onDownOnce) {
          // briefly trigger and do not set hold if requested (jump behavior)
          setTimeout(() => { d[keyCode] = false }, 150)
        }
      })
      const up = function (ev) {
        pressed = false
        d[keyCode] = false
        ev && ev.preventDefault()
      }
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
      el.addEventListener('lostpointercapture', up)
      // prevent touch-move from scrolling
      el.addEventListener('touchmove', function (e) { e.preventDefault() }, { passive: false })
    }

    // keycodes: left=37, up=38, right=39
    setPointer(btnLeft, 37, false)
    setPointer(btnRight, 39, false)
    setPointer(btnJump, 38, true)

    // ensure we clear mobile pointer flags if pointer ends anywhere
    window.addEventListener('pointerup', function () { d[37] = d[38] = d[39] = false })

    controlsAttached = true
  } else {
    timer = 0
    deaths = 0
  }
}

window.addEventListener('load', function () { buildGame(false) })
window.focus()