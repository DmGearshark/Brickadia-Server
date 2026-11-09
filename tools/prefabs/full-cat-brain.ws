@flat
@layout("cube")

// Autonomous companion cat brain for the supplied Cat Frame.
//
// The behavior clock owns perception, needs, memory, learning, and state
// transitions. The fast clock is the sole writer of drive, steering, brakes,
// suspension, and neck commands. Targets stay committed until the current
// action succeeds, times out, or becomes unsafe.

in Chassis: entity
in Head: entity
in Radar: zone
in Mouth: zone
in Petter: character
in CurrentSpeed: float
in EngineStalling: bool
in HeadCurrentAngle: float

const RELAX = 0
const ROAM = 1
const FOLLOW = 2
const SEEK_FOOD = 3
const EAT = 4
const SEEK_TREAT = 5
const SEEK_PETS = 6
const WAIT_PETS = 7
const PETTED = 8
const STALK = 9
const CHASE = 10
const SEEK_BED = 11
const SLEEPY = 12
const SLEEP = 13
const FLEE = 14
const ANGRY = 15
const STRETCH = 16
const GROOM = 17
const RETURN_HOME = 18

const TARGET_NONE = 0
const TARGET_PLAYER = 1
const TARGET_FOOD = 2
const TARGET_TREAT = 3
const TARGET_TOY = 4
const TARGET_BED = 5
const TARGET_HOME = 6

const HEARING_RANGE = 1200.0
const RADAR_RANGE = 900.0
const FOLLOW_STOP = 105.0
const FOOD_STOP = 24.0
const BED_STOP = 70.0
const STALK_TO_CHASE = 180.0
const CHASE_CONTACT = 38.0
const HOME_LIMIT = 900.0
const TREAT_WINDOW = 180

const PURR_SOUND = $BrickAudioDescriptor/BA_Thumpy_Machine
const MEOW_SOUND = $BrickOneShotAudioDescriptor/OBA_Beep_4

var seconds: int = 0
var state: int = ROAM
var previousState: int = ROAM
var stateUntil: int = 0
var commitUntil: int = 0
var stateStarted: int = 0

var hunger: float = 15.0
var sleepiness: float = 8.0
var boredom: float = 28.0
var socialNeed: float = 20.0
var fear: float = 0.0
var annoyance: float = 0.0
var relaxNeed: float = 45.0

var sociability: float = 1.0
var playfulness: float = 1.0
var boldness: float = 1.0
var patience: float = 1.0
var foodDrive: float = 1.0
var curiosity: float = 1.0
var trainability: float = 1.0
var personalityInitialized: bool = false

// Slowly learned preferences. Safety and critical needs ignore these values.
var foodPreference: float = 0.0
var playPreference: float = 0.0
var petPreference: float = 0.0
var bedPreference: float = 0.0
var followPreference: float = 0.0
var roamPreference: float = 0.0

var affectionByPlayer: Map<string, int>
var irritationByPlayer: Map<string, int>

var driveCommand: float = 0.0
var steerCommand: float = 0.0
var brakeCommand: bool = true
var driveSpeedCommand: float = 110.0
var frontSuspension: float = 500.0
var rearSuspension: float = 500.0
var headAngle: float = 0.0
var idleHeadAngle: float = 0.0
var nextIdleHeadTurn: int = 0

var homePosition: vector = Vec(0.0, 0.0, 0.0)
var homeKnown: bool = false
var targetEntity: entity
var targetPosition: vector = Vec(0.0, 0.0, 0.0)
var targetValid: bool = false
var targetKind: int = TARGET_NONE
var targetVisible: bool = false
var focusPosition: vector = Vec(0.0, 0.0, 0.0)
var focusValid: bool = false

var nearestPlayer: entity
var nearestPlayerCharacter: character
var nearestPlayerPosition: vector = Vec(0.0, 0.0, 0.0)
var playerNearby: bool = false
var nearestPlayerAffection: int = 0
var nearestPlayerIrritation: int = 0
var calledPlayer: entity
var callUntil: int = 0

var rememberedFood: entity
var rememberedFoodPosition: vector = Vec(0.0, 0.0, 0.0)
var foodKnown: bool = false
var foodVisible: bool = false
var rememberedToy: entity
var rememberedToyPosition: vector = Vec(0.0, 0.0, 0.0)
var toyKnown: bool = false
var toyVisible: bool = false
var rememberedBed: entity
var rememberedBedPosition: vector = Vec(0.0, 0.0, 0.0)
var bedKnown: bool = false
var bedVisible: bool = false
var visibleTreat: entity
var visibleTreatPosition: vector = Vec(0.0, 0.0, 0.0)
var treatVisible: bool = false

var eatingTarget: entity
var eatingKind: int = TARGET_NONE
var eatProgress: int = 0
var mouthMatchingTarget: bool = false

var treatAt1: int = -10000
var treatAt2: int = -10000
var treatAt3: int = -10000
var treatAt4: int = -10000
var treatAt5: int = -10000

var purrUntil: int = 0
var petOverlayUntil: int = 0
var nextPetAt: int = 0
var petBurstCount: int = 0
var petBurstUntil: int = 0
var requestedPetUntil: int = 0
var angryRetreatUntil: int = 0
var fearOrigin: vector = Vec(0.0, 0.0, 0.0)

var roamSteerBias: float = 0.0
var recoverTicks: int = 0
var recoverTurn: float = 0.75
var recoverCooldownTicks: int = 0
var recoveryRequest: bool = false
var stuckSeconds: int = 0
var recoveryAttempts: int = 0
var lastProgressPosition: vector = Vec(0.0, 0.0, 0.0)
var lastDistance: float = 1000000.0
var failedTargetUntil: int = 0
var failedTargetPosition: vector = Vec(0.0, 0.0, 0.0)

var players: character[]
var food1: entity[]
var foodLegacy: entity[]
var foodNormalized: entity[]
var treat1: entity[]
var treat2: entity[]
var treat3: entity[]
var treatLower1: entity[]
var treatLower2: entity[]
var treatLower3: entity[]
var treatNormalized: entity[]
var toy1: entity[]
var toy2: entity[]
var toy3: entity[]
var toyLegacy: entity[]
var toyNormalized: entity[]
var bed1: entity[]
var bedNormalized: entity[]

var mouthFood1: entity[]
var mouthFoodLegacy: entity[]
var mouthFoodNormalized: entity[]
var mouthTreat1: entity[]
var mouthTreat2: entity[]
var mouthTreat3: entity[]
var mouthTreatLower1: entity[]
var mouthTreatLower2: entity[]
var mouthTreatLower3: entity[]
var mouthTreatNormalized: entity[]

let chooseNextRequest: exec
var choicePending: bool = false

out Drive: float = driveCommand.Value
out Steer: float = steerCommand.Value
out Brake: bool = brakeCommand.Value
out DriveSpeed: float = driveSpeedCommand.Value
out FrontSuspension: float = frontSuspension.Value
out RearSuspension: float = rearSuspension.Value
out HeadAngle: float = headAngle.Value

let displayFace = if state.Value == RELAX then ">⩊<"
  else if state.Value == ROAM || state.Value == RETURN_HOME then "◈W◈"
  else if state.Value == FOLLOW then "o⩊o"
  else if state.Value == SEEK_FOOD then "⟐⩊⟐"
  else if state.Value == EAT then "♢W♢"
  else if state.Value == SEEK_TREAT then "☆⩊☆"
  else if state.Value == SEEK_PETS || state.Value == WAIT_PETS then "ᵔ⩊ᵔ"
  else if state.Value == PETTED then "^⩊^"
  else if state.Value == STALK then "◉⩊◉"
  else if state.Value == CHASE then "(⧫⩊⧫)"
  else if state.Value == SEEK_BED || state.Value == SLEEPY then "o)⩊(o"
  else if state.Value == SLEEP then "-⩊-"
  else if state.Value == FLEE then "ಥ⩊ಥ"
  else if state.Value == ANGRY then "ಠ⩊ಠ"
  else if state.Value == STRETCH then "🐈"
  else if state.Value == GROOM then "≧⩊≦"
  else "◈W◈"

let displayState = if state.Value == RELAX then "RELAXING"
  else if state.Value == ROAM then "ROAMING"
  else if state.Value == FOLLOW then "FOLLOWING"
  else if state.Value == SEEK_FOOD then "HUNGRY"
  else if state.Value == EAT then "EATING"
  else if state.Value == SEEK_TREAT then "TREAT"
  else if state.Value == SEEK_PETS then "WANTS PETS"
  else if state.Value == WAIT_PETS then "WAITING FOR PETS"
  else if state.Value == PETTED then "GETTING PETTED"
  else if state.Value == STALK then "STALKING"
  else if state.Value == CHASE then "CHASING"
  else if state.Value == SEEK_BED then "FINDING BED"
  else if state.Value == SLEEPY then "SLEEPY"
  else if state.Value == SLEEP then "SLEEPING"
  else if state.Value == FLEE then "SCARED"
  else if state.Value == ANGRY then "ANGRY"
  else if state.Value == STRETCH then "STRETCHING"
  else if state.Value == GROOM then "GROOMING"
  else if state.Value == RETURN_HOME then "GOING HOME"
  else "CONTENT"

let displayColor = if state.Value == RELAX || state.Value == ROAM
    || state.Value == RETURN_HOME then ColorSRGB(65, 210, 105, 255)
  else if state.Value == FOLLOW || state.Value == SEEK_PETS
    || state.Value == WAIT_PETS || state.Value == PETTED
    then ColorSRGB(255, 105, 180, 255)
  else if state.Value == SEEK_FOOD then ColorSRGB(170, 235, 65, 255)
  else if state.Value == EAT || state.Value == SEEK_TREAT
    || state.Value == STRETCH then ColorSRGB(255, 145, 35, 255)
  else if state.Value == STALK then ColorSRGB(255, 145, 35, 255)
  else if state.Value == CHASE then ColorSRGB(255, 225, 45, 255)
  else if state.Value == SEEK_BED || state.Value == SLEEPY
    then ColorSRGB(45, 225, 235, 255)
  else if state.Value == SLEEP then ColorSRGB(25, 55, 150, 255)
  else if state.Value == FLEE then ColorSRGB(75, 135, 255, 255)
  else if state.Value == ANGRY then ColorSRGB(255, 55, 55, 255)
  else if state.Value == GROOM then ColorSRGB(180, 105, 235, 255)
  else ColorSRGB(235, 240, 255, 255)

out FaceText: string = displayFace
out StateText: string = displayState
out MoodColor: color = displayColor
out Purr: bool = seconds.Value < purrUntil.Value
  || state.Value == RELAX && socialNeed.Value < 40.0 && fear.Value < 20.0
@label("PURR AUDIO - select Purring")
out PurrAudio = PURR_SOUND
@label("MEOW AUDIO - select Cat Meow")
out MeowAudio = MEOW_SOUND

mod bounded(value: float) -> float {
  return if value < 0.0 then 0.0 else if value > 100.0 then 100.0 else value
}

mod learned(value: float) -> float {
  return if value < -20.0 then -20.0 else if value > 20.0 then 20.0 else value
}

mod targetCoolingDown(position: vector) -> bool {
  return seconds < failedTargetUntil
    && Magnitude(position - failedTargetPosition) < 120.0
}

mod meow(volume: float = 0.30) {
  let pitchRoll = Random(82, 128)
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  cat.PlayAudioAt(
    MEOW_SOUND,
    volume = volume,
    pitch = pitchRoll / 100.0,
    innerRadius = 30.0,
    maxDistance = 650.0,
    spatialized = true,
  )
}

mod clearTarget() {
  targetEntity = null
  targetKind = TARGET_NONE
  targetValid = false
  targetVisible = false
  focusValid = false
  lastDistance = 1000000.0
  stuckSeconds = 0
  recoveryAttempts = 0
}

mod beginState(next: int, duration: int) {
  previousState = state
  state = next
  stateStarted = seconds
  stateUntil = seconds + duration
  commitUntil = seconds + min(duration, 3)
}

mod setTarget(kind: int, thing: entity, position: vector, visible: bool) {
  targetKind = kind
  targetEntity = thing
  targetPosition = position
  targetValid = true
  targetVisible = visible
  focusPosition = position
  focusValid = true
  lastDistance = 1000000.0
  stuckSeconds = 0
  recoveryAttempts = 0
}

mod rewardPreference(kind: int, amount: float) {
  let adjusted = amount * trainability
  if kind == TARGET_FOOD { foodPreference = learned(foodPreference + adjusted) }
  if kind == TARGET_TREAT { foodPreference = learned(foodPreference + adjusted * 0.65) }
  if kind == TARGET_TOY { playPreference = learned(playPreference + adjusted) }
  if kind == TARGET_BED { bedPreference = learned(bedPreference + adjusted) }
  if kind == TARGET_PLAYER { followPreference = learned(followPreference + adjusted) }
}

mod beginFlee(origin: vector, duration: int) {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let position = cat.GetLocation()
  let away = Normalize(Vec(position.x - origin.x, position.y - origin.y, 0.0))
  fearOrigin = origin
  beginState(FLEE, duration)
  setTarget(TARGET_NONE, null, position + away * 700.0, true)
  purrUntil = seconds
  recoverTicks = 0
}

mod beginAngry(origin: vector) {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let position = cat.GetLocation()
  let away = Normalize(Vec(position.x - origin.x, position.y - origin.y, 0.0))
  fearOrigin = origin
  beginState(ANGRY, Random(8, 13))
  angryRetreatUntil = seconds + 3
  setTarget(TARGET_NONE, null, position + away * 400.0, true)
  requestedPetUntil = 0
  purrUntil = seconds
  meow(0.42)
}

mod beginSleep() {
  beginState(SLEEP, Random(30, 60))
  clearTarget()
  purrUntil = seconds
}

mod beginRoam(catPosition: vector) {
  beginState(ROAM, Random(7, 18))
  let center = if homeKnown then homePosition else catPosition
  let wander = Random(Vec(-520.0, -520.0, 0.0), Vec(520.0, 520.0, 0.0))
  setTarget(TARGET_NONE, null, center + wander, true)
}

mod setHungrySearchTarget(catPosition: vector) {
  let center = if homeKnown then homePosition else catPosition
  let wander = Random(Vec(-560.0, -560.0, 0.0), Vec(560.0, 560.0, 0.0))
  setTarget(TARGET_NONE, null, center + wander, true)
}

mod requestChoice() {
  if !choicePending {
    choicePending = true
    emit chooseNextRequest
  }
}

mod failCurrentTarget() {
  failedTargetPosition = targetPosition
  failedTargetUntil = seconds + 18
  rewardPreference(targetKind, -0.45)
  clearTarget()
  requestChoice()
}

// Calm-state chooser. Critical need transitions are handled before this is
// emitted, so the random graph cannot suppress food, sleep, fear, or anger.
on chooseNextRequest {
  choicePending = false
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let position = cat.GetLocation()
  clearTarget()
  let roll = Random(0, 99)
  let playChance = min(max(18.0 + playPreference + (playfulness - 1.0) * 30.0, 8.0), 45.0)
  let relationBias = (nearestPlayerAffection - nearestPlayerIrritation) / 5.0
  let followChance = min(max(18.0 + followPreference + petPreference * 0.30
    + relationBias + (sociability - 1.0) * 30.0, 3.0), 48.0)
  let toyAvailable = toyKnown && rememberedToy != null
    && !targetCoolingDown(rememberedToyPosition)
  let roamCutoff = min(max(82.0 + roamPreference, 68.0), 94.0)
  if relaxNeed >= 100.0 {
    beginState(RELAX, Random(5, 25))
  } else if playerNearby && nearestPlayerIrritation < 65 && roll < followChance {
    beginState(FOLLOW, Random(8, 18))
    setTarget(TARGET_PLAYER, nearestPlayer, nearestPlayerPosition, true)
  } else if (toyAvailable || playerNearby && nearestPlayerIrritation < 70)
    && roll < followChance + playChance {
    beginState(STALK, 30)
    if toyAvailable {
      setTarget(TARGET_TOY, rememberedToy, rememberedToyPosition, toyVisible)
    } else {
      setTarget(TARGET_PLAYER, nearestPlayer, nearestPlayerPosition, true)
    }
  } else if roll < roamCutoff {
    beginRoam(position)
  } else if roll < 92 {
    beginState(GROOM, Random(4, 9))
  } else {
    beginRoam(position)
  }
}

on Loaded() {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let position = cat.GetLocation()
  if !personalityInitialized {
    homePosition = position
    homeKnown = true
    sociability = Random(80, 120) / 100.0
    playfulness = Random(80, 120) / 100.0
    boldness = Random(80, 120) / 100.0
    patience = Random(80, 120) / 100.0
    foodDrive = Random(80, 120) / 100.0
    curiosity = Random(80, 120) / 100.0
    trainability = Random(80, 120) / 100.0
    personalityInitialized = true
  }
  lastProgressPosition = position
  beginRoam(position)
}

// Perception, memory, needs, learning decay, progress checks, and all ordinary
// state transitions occur in this one ordered handler.
on Clock(interval = 1.0) {
  seconds += 1
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let catPosition = cat.GetLocation()

  if seconds >= nextIdleHeadTurn {
    idleHeadAngle = Random(-28.0, 28.0)
    nextIdleHeadTurn = seconds + Random(3, 7)
  }

  // A spherical player-only sweep finds the nearest detailed player body.
  let playerHit = Sweep(
    catPosition,
    Vec(1.0, 0.0, 0.0),
    1.0,
    radius = RADAR_RANGE,
    ignore = Head,
    detectBricks = false,
    detectPhysics = false,
    detectMap = false,
    detectPlayers1 = true,
    detectPlayers2 = true,
    detectPlayers3 = true,
    detectPlayers4 = true,
    ignoreOwningGrid = true,
    bodyPartsOnly = false,
  )
  playerNearby = false
  nearestPlayer = null
  nearestPlayerCharacter = null
  nearestPlayerAffection = 0
  nearestPlayerIrritation = 0
  var bestPlayerDistance: float = 1000000.0
  if playerHit.Hit {
    nearestPlayer = playerHit.HitEntity
    if nearestPlayer != null {
      nearestPlayerPosition = nearestPlayer.GetLocation()
      bestPlayerDistance = Magnitude(nearestPlayerPosition - catPosition)
      playerNearby = true
    }
  }
  // The zone result is not guaranteed to be distance-sorted. Compare several
  // entries explicitly so a farther array entry cannot steal player focus.
  players.fillFromZonePlayers(Radar)
  if players.length() > 0 {
    let candidate = players.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance <= bestPlayerDistance {
        bestPlayerDistance = distance
        nearestPlayer = candidate
        nearestPlayerCharacter = candidate
        nearestPlayerPosition = position
        playerNearby = true
      }
    }
  }
  if players.length() > 1 {
    let candidate = players.get(1).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance <= bestPlayerDistance {
        bestPlayerDistance = distance
        nearestPlayer = candidate
        nearestPlayerCharacter = candidate
        nearestPlayerPosition = position
        playerNearby = true
      }
    }
  }
  if players.length() > 2 {
    let candidate = players.get(2).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance <= bestPlayerDistance {
        bestPlayerDistance = distance
        nearestPlayer = candidate
        nearestPlayerCharacter = candidate
        nearestPlayerPosition = position
        playerNearby = true
      }
    }
  }
  if players.length() > 3 {
    let candidate = players.get(3).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance <= bestPlayerDistance {
        bestPlayerDistance = distance
        nearestPlayer = candidate
        nearestPlayerCharacter = candidate
        nearestPlayerPosition = position
        playerNearby = true
      }
    }
  }
  if players.length() > 4 {
    let candidate = players.get(4).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance <= bestPlayerDistance {
        bestPlayerDistance = distance
        nearestPlayer = candidate
        nearestPlayerCharacter = candidate
        nearestPlayerPosition = position
        playerNearby = true
      }
    }
  }
  if players.length() > 5 {
    let candidate = players.get(5).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance <= bestPlayerDistance {
        bestPlayerDistance = distance
        nearestPlayer = candidate
        nearestPlayerCharacter = candidate
        nearestPlayerPosition = position
        playerNearby = true
      }
    }
  }
  if players.length() > 6 {
    let candidate = players.get(6).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance <= bestPlayerDistance {
        bestPlayerDistance = distance
        nearestPlayer = candidate
        nearestPlayerCharacter = candidate
        nearestPlayerPosition = position
        playerNearby = true
      }
    }
  }
  if players.length() > 7 {
    let candidate = players.get(7).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance <= bestPlayerDistance {
        nearestPlayer = candidate
        nearestPlayerCharacter = candidate
        nearestPlayerPosition = position
        playerNearby = true
      }
    }
  }

  if nearestPlayerCharacter != null {
    let nearestId = nearestPlayerCharacter.GetUserId()
    let learnedAffection = affectionByPlayer.get(nearestId)
    let learnedIrritation = irritationByPlayer.get(nearestId)
    nearestPlayerAffection = if learnedAffection.Found then learnedAffection.Value else 0
    nearestPlayerIrritation = if learnedIrritation.Found then learnedIrritation.Value else 0
  }

  // Enumerate every supported spelling and keep the closest recognized prop.
  food1.fillFromZoneEntities(Radar, "Cat Food 1")
  foodLegacy.fillFromZoneEntities(Radar, "Cat Food")
  foodNormalized.fillFromZoneEntities(Radar, "cat:food")
  foodVisible = false
  var bestFoodDistance: float = 1000000.0
  if food1.length() > 0 {
    let candidate = food1.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      bestFoodDistance = Magnitude(position - catPosition)
      rememberedFood = candidate
      rememberedFoodPosition = position
      foodVisible = true
      foodKnown = true
    }
  }
  if foodLegacy.length() > 0 {
    let candidate = foodLegacy.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestFoodDistance {
        bestFoodDistance = distance
        rememberedFood = candidate
        rememberedFoodPosition = position
        foodVisible = true
        foodKnown = true
      }
    }
  }
  if foodNormalized.length() > 0 {
    let candidate = foodNormalized.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestFoodDistance {
        rememberedFood = candidate
        rememberedFoodPosition = position
        foodVisible = true
        foodKnown = true
      }
    }
  }
  if rememberedFood == null { foodKnown = false }

  treat1.fillFromZoneEntities(Radar, "Kitty Treat 1")
  treat2.fillFromZoneEntities(Radar, "Kitty Treat 2")
  treat3.fillFromZoneEntities(Radar, "Kitty Treat 3")
  treatLower1.fillFromZoneEntities(Radar, "Kitty treat 1")
  treatLower2.fillFromZoneEntities(Radar, "Kitty treat 2")
  treatLower3.fillFromZoneEntities(Radar, "Kitty treat 3")
  treatNormalized.fillFromZoneEntities(Radar, "cat:treat")
  treatVisible = false
  var bestTreatDistance: float = 1000000.0
  if treat1.length() > 0 {
    let candidate = treat1.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      bestTreatDistance = Magnitude(position - catPosition)
      visibleTreat = candidate
      visibleTreatPosition = position
      treatVisible = true
    }
  }
  if treat2.length() > 0 {
    let candidate = treat2.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestTreatDistance {
        bestTreatDistance = distance
        visibleTreat = candidate
        visibleTreatPosition = position
        treatVisible = true
      }
    }
  }
  if treat3.length() > 0 {
    let candidate = treat3.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestTreatDistance {
        bestTreatDistance = distance
        visibleTreat = candidate
        visibleTreatPosition = position
        treatVisible = true
      }
    }
  }
  if treatLower1.length() > 0 {
    let candidate = treatLower1.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestTreatDistance {
        bestTreatDistance = distance
        visibleTreat = candidate
        visibleTreatPosition = position
        treatVisible = true
      }
    }
  }
  if treatLower2.length() > 0 {
    let candidate = treatLower2.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestTreatDistance {
        bestTreatDistance = distance
        visibleTreat = candidate
        visibleTreatPosition = position
        treatVisible = true
      }
    }
  }
  if treatLower3.length() > 0 {
    let candidate = treatLower3.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestTreatDistance {
        bestTreatDistance = distance
        visibleTreat = candidate
        visibleTreatPosition = position
        treatVisible = true
      }
    }
  }
  if treatNormalized.length() > 0 {
    let candidate = treatNormalized.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestTreatDistance {
        visibleTreat = candidate
        visibleTreatPosition = position
        treatVisible = true
      }
    }
  }

  toy1.fillFromZoneEntities(Radar, "Cat Toy 1")
  toy2.fillFromZoneEntities(Radar, "Cat Toy 2")
  toy3.fillFromZoneEntities(Radar, "Cat Toy 3")
  toyLegacy.fillFromZoneEntities(Radar, "Cat toy 1")
  toyNormalized.fillFromZoneEntities(Radar, "cat:toy")
  toyVisible = false
  var bestToyDistance: float = 1000000.0
  if toy1.length() > 0 {
    let candidate = toy1.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      bestToyDistance = Magnitude(position - catPosition)
      rememberedToy = candidate
      rememberedToyPosition = position
      toyVisible = true
      toyKnown = true
    }
  }
  if toy2.length() > 0 {
    let candidate = toy2.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestToyDistance {
        bestToyDistance = distance
        rememberedToy = candidate
        rememberedToyPosition = position
        toyVisible = true
        toyKnown = true
      }
    }
  }
  if toy3.length() > 0 {
    let candidate = toy3.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestToyDistance {
        bestToyDistance = distance
        rememberedToy = candidate
        rememberedToyPosition = position
        toyVisible = true
        toyKnown = true
      }
    }
  }
  if toyLegacy.length() > 0 {
    let candidate = toyLegacy.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestToyDistance {
        bestToyDistance = distance
        rememberedToy = candidate
        rememberedToyPosition = position
        toyVisible = true
        toyKnown = true
      }
    }
  }
  if toyNormalized.length() > 0 {
    let candidate = toyNormalized.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestToyDistance {
        rememberedToy = candidate
        rememberedToyPosition = position
        toyVisible = true
        toyKnown = true
      }
    }
  }
  if rememberedToy == null { toyKnown = false }

  bed1.fillFromZoneEntities(Radar, "Cat Bed 1")
  bedNormalized.fillFromZoneEntities(Radar, "cat:bed")
  bedVisible = false
  if bed1.length() > 0 {
    let candidate = bed1.get(0).Value
    if candidate != null {
      rememberedBed = candidate
      rememberedBedPosition = candidate.GetLocation()
      bedVisible = true
      bedKnown = true
    }
  } else if bedNormalized.length() > 0 {
    let candidate = bedNormalized.get(0).Value
    if candidate != null {
      rememberedBed = candidate
      rememberedBedPosition = candidate.GetLocation()
      bedVisible = true
      bedKnown = true
    }
  }
  if rememberedBed == null { bedKnown = false }

  // Mouth confirmation must contain the exact committed food or treat entity.
  mouthFood1.fillFromZoneEntities(Mouth, "Cat Food 1")
  mouthFoodLegacy.fillFromZoneEntities(Mouth, "Cat Food")
  mouthFoodNormalized.fillFromZoneEntities(Mouth, "cat:food")
  mouthTreat1.fillFromZoneEntities(Mouth, "Kitty Treat 1")
  mouthTreat2.fillFromZoneEntities(Mouth, "Kitty Treat 2")
  mouthTreat3.fillFromZoneEntities(Mouth, "Kitty Treat 3")
  mouthTreatLower1.fillFromZoneEntities(Mouth, "Kitty treat 1")
  mouthTreatLower2.fillFromZoneEntities(Mouth, "Kitty treat 2")
  mouthTreatLower3.fillFromZoneEntities(Mouth, "Kitty treat 3")
  mouthTreatNormalized.fillFromZoneEntities(Mouth, "cat:treat")
  mouthMatchingTarget = false
  if mouthFood1.length() > 0 && mouthFood1.get(0).Value == targetEntity { mouthMatchingTarget = true }
  if mouthFoodLegacy.length() > 0 && mouthFoodLegacy.get(0).Value == targetEntity { mouthMatchingTarget = true }
  if mouthFoodNormalized.length() > 0 && mouthFoodNormalized.get(0).Value == targetEntity { mouthMatchingTarget = true }
  if mouthTreat1.length() > 0 && mouthTreat1.get(0).Value == targetEntity { mouthMatchingTarget = true }
  if mouthTreat2.length() > 0 && mouthTreat2.get(0).Value == targetEntity { mouthMatchingTarget = true }
  if mouthTreat3.length() > 0 && mouthTreat3.get(0).Value == targetEntity { mouthMatchingTarget = true }
  if mouthTreatLower1.length() > 0 && mouthTreatLower1.get(0).Value == targetEntity { mouthMatchingTarget = true }
  if mouthTreatLower2.length() > 0 && mouthTreatLower2.get(0).Value == targetEntity { mouthMatchingTarget = true }
  if mouthTreatLower3.length() > 0 && mouthTreatLower3.get(0).Value == targetEntity { mouthMatchingTarget = true }
  if mouthTreatNormalized.length() > 0 && mouthTreatNormalized.get(0).Value == targetEntity { mouthMatchingTarget = true }

  // Sleep freezes the other need clocks. Every value remains bounded.
  if state == SLEEP {
    sleepiness = bounded(sleepiness - 3.0)
  } else {
    hunger = bounded(hunger + 0.28 * foodDrive)
    sleepiness = bounded(sleepiness + 0.20)
    boredom = bounded(boredom + 0.45 * playfulness)
    socialNeed = bounded(socialNeed + 0.32 * sociability)
    fear = bounded(fear - 0.9 * boldness)
    annoyance = bounded(annoyance - 0.55 * patience)
    if state != RELAX { relaxNeed = bounded(relaxNeed + 1.0) }
  }
  if state == RELAX { relaxNeed = bounded(relaxNeed - 4.0) }

  if seconds % 60 == 0 {
    foodPreference = learned(foodPreference * 0.98)
    playPreference = learned(playPreference * 0.98)
    petPreference = learned(petPreference * 0.98)
    bedPreference = learned(bedPreference * 0.98)
    followPreference = learned(followPreference * 0.98)
    roamPreference = learned(roamPreference * 0.98)
  }

  // Refresh the one authoritative target without changing its identity.
  if targetEntity != null {
    targetPosition = targetEntity.GetLocation()
    focusPosition = targetPosition
    focusValid = true
  } else if targetValid {
    focusPosition = targetPosition
    focusValid = true
  }

  // Progress/stuck detection asks the fast controller for a short recovery.
  let targetDistance = if targetValid then Magnitude(targetPosition - catPosition) else 0.0
  let moved = Magnitude(catPosition - lastProgressPosition)
  let activeMotion = state == ROAM || state == FOLLOW || state == SEEK_FOOD
    || state == SEEK_TREAT || state == SEEK_PETS || state == STALK
    || state == CHASE || state == SEEK_BED || state == FLEE
    || state == RETURN_HOME
  if activeMotion && targetValid && targetDistance > 100.0 {
    if moved < 3.0 && abs(CurrentSpeed) < 4.0 { stuckSeconds += 1 } else { stuckSeconds = 0 }
    if stuckSeconds >= 3 || EngineStalling {
      recoveryRequest = true
      stuckSeconds = 0
      recoveryAttempts += 1
    }
    if recoveryAttempts >= 3 {
      failCurrentTarget()
    }
  } else {
    stuckSeconds = 0
  }
  lastProgressPosition = catPosition
  lastDistance = targetDistance

  // Treats are opportunistic, but no more than five in the rolling window.
  let treatAllowed = seconds - treatAt5 >= TREAT_WINDOW

  // Committed actions resolve before ordinary utility arbitration.
  if state == EAT {
    if eatingTarget == null || targetEntity != eatingTarget || !mouthMatchingTarget {
      eatProgress = 0
      eatingTarget = null
      failCurrentTarget()
    } else {
      eatProgress += 1
      if eatProgress >= 5 {
        eatingTarget.DestroySpawnedPrefab()
        if eatingKind == TARGET_TREAT {
          treatAt5 = treatAt4
          treatAt4 = treatAt3
          treatAt3 = treatAt2
          treatAt2 = treatAt1
          treatAt1 = seconds
          hunger = bounded(hunger - 18.0)
          boredom = bounded(boredom - 8.0)
          rewardPreference(TARGET_TREAT, 0.8)
          treatVisible = false
          visibleTreat = null
        } else {
          let foodRelief = if Random(0, 1) == 0 then 25.0 else 100.0
          hunger = bounded(hunger - foodRelief)
          rewardPreference(TARGET_FOOD, 0.65)
          foodVisible = false
          foodKnown = false
          rememberedFood = null
        }
        purrUntil = seconds + 4
        eatingTarget = null
        eatProgress = 0
        clearTarget()
        requestChoice()
      }
    }
  } else if state == SLEEP {
    if seconds >= stateUntil || fear >= 60.0 {
      sleepiness = 0.0
      rewardPreference(TARGET_BED, if bedKnown then 0.45 else 0.1)
      beginState(STRETCH, Random(2, 4))
      clearTarget()
    }
  } else if state == STRETCH {
    if seconds >= stateUntil {
      requestChoice()
    }
  } else if state == PETTED {
    if seconds >= petOverlayUntil {
      requestChoice()
    }
  } else if state == FLEE {
    if seconds >= stateUntil {
      fear = bounded(fear - 20.0)
      requestChoice()
    }
  } else if state == ANGRY {
    if seconds >= stateUntil {
      annoyance = bounded(annoyance - 35.0)
      requestChoice()
    } else if seconds >= angryRetreatUntil {
      clearTarget()
    }
  } else if state == CHASE {
    if targetEntity == null || targetDistance > RADAR_RANGE || seconds >= stateUntil
      || targetDistance <= CHASE_CONTACT {
      if targetEntity != null && targetDistance <= CHASE_CONTACT {
        boredom = bounded(boredom - (if Random(0, 1) == 0 then 50.0 else 100.0))
        rewardPreference(TARGET_TOY, 1.2)
      } else {
        rewardPreference(TARGET_TOY, -0.35)
      }
      requestChoice()
    }
  } else if state == STALK {
    if targetEntity == null || targetDistance > 1200.0 || seconds >= stateUntil {
      failCurrentTarget()
    } else if targetDistance <= STALK_TO_CHASE {
      beginState(CHASE, Random(1, 3))
      commitUntil = stateUntil
    }
  } else if state == WAIT_PETS {
    if seconds >= stateUntil {
      socialNeed = bounded(socialNeed - 15.0)
      annoyance = bounded(annoyance + 35.0)
      petPreference = learned(petPreference - 0.5 * trainability)
      beginAngry(if playerNearby then nearestPlayerPosition else focusPosition)
    }
  } else if state == SEEK_FOOD || state == SEEK_TREAT {
    if state == SEEK_FOOD && targetKind == TARGET_NONE {
      if seconds >= stateUntil {
        failCurrentTarget()
      } else if targetDistance <= 75.0 {
        setHungrySearchTarget(catPosition)
      }
    } else if targetEntity == null {
      failCurrentTarget()
    } else if mouthMatchingTarget {
      eatingTarget = targetEntity
      eatingKind = targetKind
      eatProgress = 0
      beginState(EAT, 8)
      commitUntil = stateUntil
    } else if seconds >= stateUntil {
      failCurrentTarget()
    }
  } else if state == SEEK_BED {
    if targetDistance <= BED_STOP {
      beginSleep()
    } else if seconds >= stateUntil {
      beginSleep()
    }
  } else if state == SLEEPY {
    if seconds >= stateUntil {
      if bedKnown {
        beginState(SEEK_BED, 45)
        setTarget(TARGET_BED, rememberedBed, rememberedBedPosition, bedVisible)
      } else {
        beginSleep()
      }
    }
  } else if state == SEEK_PETS {
    if targetEntity == null || seconds >= stateUntil {
      failCurrentTarget()
    } else if targetDistance <= FOLLOW_STOP {
      beginState(WAIT_PETS, 15)
      requestedPetUntil = stateUntil
      focusPosition = targetPosition
      focusValid = true
      targetValid = false
      if Random(0, 99) < 45 { meow(0.30) }
    }
  } else if state == FOLLOW {
    if targetEntity == null || targetDistance > RADAR_RANGE || seconds >= stateUntil {
      requestChoice()
    } else if targetDistance <= FOLLOW_STOP {
      clearTarget()
      socialNeed = bounded(socialNeed - 8.0)
      rewardPreference(TARGET_PLAYER, 0.25)
      requestChoice()
    }
  } else if state == ROAM || state == RETURN_HOME {
    if targetDistance <= 75.0 || seconds >= stateUntil {
      roamPreference = learned(roamPreference + 0.08 * trainability)
      requestChoice()
    }
  } else if state == RELAX || state == GROOM {
    if seconds >= stateUntil { requestChoice() }
  }

  // Hard priorities. They can interrupt calm states after the short commit,
  // but do not interrupt exact eating, fear, anger, sleep, or chase sequences.
  let calmState = state == RELAX || state == ROAM || state == GROOM
    || state == FOLLOW
  let interruptible = state != EAT && state != FLEE && state != ANGRY
    && state != CHASE && state != STALK && state != PETTED
    && state != STRETCH && state != SLEEP && state != SLEEPY
    && state != SEEK_BED && seconds >= commitUntil
  if interruptible && !choicePending {
    let distanceHome = if homeKnown then Magnitude(catPosition - homePosition) else 0.0
    let foodThreshold = min(max(76.0 - foodPreference * 0.35, 68.0), 84.0)
    let sleepThreshold = min(max(82.0 - bedPreference * 0.30, 74.0), 88.0)
    let playThreshold = min(max(74.0 - playPreference * 0.35, 66.0), 82.0)
    let petThreshold = min(max(76.0 - petPreference * 0.35
      - nearestPlayerAffection * 0.05 + nearestPlayerIrritation * 0.08, 64.0), 88.0)
    if fear >= 70.0 && playerNearby {
      beginFlee(nearestPlayerPosition, Random(8, 12))
    } else if (annoyance >= 78.0 || nearestPlayerIrritation >= 80) && playerNearby {
      beginAngry(nearestPlayerPosition)
    } else if hunger >= 95.0 && hunger >= sleepiness && state != SEEK_FOOD {
      beginState(SEEK_FOOD, 55)
      if (foodVisible || foodKnown) && !targetCoolingDown(rememberedFoodPosition) {
        setTarget(TARGET_FOOD, rememberedFood, rememberedFoodPosition, foodVisible)
      } else if playerNearby {
        setTarget(TARGET_PLAYER, nearestPlayer, nearestPlayerPosition, true)
      } else {
        setHungrySearchTarget(catPosition)
      }
    } else if sleepiness >= 95.0 && state != SLEEPY && state != SEEK_BED {
      beginState(SLEEPY, Random(4, 8))
      clearTarget()
    } else if state != SEEK_TREAT && treatVisible && treatAllowed && sleepiness < 90.0
      && !targetCoolingDown(visibleTreatPosition) {
      beginState(SEEK_TREAT, 45)
      setTarget(TARGET_TREAT, visibleTreat, visibleTreatPosition, true)
    } else if calmState && hunger >= foodThreshold {
      beginState(SEEK_FOOD, 55)
      if (foodVisible || foodKnown) && !targetCoolingDown(rememberedFoodPosition) {
        setTarget(TARGET_FOOD, rememberedFood, rememberedFoodPosition, foodVisible)
      } else if playerNearby {
        setTarget(TARGET_PLAYER, nearestPlayer, nearestPlayerPosition, true)
      } else {
        setHungrySearchTarget(catPosition)
      }
    } else if calmState && sleepiness >= sleepThreshold {
      beginState(SLEEPY, Random(4, 8))
      clearTarget()
    } else if calmState && distanceHome > HOME_LIMIT {
      beginState(RETURN_HOME, 50)
      setTarget(TARGET_HOME, null, homePosition, true)
    } else if calmState && boredom >= playThreshold
      && (toyKnown && rememberedToy != null
        && !targetCoolingDown(rememberedToyPosition)
        || playerNearby && nearestPlayerIrritation < 70) {
      beginState(STALK, 30)
      if toyKnown && rememberedToy != null
        && !targetCoolingDown(rememberedToyPosition) {
        setTarget(TARGET_TOY, rememberedToy, rememberedToyPosition, toyVisible)
      } else {
        setTarget(TARGET_PLAYER, nearestPlayer, nearestPlayerPosition, true)
      }
    } else if calmState && socialNeed >= petThreshold && playerNearby
      && nearestPlayerIrritation < 65 {
      beginState(SEEK_PETS, 35)
      setTarget(TARGET_PLAYER, nearestPlayer, nearestPlayerPosition, true)
    }
  }
}

// Movement, posture, neck tracking, wall sensing, and recovery. This is the
// only handler that writes physical command outputs.
on Clock(interval = 0.2) {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let transform = cat.GetLocationRotation()
  let position = transform.Vector
  let rawForward = transform.Rotation.ToDirection()
  // The supplied frame's marked nose is local -X.
  let forward = Normalize(Vec(-rawForward.x, -rawForward.y, 0.0))
  let right = Vec(forward.y, -forward.x, 0.0)

  let wantedFront = if state == STALK || state == STRETCH then 100.0
    else if state == SLEEP || state == ANGRY then 100.0 else 500.0
  let wantedRear = if state == SLEEP || state == ANGRY then 100.0 else 500.0
  frontSuspension = lerp(frontSuspension, wantedFront, 0.20)
  rearSuspension = lerp(rearSuspension, wantedRear, 0.20)
  driveSpeedCommand = if state == CHASE then 280.0
    else if state == FLEE then 300.0
    else if state == STALK then 55.0
    else if state == ANGRY then 160.0
    else if state == SEEK_FOOD || state == SEEK_TREAT then 130.0
    else 105.0

  // Keep the head on the same committed focus as locomotion.
  var lookValid: bool = focusValid
  var lookPosition: vector = focusPosition
  if !lookValid && playerNearby && state != SLEEP {
    lookValid = true
    lookPosition = nearestPlayerPosition
  }
  var desiredHead: float = if state == SLEEP then 0.0 else idleHeadAngle
  if lookValid {
    let toLook = Vec(lookPosition.x - position.x, lookPosition.y - position.y, 0.0)
    if Magnitude(toLook) > 6.0 {
      let desiredLook = Normalize(toLook)
      let lookRadians = atan2(Cross(forward, desiredLook).z, Dot(forward, desiredLook))
      desiredHead = min(max(lookRadians * -57.2958, -55.0), 55.0)
    }
  }
  headAngle = lerp(HeadCurrentAngle, desiredHead, 0.24)

  if recoverCooldownTicks > 0 { recoverCooldownTicks -= 1 }
  if recoveryRequest && recoverCooldownTicks == 0 {
    recoverTicks = 3
    recoverTurn = -recoverTurn
    recoveryRequest = false
  }

  driveCommand = 0.0
  steerCommand = 0.0
  brakeCommand = true

  let stationary = state == RELAX || state == EAT || state == WAIT_PETS
    || state == PETTED || state == SLEEP || state == GROOM
    || state == SLEEPY || state == SEEK_BED && targetValid == false
  if state == STRETCH {
    let rearHit = Sweep(
      position - forward * 30.0 + Vec(0.0, 0.0, 10.0),
      Vec(-forward.x, -forward.y, 0.0),
      38.0,
      radius = 7.0,
      ignore = Head,
      detectBricks = true,
      detectPhysics = false,
      detectMap = true,
      detectPlayers1 = false,
      detectPlayers2 = false,
      detectPlayers3 = false,
      detectPlayers4 = false,
      ignoreOwningGrid = true,
    )
    if rearHit.Miss {
      driveCommand = -0.10
      brakeCommand = false
    }
  } else if state == ANGRY && seconds >= angryRetreatUntil {
    driveCommand = 0.0
    steerCommand = 0.0
    brakeCommand = true
  } else if stationary || !targetValid {
    driveCommand = 0.0
    steerCommand = 0.0
    brakeCommand = true
    recoverTicks = 0
  } else {
    let rearHit = Sweep(
      position - forward * 30.0 + Vec(0.0, 0.0, 10.0),
      Vec(-forward.x, -forward.y, 0.0),
      42.0,
      radius = 7.0,
      ignore = Head,
      detectBricks = true,
      detectPhysics = false,
      detectMap = true,
      detectPlayers1 = false,
      detectPlayers2 = false,
      detectPlayers3 = false,
      detectPlayers4 = false,
      ignoreOwningGrid = true,
    )
    if recoverTicks > 0 {
      if rearHit.Hit {
        recoverTicks = 0
        recoverCooldownTicks = 12
      } else {
        driveCommand = -0.22
        steerCommand = recoverTurn
        brakeCommand = false
        recoverTicks -= 1
        if recoverTicks == 0 { recoverCooldownTicks = 8 }
      }
    } else {
      let toTarget = Vec(targetPosition.x - position.x, targetPosition.y - position.y, 0.0)
      let distance = Magnitude(toTarget)
      let stopDistance = if state == FOLLOW || state == SEEK_PETS then FOLLOW_STOP
        else if state == STALK then STALK_TO_CHASE
        else if state == CHASE then CHASE_CONTACT
        else if state == SEEK_FOOD && targetKind == TARGET_PLAYER then FOLLOW_STOP
        else if state == SEEK_FOOD && targetKind == TARGET_NONE then 75.0
        else if state == SEEK_FOOD || state == SEEK_TREAT then FOOD_STOP
        else if state == SEEK_BED then BED_STOP
        else if state == ROAM || state == RETURN_HOME then 75.0
        else 20.0
      if distance > stopDistance {
        let desired = Normalize(toTarget)
        let turnAngle = atan2(Cross(forward, desired).z, Dot(forward, desired))
        // Brickadia steering convention: -1 left, +1 right.
        steerCommand = min(max(-turnAngle / 0.90, -1.0), 1.0)
        let hardTurn = abs(steerCommand) > 0.72
        driveCommand = if state == CHASE then 1.0
          else if state == STALK then 0.16
          else if hardTurn then 0.22 else 0.62
        brakeCommand = false
      } else {
        driveCommand = 0.0
        steerCommand = 0.0
        brakeCommand = true
      }

      let skipObstacle = distance < 115.0 && (state == SEEK_FOOD
        || state == SEEK_TREAT || state == STALK || state == CHASE
        || state == SEEK_PETS || state == FOLLOW)
      if !skipObstacle {
        let nose = position + forward * 34.0 + Vec(0.0, 0.0, 10.0)
        let leftHit = Sweep(
          nose - right * 15.0,
          forward,
          58.0,
          radius = 6.0,
          ignore = Head,
          detectBricks = true,
          detectPhysics = false,
          detectMap = true,
          detectPlayers1 = false,
          detectPlayers2 = false,
          detectPlayers3 = false,
          detectPlayers4 = false,
          ignoreOwningGrid = true,
        )
        let centerHit = Sweep(
          nose,
          forward,
          48.0,
          radius = 6.0,
          ignore = Head,
          detectBricks = true,
          detectPhysics = false,
          detectMap = true,
          detectPlayers1 = false,
          detectPlayers2 = false,
          detectPlayers3 = false,
          detectPlayers4 = false,
          ignoreOwningGrid = true,
        )
        let rightHit = Sweep(
          nose + right * 15.0,
          forward,
          58.0,
          radius = 6.0,
          ignore = Head,
          detectBricks = true,
          detectPhysics = false,
          detectMap = true,
          detectPlayers1 = false,
          detectPlayers2 = false,
          detectPlayers3 = false,
          detectPlayers4 = false,
          ignoreOwningGrid = true,
        )
        if centerHit.Hit || leftHit.Hit && rightHit.Hit {
          if rearHit.Miss && recoverCooldownTicks == 0 {
            recoverTicks = 3
            recoverTurn = if leftHit.Hit && !rightHit.Hit then 0.8
              else if rightHit.Hit && !leftHit.Hit then -0.8 else -recoverTurn
            driveCommand = -0.22
            steerCommand = recoverTurn
            brakeCommand = false
          } else {
            driveCommand = 0.0
            brakeCommand = true
          }
        } else if leftHit.Hit {
          steerCommand = max(steerCommand, 0.62)
          driveCommand = min(driveCommand, 0.28)
        } else if rightHit.Hit {
          steerCommand = min(steerCommand, -0.62)
          driveCommand = min(driveCommand, 0.28)
        }
      }
    }
  }
}

// Petting is always available. It displays for two seconds, sounds once,
// purrs, raises follow/social preference, and credits only the interacting
// player. Excess petting can produce annoyance and an angry retreat.
on WholeGridInteracted() -> { held: isHeld } {
  if isHeld && seconds >= nextPetAt {
    nextPetAt = seconds + 1
    let petPosition = if Petter != null then Petter.GetLocation()
      else if playerNearby then nearestPlayerPosition else focusPosition
    if seconds >= petBurstUntil {
      petBurstCount = 0
      petBurstUntil = seconds + 12
    }
    petBurstCount += 1
    let requested = state == SEEK_PETS || state == WAIT_PETS
      || seconds < requestedPetUntil
    let overPetted = requested && petBurstCount >= 7
      || !requested && petBurstCount >= 4 && Random(0, 99) < 35
    if state == FLEE {
      fear = bounded(fear + 8.0)
    } else if state == ANGRY || overPetted {
      annoyance = bounded(annoyance + 24.0)
      petPreference = learned(petPreference - 0.65 * trainability)
      if Petter != null {
        let id = Petter.GetUserId()
        let oldAffection = affectionByPlayer.get(id)
        let oldIrritation = irritationByPlayer.get(id)
        affectionByPlayer.set(id, max((if oldAffection.Found then oldAffection.Value else 0) - 3, 0))
        irritationByPlayer.set(id, min((if oldIrritation.Found then oldIrritation.Value else 0) + 14, 100))
      }
      beginAngry(petPosition)
    } else {
      if state == SLEEP { sleepiness = bounded(sleepiness + 12.0) }
      socialNeed = bounded(socialNeed - 38.0)
      fear = bounded(fear - 12.0)
      annoyance = bounded(annoyance - 10.0)
      petPreference = learned(petPreference + 0.8 * trainability)
      followPreference = learned(followPreference + 0.35 * trainability)
      purrUntil = seconds + 8
      previousState = state
      beginState(PETTED, 2)
      petOverlayUntil = seconds + 2
      clearTarget()
      meow(0.26)
      if Petter != null {
        let id = Petter.GetUserId()
        let oldAffection = affectionByPlayer.get(id)
        let oldIrritation = irritationByPlayer.get(id)
        affectionByPlayer.set(id, min((if oldAffection.Found then oldAffection.Value else 0) + 8, 100))
        irritationByPlayer.set(id, max((if oldIrritation.Found then oldIrritation.Value else 0) - 4, 0))
      }
    }
  }
}

on WholeGridTargeted() -> (attacker, damage, weapon, weaponName) {
  let source = if attacker != null then attacker.GetLocation()
    else if playerNearby then nearestPlayerPosition else homePosition
  fear = bounded(fear + max(damage, 25.0))
  annoyance = bounded(annoyance + max(damage * 0.5, 12.0))
  beginFlee(source, Random(8, 12))
  meow(0.48)
}

on ChatCommand("cat", "Call a nearby cat") -> (controller, arguments) {
  let caller = controller.CharacterOf()
  if caller != null {
    let callerPosition = caller.GetLocation()
    let cat = if Chassis != null then Chassis else ReadBrickGrid()
    if Magnitude(callerPosition - cat.GetLocation()) <= HEARING_RANGE
      && state != FLEE && state != ANGRY && state != EAT {
      calledPlayer = caller
      callUntil = seconds + 22
      beginState(FOLLOW, 22)
      setTarget(TARGET_PLAYER, caller, callerPosition, true)
      followPreference = learned(followPreference + 0.30 * trainability)
      let id = controller.GetUserId()
      let oldAffection = affectionByPlayer.get(id)
      affectionByPlayer.set(id, min((if oldAffection.Found then oldAffection.Value else 0) + 2, 100))
      meow(0.32)
    }
  }
}

// Fast target refresh does not select new targets or change state.
on Clock(interval = 0.5) {
  if state == FOLLOW && calledPlayer != null && seconds < callUntil {
    targetEntity = calledPlayer
  }
  if targetEntity != null {
    targetPosition = targetEntity.GetLocation()
    focusPosition = targetPosition
    focusValid = true
  }
}
