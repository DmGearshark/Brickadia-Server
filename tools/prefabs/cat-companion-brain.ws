@flat
@layout("cube")

// Autonomous cat companion brain.
//
// Physical inputs supplied by the prefab postprocessor:
//   Chassis - the wheel/engine grid (the visible body is servo-attached)
//   Sensor  - an attached zone used to enumerate nearby players and tagged props
//
// Recognized prop tags:
//   beds:   "Cat Bed 1", "cat:bed"
//   food:   "Cat Food" (consumable), "Cat Food 1", "cat:food"
//   treats: "Kitty Treat 1", "cat:treat"
//   toys:   "Cat toy 1", "cat:toy"

in Chassis: entity
in Sensor: zone
in Petter: character

const IDLE = 0
const ROAM = 1
const FOLLOW = 2
const FLEE = 3
const CARRIED = 4
const RETURN_BED = 5
const SEEK_FOOD = 6
const SEEK_TREAT = 7
const STALK = 8
const CHASE = 9
const SEEK_PETS = 10
const SIT = 11
const SLEEP = 12
const WAIT_PETS = 13
const ANGRY = 14
const STRETCH = 15

const HEARING_RANGE = 1200.0
const ARRIVE_RANGE = 75.0
const STALK_POUNCE_RANGE = 180.0
const POUNCE_CONTACT_RANGE = 35.0
const POUNCE_STOP_RANGE = 12.0
const TREAT_WINDOW = 180

var mode: int = IDLE
var seconds: int = 0
var hunger: float = 12.0
var boredom: float = 45.0
var sleepiness: float = 8.0
var socialNeed: float = 15.0
var affection: float = 20.0
var fear: float = 0.0
var driveCommand: float = 0.0
var steerCommand: float = 0.0
var brakeCommand: bool = true
var speedCommand: float = 100.0
var frontSuspension: float = 500.0
var rearSuspension: float = 500.0
var headAngle: float = 0.0
var idleHeadAngle: float = 0.0
var nextIdleHeadTurn: int = 0
var face: string = "😺"
var targetPosition: vector = Vec(0.0, 0.0, 0.0)
var targetValid: bool = false
var homePosition: vector = Vec(0.0, 0.0, 0.0)
var homeKnown: bool = false
var fleeFrom: vector = Vec(0.0, 0.0, 0.0)
var fleeUntil: int = 0
var nearestPlayer: character
var nearestPlayerPosition: vector = Vec(0.0, 0.0, 0.0)
var playerNearby: bool = false
var calledPlayer: character
var calledPlayerPosition: vector = Vec(0.0, 0.0, 0.0)
var callUntil: int = 0
var followedPlayer: character
var stalkingPlayer: bool = false
var stalkedPlayer: character
var stalkedPlayerPosition: vector = Vec(0.0, 0.0, 0.0)
var stalkedToy: entity
var stalkedToyPosition: vector = Vec(0.0, 0.0, 0.0)
var stalkUntil: int = 0
var playRetryAfter: int = 0
var chaseUntil: int = 0
var chaseForPlay: bool = false
var familiarity: Map<string, int>
var bedEntity: entity
var bedPosition: vector = Vec(0.0, 0.0, 0.0)
var bedKnown: bool = false
var foodEntity: entity
var foodPosition: vector = Vec(0.0, 0.0, 0.0)
var foodKnown: bool = false
var foodVisible: bool = false
var foodIsConsumable: bool = false
var treatEntity: entity
var treatPosition: vector = Vec(0.0, 0.0, 0.0)
var treatKnown: bool = false
var treatVisible: bool = false
var treatAt1: int = -10000
var treatAt2: int = -10000
var treatAt3: int = -10000
var treatAt4: int = -10000
var treatAt5: int = -10000
var toyEntity: entity
var toyPosition: vector = Vec(0.0, 0.0, 0.0)
var toyKnown: bool = false
var nearbyPlayers: character[]
var bedTagged: entity[]
var bedNormalized: entity[]
var foodPlain: entity[]
var foodTagged: entity[]
var foodNormalized: entity[]
var treatTagged: entity[]
var treatNormalized: entity[]
var toyTagged: entity[]
var toyNormalized: entity[]
var offGroundSamples: int = 0
var closePlayerForPickup: bool = false
var pickupPlayerPosition: vector = Vec(0.0, 0.0, 0.0)
var carried: bool = false
var wasCarried: bool = false
var likesCurrentPickup: bool = false
var fleeAfterLanding: bool = false
var purrUntil: int = 0
var petCooldown: int = 0
var petRequestUntil: int = 0
var petRequestRetryAfter: int = 0
var requestedPettingUntil: int = 0
var petBurstUntil: int = 0
var petBurstCount: int = 0
var angryUntil: int = 0
var angryDriveUntil: int = 0
var angryLookPosition: vector = Vec(0.0, 0.0, 0.0)
var nextNapAt: int = 0
var napUntil: int = 0
var tired: bool = false
var stretchUntil: int = 0
var nextStretchAt: int = 0
var obstacleTurn: float = 1.0
var avoidTicks: int = 0

// Named, stable outputs expected by merge-cat-wirescript.cjs.
out Drive: float = driveCommand.Value
out Steer: float = steerCommand.Value
out Brake: bool = brakeCommand.Value
out DriveSpeed: float = speedCommand.Value
out FrontSuspension: float = frontSuspension.Value
out RearSuspension: float = rearSuspension.Value
out HeadAngle: float = headAngle.Value
out FaceText: string = if mode.Value == ANGRY then "😾"
  else if mode.Value == STRETCH then "🐈"
  else if mode.Value == FLEE then "😿"
  else if mode.Value == STALK || mode.Value == CHASE then "😼"
  else if mode.Value == SLEEP then "zzZ"
  else if mode.Value == SEEK_TREAT then "😻"
  else if mode.Value == SEEK_FOOD then "😿"
  else if tired.Value || mode.Value == RETURN_BED then "zzz"
  else if hunger.Value >= 72.0 then "😿"
  else face.Value
out MoodColor: color = if mode.Value == ANGRY then ColorSRGB(255, 65, 65, 255)
  else if mode.Value == FLEE then ColorSRGB(70, 135, 255, 255)
  else if mode.Value == SLEEP then ColorSRGB(25, 55, 150, 255)
  else if mode.Value == STALK then ColorSRGB(255, 145, 35, 255)
  else if mode.Value == CHASE then ColorSRGB(255, 225, 45, 255)
  else if mode.Value == STRETCH then ColorSRGB(245, 180, 45, 255)
  else if mode.Value == SEEK_TREAT then ColorSRGB(230, 80, 210, 255)
  else if mode.Value == SEEK_FOOD then ColorSRGB(155, 230, 80, 255)
  else if tired.Value || mode.Value == RETURN_BED then ColorSRGB(45, 225, 235, 255)
  else if hunger.Value >= 72.0 then ColorSRGB(155, 230, 80, 255)
  else if face.Value == "😾" then ColorSRGB(255, 65, 65, 255)
  else if face.Value == "😻" then ColorSRGB(255, 90, 190, 255)
  else if face.Value == "😿" then ColorSRGB(70, 135, 255, 255)
  else if face.Value == "😼" then ColorSRGB(245, 180, 45, 255)
  else ColorSRGB(70, 210, 100, 255)
out Purr: bool = seconds.Value < purrUntil.Value || carried.Value && likesCurrentPickup.Value

mod meow(volume: float = 0.32) {
  let pitchRoll = Random(50, 150)
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  cat.PlayAudioAt(
    $BrickOneShotAudioDescriptor/OBA_Beep_3,
    volume = volume,
    pitch = pitchRoll / 100.0,
    innerRadius = 35.0,
    maxDistance = 650.0,
    spatialized = true,
  )
}

mod need(value: float) -> float {
  return if value < 0.0 then 0.0 else if value > 100.0 then 100.0 else value
}

mod beginFlee(origin: vector, duration: int) {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let position = cat.GetLocation()
  let away = Normalize(Vec(position.x - origin.x, position.y - origin.y, 0.0))
  fleeFrom = origin
  fleeUntil = seconds + duration
  targetPosition = position + away * 650.0
  targetValid = true
  mode = FLEE
  face = "😾"
}

mod aimAway(origin: vector) {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let position = cat.GetLocation()
  let away = Normalize(Vec(position.x - origin.x, position.y - origin.y, 0.0))
  angryLookPosition = origin
  targetPosition = position + away * 650.0
  targetValid = true
}

mod beginAngry(origin: vector, duration: int) {
  mode = ANGRY
  angryUntil = seconds + duration
  angryDriveUntil = seconds + 5
  aimAway(origin)
  petRequestUntil = 0
  requestedPettingUntil = 0
  petRequestRetryAfter = seconds + 45
  purrUntil = seconds
  likesCurrentPickup = false
  face = "😾"
  meow(0.40)
}

mod beginNap() {
  mode = SLEEP
  napUntil = seconds + Random(30, 60)
  targetValid = false
  tired = false
  face = "zzZ"
}

mod beginStretch() {
  mode = STRETCH
  stretchUntil = seconds + Random(4, 7)
  nextStretchAt = seconds + Random(90, 180)
  targetValid = false
  face = "🐈"
}

on Loaded() {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  homePosition = cat.GetLocation()
  homeKnown = true
  targetPosition = homePosition
  face = "😺"
  mode = IDLE
  nextNapAt = seconds + Random(300, 600)
  nextStretchAt = seconds + Random(60, 150)
}

// Refresh the nearby-player snapshot and remember coordinates of recognized props.
on Clock(interval = 1.0) {
  seconds += 1
  if petCooldown > 0 { petCooldown -= 1 }
  if seconds >= nextIdleHeadTurn {
    idleHeadAngle = Random(-32.0, 32.0)
    nextIdleHeadTurn = seconds + Random(3, 7)
  }

  nearbyPlayers.fillFromZonePlayers(Sensor)
  if nearbyPlayers.length() > 0 {
    let candidate = nearbyPlayers.get(0).Value
    nearestPlayer = candidate
    nearestPlayerPosition = candidate.GetLocation()
    playerNearby = true
  } else {
    playerNearby = false
  }

  bedTagged.fillFromZoneEntities(Sensor, "Cat Bed 1")
  bedNormalized.fillFromZoneEntities(Sensor, "cat:bed")
  if bedTagged.length() > 0 {
    bedEntity = bedTagged.get(0).Value
    bedPosition = bedEntity.GetLocation()
    bedKnown = true
  } else if bedNormalized.length() > 0 {
    bedEntity = bedNormalized.get(0).Value
    bedPosition = bedEntity.GetLocation()
    bedKnown = true
  }

  foodPlain.fillFromZoneEntities(Sensor, "Cat Food")
  foodTagged.fillFromZoneEntities(Sensor, "Cat Food 1")
  foodNormalized.fillFromZoneEntities(Sensor, "cat:food")
  foodVisible = false
  if foodPlain.length() > 0 {
    foodEntity = foodPlain.get(0).Value
    foodPosition = foodEntity.GetLocation()
    foodKnown = true
    foodVisible = true
    foodIsConsumable = true
  } else if foodTagged.length() > 0 {
    foodEntity = foodTagged.get(0).Value
    foodPosition = foodEntity.GetLocation()
    foodKnown = true
    foodVisible = true
    foodIsConsumable = false
  } else if foodNormalized.length() > 0 {
    foodEntity = foodNormalized.get(0).Value
    foodPosition = foodEntity.GetLocation()
    foodKnown = true
    foodVisible = true
    foodIsConsumable = false
  }

  treatTagged.fillFromZoneEntities(Sensor, "Kitty Treat 1")
  treatNormalized.fillFromZoneEntities(Sensor, "cat:treat")
  treatVisible = false
  if treatTagged.length() > 0 {
    treatEntity = treatTagged.get(0).Value
    treatPosition = treatEntity.GetLocation()
    treatKnown = true
    treatVisible = true
  } else if treatNormalized.length() > 0 {
    treatEntity = treatNormalized.get(0).Value
    treatPosition = treatEntity.GetLocation()
    treatKnown = true
    treatVisible = true
  }

  toyTagged.fillFromZoneEntities(Sensor, "Cat toy 1")
  toyNormalized.fillFromZoneEntities(Sensor, "cat:toy")
  if toyTagged.length() > 0 {
    toyEntity = toyTagged.get(0).Value
    toyPosition = toyEntity.GetLocation()
    toyKnown = true
  } else if toyNormalized.length() > 0 {
    toyEntity = toyNormalized.get(0).Value
    toyPosition = toyEntity.GetLocation()
    toyKnown = true
  }

  // Needs rise slowly. The final minute before a scheduled nap is visibly tired.
  hunger = need(hunger + 0.75)
  boredom = need(boredom + 0.65)
  sleepiness = need(sleepiness + (if mode == SLEEP then -7.0 else 0.55))
  socialNeed = need(socialNeed + (if seconds < purrUntil then -2.0 else 0.45))
  fear = need(fear - 1.5)
  tired = mode != SLEEP && seconds >= nextNapAt - 60

  // Pickup heuristic: a nearby player plus sustained loss of ground contact.
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let position = cat.GetLocation()
  let pickupPlayer = Sweep(
    position,
    Vec(1.0, 0.0, 0.0),
    1.0,
    radius = 210.0,
    ignore = cat,
    detectPlayers1 = true,
    detectPlayers2 = true,
    detectPlayers3 = true,
    detectPlayers4 = true,
    detectBricks = false,
    detectPhysics = false,
    detectMap = false,
    ignoreOwningGrid = true,
    bodyPartsOnly = false,
  )
  closePlayerForPickup = false
  if pickupPlayer.Hit {
    closePlayerForPickup = true
    pickupPlayerPosition = pickupPlayer.HitEntity.GetLocation()
  }
  let ground = Sweep(
    position + Vec(0.0, 0.0, 12.0),
    Vec(0.0, 0.0, -1.0),
    72.0,
    radius = 4.0,
    ignore = cat,
    detectBricks = true,
    detectPhysics = false,
    detectMap = true,
    detectPlayers1 = false,
    detectPlayers2 = false,
    detectPlayers3 = false,
    detectPlayers4 = false,
    ignoreOwningGrid = true,
  )
  if ground.Miss && closePlayerForPickup {
    offGroundSamples = min(offGroundSamples + 1, 8)
  } else {
    offGroundSamples = if offGroundSamples > 2 then offGroundSamples - 2 else 0
  }
  carried = offGroundSamples >= 2

  if carried && !wasCarried {
    let reaction = Random(0, 100)
    likesCurrentPickup = reaction < min(max(35.0 + affection * 0.55 - fear * 0.35, 10.0), 90.0)
    mode = CARRIED
    driveCommand = 0.0
    brakeCommand = true
    if likesCurrentPickup {
      face = "😻"
      purrUntil = seconds + 20
      affection = need(affection + 4.0)
    } else {
      face = "😿"
      fleeAfterLanding = true
      fear = need(fear + 22.0)
      meow(0.42)
    }
  }

  if !carried && wasCarried {
    if fleeAfterLanding {
      beginFlee(if playerNearby then nearestPlayerPosition else pickupPlayerPosition, 8)
      fleeAfterLanding = false
    } else {
      mode = SIT
      face = "😺"
    }
  }
  wasCarried = carried
}

// Decide what the cat wants. Hard danger and carrying always take priority.
on Clock(interval = 2.0) {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let position = cat.GetLocation()
  let focusValid = if stalkingPlayer then stalkedPlayer != null else stalkedToy != null

  if carried {
    mode = CARRIED
    targetValid = false
  } else if seconds < fleeUntil || fear > 78.0 {
    mode = FLEE
    targetValid = true
    let away = Normalize(Vec(position.x - fleeFrom.x, position.y - fleeFrom.y, 0.0))
    targetPosition = position + away * 650.0
    face = "😿"
  } else if seconds < angryUntil {
    mode = ANGRY
    if seconds < angryDriveUntil {
      let threat = if playerNearby then nearestPlayerPosition else angryLookPosition
      aimAway(threat)
    } else {
      targetValid = false
    }
    face = "😾"
  } else if mode == ANGRY {
    mode = SIT
    targetValid = false
    face = "😺"
  } else if treatKnown && seconds - treatAt5 >= TREAT_WINDOW {
    // Treats override ordinary needs as soon as one has been discovered.
    mode = SEEK_TREAT
    targetPosition = treatPosition
    targetValid = true
    face = "😻"
  } else if mode == WAIT_PETS && seconds < petRequestUntil {
    targetValid = false
    face = "😿"
  } else if mode == WAIT_PETS {
    let ignoredAt = if followedPlayer != null then followedPlayer.GetLocation() else nearestPlayerPosition
    socialNeed = 35.0
    beginAngry(ignoredAt, 12)
  } else if mode == SLEEP && seconds < napUntil {
    targetValid = false
    face = "zzZ"
  } else if mode == SLEEP {
    sleepiness = 0.0
    tired = false
    nextNapAt = seconds + Random(300, 600)
    beginStretch()
  } else if mode == STRETCH && seconds < stretchUntil {
    targetValid = false
    face = "🐈"
  } else if mode == STRETCH {
    mode = SIT
    targetValid = false
    face = "😺"
  } else if mode == RETURN_BED && targetValid {
    targetPosition = bedPosition
    face = "😿"
  } else if seconds >= nextNapAt {
    if bedKnown && Random(0, 100) < 75 {
      mode = RETURN_BED
      targetPosition = bedPosition
      targetValid = true
      face = "😿"
    } else {
      beginNap()
    }
  } else if hunger > 72.0 && foodKnown {
    mode = SEEK_FOOD
    targetPosition = foodPosition
    targetValid = true
    face = "😿"
  } else if seconds < callUntil && calledPlayer != null {
    mode = FOLLOW
    followedPlayer = calledPlayer
    targetPosition = calledPlayerPosition
    targetValid = true
    face = "😺"
  } else if mode == CHASE && seconds < chaseUntil && (!chaseForPlay || focusValid) {
    if chaseForPlay {
      let chaseCenter = if stalkingPlayer then stalkedPlayerPosition else stalkedToyPosition
      targetPosition = chaseCenter
    }
    targetValid = true
    face = "😼"
  } else if mode == CHASE {
    // A missed focused pounce ends without relieving boredom. A spontaneous
    // sprint simply settles down when its short timer ends.
    if chaseForPlay { playRetryAfter = seconds + 15 }
    chaseForPlay = false
    stalkedPlayer = null
    stalkedToy = null
    mode = SIT
    targetValid = false
    face = "😿"
  } else if mode == STALK && targetValid && seconds < stalkUntil && focusValid {
    face = "😼"
  } else if mode == STALK {
    // Give up on a stale or unreachable focus instead of crouching forever.
    playRetryAfter = seconds + 15
    if !stalkingPlayer {
      toyEntity = null
      toyKnown = false
    }
    stalkedPlayer = null
    stalkedToy = null
    mode = SIT
    targetValid = false
    face = "😿"
  } else if boredom > 55.0 && seconds >= playRetryAfter
    && (toyKnown && toyEntity != null || playerNearby && nearestPlayer != null) {
    // A known toy always wins. Players are the fallback when no toy is known.
    // STALK can only be entered after one of those two exact entities is locked.
    let choosePlayer = !(toyKnown && toyEntity != null) && playerNearby
    mode = STALK
    stalkingPlayer = choosePlayer
    chaseForPlay = false
    if choosePlayer {
      stalkedPlayer = nearestPlayer
      stalkedPlayerPosition = nearestPlayerPosition
      stalkedToy = null
    } else {
      stalkedPlayer = null
      stalkedToy = toyEntity
      stalkedToyPosition = toyPosition
    }
    stalkUntil = seconds + 30
    targetPosition = if choosePlayer then stalkedPlayerPosition else stalkedToyPosition
    targetValid = true
    face = "😼"
  } else if socialNeed > 68.0 && playerNearby && seconds >= petRequestRetryAfter {
    mode = SEEK_PETS
    followedPlayer = nearestPlayer
    targetPosition = nearestPlayerPosition
    targetValid = true
    face = "😿"
    if Random(0, 100) < 35 { meow(0.30) }
  } else if playerNearby && affection > 45.0 && Random(0, 100) < 35 {
    mode = FOLLOW
    followedPlayer = nearestPlayer
    targetPosition = nearestPlayerPosition
    targetValid = true
    face = "😺"
  } else if seconds >= nextStretchAt && !tired {
    beginStretch()
  } else {
    let choice = Random(0, 100)
    if choice < 10 {
      // A Chase is occasionally just a burst of energy with no stalking focus.
      mode = CHASE
      chaseForPlay = false
      chaseUntil = seconds + Random(5, 8)
      stalkingPlayer = false
      stalkedPlayer = null
      stalkedToy = null
      let sprint = Random(Vec(-650.0, -650.0, 0.0), Vec(650.0, 650.0, 0.0))
      targetPosition = position + sprint
      targetValid = true
      face = "😼"
    } else if choice < 42 {
      mode = SIT
      targetValid = false
      face = "😺"
    } else {
      mode = ROAM
      let wander = Random(Vec(-480.0, -480.0, 0.0), Vec(480.0, 480.0, 0.0))
      targetPosition = (if homeKnown then homePosition else position) + wander
      targetValid = true
      face = if choice > 88 then "😼" else "😺"
    }
  }

  // Arrival actions and need relief. Stalking changes into Chase from farther
  // away; focused Chase only succeeds after reaching the selected entity.
  let arrivalRange = if mode == STALK then STALK_POUNCE_RANGE
    else if mode == CHASE && chaseForPlay then POUNCE_CONTACT_RANGE
    else ARRIVE_RANGE
  if targetValid && Distance(position, targetPosition) < arrivalRange {
    if mode == RETURN_BED {
      beginNap()
    } else if mode == SEEK_FOOD {
      if foodEntity != null && (!foodIsConsumable || foodVisible) {
        if foodIsConsumable { foodEntity.DestroySpawnedPrefab() }
        hunger = 8.0
        face = "😻"
        meow(0.28)
      } else {
        face = "😿"
        meow(0.20)
      }
      if foodIsConsumable {
        foodEntity = null
        foodKnown = false
        foodVisible = false
        foodIsConsumable = false
      }
      mode = SIT
      targetValid = false
    } else if mode == SEEK_TREAT {
      // Confirm the remembered treat is still inside the attached zone before
      // rewarding the cat. Consumables must be standalone spawned prefabs.
      if treatEntity != null && treatVisible {
        treatEntity.DestroySpawnedPrefab()
        treatAt5 = treatAt4
        treatAt4 = treatAt3
        treatAt3 = treatAt2
        treatAt2 = treatAt1
        treatAt1 = seconds
        hunger = need(hunger - 28.0)
        boredom = need(boredom - 18.0)
        affection = need(affection + 12.0)
        if playerNearby {
          let id = nearestPlayer.GetUserId()
          let old = familiarity.get(id)
          familiarity.set(id, min((if old.Found then old.Value else 0) + 25, 100))
        }
        face = "😻"
        purrUntil = seconds + 6
      } else {
        face = "😿"
        meow(0.20)
      }
      treatEntity = null
      treatKnown = false
      treatVisible = false
      mode = SIT
      targetValid = false
    } else if mode == STALK {
      mode = CHASE
      chaseForPlay = true
      chaseUntil = seconds + 8
      let chaseCenter = if stalkingPlayer then stalkedPlayerPosition else stalkedToyPosition
      targetPosition = chaseCenter
      targetValid = true
      face = "😼"
    } else if mode == CHASE {
      let completedPlay = chaseForPlay
      if completedPlay { boredom = need(boredom - 35.0) }
      chaseForPlay = false
      stalkedPlayer = null
      stalkedToy = null
      mode = SIT
      targetValid = false
      face = if completedPlay then "😻" else "😼"
    } else if mode == SEEK_PETS {
      mode = WAIT_PETS
      petRequestUntil = seconds + 15
      requestedPettingUntil = 0
      petBurstCount = 0
      petBurstUntil = seconds + 12
      targetValid = false
      face = "😿"
    } else if mode == FOLLOW {
      mode = SIT
      targetValid = false
    } else if mode == ROAM {
      mode = IDLE
      targetValid = false
    }
  }
}

// Motion, posture, and simple obstacle avoidance.
on Clock(interval = 0.2) {
  let wantedFront = if mode == ANGRY then 100.0
    else if mode == STRETCH then 100.0
    else if mode == STALK then 100.0
    else if mode == SLEEP then 100.0
    else 500.0
  let wantedRear = if mode == ANGRY then 100.0
    else if mode == STRETCH then 500.0
    else if mode == STALK then 500.0
    else if mode == SLEEP || mode == SIT then 100.0
    else 500.0
  let wantedSpeed = if mode == STALK || mode == SIT || mode == SLEEP
    || mode == STRETCH || mode == CARRIED then 50.0
    else if mode == CHASE then 280.0
    else if mode == FLEE then 320.0
    else if mode == ANGRY then 180.0
    else 100.0

  frontSuspension = lerp(frontSuspension, wantedFront, 0.18)
  rearSuspension = lerp(rearSuspension, wantedRear, 0.18)
  speedCommand = wantedSpeed

  // The servo sits on the chassis and rotates the head grid. Look toward the
  // current activity, toward a nearby player while socializing, or around at
  // random while idle. Sleeping returns the neck to its neutral angle.
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let transform = cat.GetLocationRotation()
  let position = transform.Vector
  let rawForward = transform.Rotation.ToDirection()
  let forward = Normalize(Vec(rawForward.x, rawForward.y, 0.0))
  var lookPosition: vector = targetPosition
  var lookValid: bool = false
  if mode != SLEEP && mode != STRETCH {
    if mode == CARRIED && closePlayerForPickup {
      lookPosition = pickupPlayerPosition
      lookValid = true
    } else if (mode == STALK || mode == CHASE) && stalkingPlayer && stalkedPlayer != null {
      lookPosition = stalkedPlayerPosition
      lookValid = true
    } else if (mode == STALK || mode == CHASE) && !stalkingPlayer && stalkedToy != null {
      lookPosition = stalkedToyPosition
      lookValid = true
    } else if mode == ANGRY {
      lookPosition = angryLookPosition
      lookValid = true
    } else if targetValid {
      lookPosition = targetPosition
      lookValid = true
    } else if followedPlayer != null && (mode == SEEK_PETS || mode == WAIT_PETS) {
      lookPosition = followedPlayer.GetLocation()
      lookValid = true
    } else if playerNearby && mode == SIT {
      lookPosition = nearestPlayerPosition
      lookValid = true
    }
  }
  var wantedHeadAngle: float = if mode == SLEEP || mode == STRETCH then 0.0 else idleHeadAngle
  if lookValid {
    let toLook = Vec(lookPosition.x - position.x, lookPosition.y - position.y, 0.0)
    if Magnitude(toLook) > 8.0 {
      let desiredLook = Normalize(toLook)
      let lookRadians = atan2(Cross(forward, desiredLook).z, Dot(forward, desiredLook))
      wantedHeadAngle = min(max(lookRadians * 57.2958, -55.0), 55.0)
    }
  }
  headAngle = lerp(headAngle, wantedHeadAngle, 0.22)

  if mode == STRETCH {
    driveCommand = -0.18
    steerCommand = 0.0
    brakeCommand = false
    avoidTicks = 0
  } else if mode == CARRIED || mode == SIT || mode == SLEEP || mode == WAIT_PETS
    || mode == IDLE || !targetValid {
    driveCommand = 0.0
    steerCommand = 0.0
    brakeCommand = true
    avoidTicks = 0
  } else if avoidTicks > 0 {
    driveCommand = -0.32
    steerCommand = obstacleTurn
    brakeCommand = false
    avoidTicks -= 1
  } else {
    let toTarget = Vec(targetPosition.x - position.x, targetPosition.y - position.y, 0.0)
    let distance = Magnitude(toTarget)
    let desired = Normalize(toTarget)
    let turnAngle = atan2(Cross(forward, desired).z, Dot(forward, desired))

    let stoppingRange = if mode == CHASE && chaseForPlay then POUNCE_STOP_RANGE else ARRIVE_RANGE
    driveCommand = if distance > stoppingRange then (if mode == CHASE then 1.0 else 0.72) else 0.0
    steerCommand = min(max(turnAngle / 1.15, -1.0), 1.0)
    brakeCommand = distance <= stoppingRange

    let activityTarget = mode == RETURN_BED || mode == SEEK_FOOD || mode == SEEK_TREAT
      || mode == STALK || mode == CHASE
    if !(activityTarget && distance < 150.0) {
      let obstacle = Sweep(
        position + Vec(0.0, 0.0, 10.0),
        forward,
        92.0,
        radius = 12.0,
        ignore = cat,
        detectBricks = true,
        detectPhysics = false,
        detectMap = true,
        detectPlayers1 = false,
        detectPlayers2 = false,
        detectPlayers3 = false,
        detectPlayers4 = false,
        ignoreOwningGrid = true,
      )
      if obstacle.Hit {
        avoidTicks = 5
        obstacleTurn = -obstacleTurn
        driveCommand = -0.32
        steerCommand = obstacleTurn
        brakeCommand = false
      }
    }
  }
}

// Petting applies to the chassis grid that holds the outer chip.
// The postprocessor sets this event's prompt to "Pet Cat" and enables nearby interaction.
on WholeGridInteracted() -> { held: isHeld } {
  if isHeld && petCooldown == 0 {
    petCooldown = 2
    let petPosition = if Petter != null then Petter.GetLocation() else nearestPlayerPosition
    if Petter != null {
      followedPlayer = Petter
    } else if playerNearby {
      followedPlayer = nearestPlayer
    } else {
      followedPlayer = null
    }

    if mode == FLEE {
      // Fear cannot be canceled by repeatedly interacting with the cat.
      face = "😿"
    } else if mode == ANGRY || seconds < angryUntil {
      // Petting an angry cat restarts a short retreat and gives no reward.
      angryUntil = max(angryUntil, seconds + 6)
      angryDriveUntil = max(angryDriveUntil, seconds + 3)
      aimAway(petPosition)
      face = "😾"
    } else {
      let requestActive = mode == SEEK_PETS || mode == WAIT_PETS
      let requestedSession = requestActive || seconds < requestedPettingUntil
      if seconds >= petBurstUntil {
        petBurstCount = 0
        petBurstUntil = seconds + 12
      }
      petBurstCount += 1
      if requestActive { requestedPettingUntil = seconds + 12 }

      let tooMuchRequested = requestedSession && petBurstCount >= 6
      let annoyedUnsolicited = !requestedSession && petBurstCount >= 3
        && Random(0, 100) < 35
      if tooMuchRequested || annoyedUnsolicited {
        beginAngry(petPosition, 12)
      } else {
        socialNeed = need(socialNeed - 42.0)
        fear = need(fear - 18.0)
        affection = need(affection + 7.0)
        purrUntil = seconds + 8
        face = "😻"
        mode = SIT
        petRequestUntil = 0
        if Petter != null || playerNearby {
          let credited = if Petter != null then Petter else nearestPlayer
          let id = credited.GetUserId()
          let old = familiarity.get(id)
          familiarity.set(id, min((if old.Found then old.Value else 0) + 12, 100))
        }
      }
    }
  }
}

// Damage is an immediate high-priority fear trigger.
on WholeGridTargeted() -> (attacker, damage, weapon, weaponName) {
  let source = if attacker != null then attacker.GetLocation() else nearestPlayerPosition
  fear = need(fear + max(damage, 20.0))
  beginFlee(source, 12)
  meow(0.48)
}

// /cat is global at the gate level, then range-filtered here. Familiar players
// are usually answered; strangers are sometimes acknowledged and often ignored.
on ChatCommand("cat", "Call a nearby cat") -> (controller, arguments) {
  let caller = controller.CharacterOf()
  if caller != null {
    let callerPosition = caller.GetLocation()
    let catPosition = (if Chassis != null then Chassis else ReadBrickGrid()).GetLocation()
    if Distance(callerPosition, catPosition) <= HEARING_RANGE
      && seconds >= angryUntil && mode != WAIT_PETS {
      let id = controller.GetUserId()
      let known = familiarity.get(id)
      let trust = if known.Found then known.Value else 0
      let response = Random(0, 100)
      if response < min(12 + trust, 95) {
        calledPlayer = caller
        followedPlayer = caller
        calledPlayerPosition = callerPosition
        callUntil = seconds + 20
        mode = FOLLOW
        targetPosition = callerPosition
        targetValid = true
        face = if trust >= 35 then "😻" else "😺"
        meow(0.34)
      } else if response < 22 {
        // The cat heard its name but chose not to come.
        face = "😼"
        meow(0.20)
      }
    }
  }
}

// Keep live targets fresh between the slower behavior decisions.
on Clock(interval = 0.5) {
  if seconds < callUntil && calledPlayer != null {
    calledPlayerPosition = calledPlayer.GetLocation()
    if mode == FOLLOW {
      targetPosition = calledPlayerPosition
      targetValid = true
    }
  } else if (mode == FOLLOW || mode == SEEK_PETS) && followedPlayer != null {
    targetPosition = followedPlayer.GetLocation()
    targetValid = true
  }
  if mode == ANGRY && followedPlayer != null {
    angryLookPosition = followedPlayer.GetLocation()
  }
  if mode == STALK || mode == CHASE && chaseForPlay {
    if stalkingPlayer && stalkedPlayer != null {
      stalkedPlayerPosition = stalkedPlayer.GetLocation()
      targetPosition = stalkedPlayerPosition
    } else if stalkedToy != null {
      stalkedToyPosition = stalkedToy.GetLocation()
      targetPosition = stalkedToyPosition
    }
  }
  if mode == SEEK_FOOD && foodEntity != null {
    foodPosition = foodEntity.GetLocation()
    targetPosition = foodPosition
  }
  if mode == SEEK_TREAT && treatEntity != null {
    treatPosition = treatEntity.GetLocation()
    targetPosition = treatPosition
  }
}
