@flat
@layout("cube")

// Timer-and-trigger companion cat. Calm states choose weighted successors;
// committed states finish their target or timer before choosing again.

in Chassis: entity
in Head: entity
in Radar: zone
in Mouth: zone
in Petter: character

const ROAM = 0
const RELAX = 1
const FOLLOW = 2
const STALK = 3
const CHASE = 4
const HUNGRY = 5
const EATING = 6
const SLEEPY = 7
const SLEEP = 8
const PETTED = 9

const RADAR_RANGE = 900.0
const FOLLOW_RANGE = 90.0
const STALK_TO_CHASE_RANGE = 180.0
const CHASE_CONTACT_RANGE = 35.0
const FOOD_STOP_RANGE = 20.0
const WALL_SWEEP_DISTANCE = 90.0
const WALL_SWEEP_RADIUS = 6.0
const WALL_REVERSE_TICKS = 2

var seconds: int = 0
var state: int = ROAM
var stateUntil: int = 0
var awakeSeconds: int = 0
var sleepAfter: int = 480
var pettedTicks: int = 0
var nextPetAt: int = 0

var driveCommand: float = 0.0
var steerCommand: float = 0.0
var brakeCommand: bool = true
var headAngle: float = 0.0
var roamSteer: float = 0.25
var avoidTicks: int = 0

var playerNearby: bool = false
var nearestPlayer: entity
var nearestPlayerPosition: vector = Vec(0.0, 0.0, 0.0)

var foodItems: entity[]
var mouthFoodItems: entity[]
var toyItems1: entity[]
var toyItems2: entity[]
var toyItems3: entity[]
var foodEntity: entity
var foodPosition: vector = Vec(0.0, 0.0, 0.0)
var foodVisible: bool = false
var mouthFood: entity
var toyEntity: entity
var toyPosition: vector = Vec(0.0, 0.0, 0.0)
var toyVisible: bool = false

var targetEntity: entity
var targetPosition: vector = Vec(0.0, 0.0, 0.0)
var targetValid: bool = false
var targetIsPlayer: bool = false
var hungryTargetKind: int = 0 // 0 roam, 1 food, 2 player
var eatingTarget: entity

let chooseNextRequest: exec

out Drive: float = driveCommand.Value
out Steer: float = steerCommand.Value
out Brake: bool = brakeCommand.Value
out HeadAngle: float = headAngle.Value
out CurrentAction: int = state.Value

let displayFace = if state.Value == RELAX then ">⩊<"
  else if state.Value == FOLLOW then "o⩊o"
  else if state.Value == STALK then "◉⩊◉"
  else if state.Value == CHASE then "(⧫⩊⧫)"
  else if state.Value == HUNGRY then "⟐⩊⟐"
  else if state.Value == EATING then "♢W♢"
  else if state.Value == SLEEPY then "o)⩊(o"
  else if state.Value == SLEEP then "-⩊-"
  else if state.Value == PETTED then "^⩊^"
  else "◈W◈"

let displayColor = if state.Value == RELAX then ColorSRGB(80, 220, 100, 255)
  else if state.Value == FOLLOW || state.Value == PETTED
    then ColorSRGB(255, 105, 180, 255)
  else if state.Value == STALK then ColorSRGB(255, 65, 65, 255)
  else if state.Value == CHASE || state.Value == HUNGRY
    then ColorSRGB(255, 225, 45, 255)
  else if state.Value == EATING then ColorSRGB(255, 145, 35, 255)
  else if state.Value == SLEEPY then ColorSRGB(45, 225, 235, 255)
  else if state.Value == SLEEP then ColorSRGB(25, 55, 150, 255)
  else ColorSRGB(235, 240, 255, 255)

out FaceText: string = displayFace
out FaceColor: color = displayColor

mod stopAndClearTarget() {
  targetEntity = null
  targetValid = false
  targetIsPlayer = false
  hungryTargetKind = 0
  driveCommand = 0.0
  steerCommand = 0.0
  brakeCommand = true
  avoidTicks = 0
}

mod petSound() {
  let pitchRoll = Random(112, 142)
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  cat.PlayAudioAt(
    $BrickOneShotAudioDescriptor/OBA_Beep_3,
    volume = 0.28,
    pitch = pitchRoll / 100.0,
    innerRadius = 25.0,
    maxDistance = 550.0,
    spatialized = true,
  )
}

mod choosePlayTarget(catPosition: vector) {
  targetEntity = null
  targetValid = false
  targetIsPlayer = false
  var bestDistance: float = 1000000.0
  if playerNearby {
    bestDistance = Magnitude(nearestPlayerPosition - catPosition)
    targetEntity = nearestPlayer
    targetPosition = nearestPlayerPosition
    targetValid = true
    targetIsPlayer = true
  }
  if toyVisible {
    let distance = Magnitude(toyPosition - catPosition)
    if distance < bestDistance {
      targetEntity = toyEntity
      targetPosition = toyPosition
      targetValid = true
      targetIsPlayer = false
    }
  }
}

// Weighted calm-state transition. This graph exists once and is shared by
// every completed, failed, or timed-out state through an exec signal.
on chooseNextRequest {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let catPosition = cat.GetLocation()
  let roll = Random(0, 99)
  stopAndClearTarget()
  if roll < 45 {
    state = ROAM
    stateUntil = seconds + Random(6, 18)
  } else if roll < 70 {
    state = RELAX
    stateUntil = seconds + Random(5, 20)
  } else if roll < 85 && playerNearby {
    state = FOLLOW
    stateUntil = seconds + Random(8, 18)
    targetEntity = nearestPlayer
    targetPosition = nearestPlayerPosition
    targetValid = true
    targetIsPlayer = true
  } else {
    choosePlayTarget(catPosition)
    if targetValid {
      state = STALK
      stateUntil = seconds + 30
    } else {
      state = ROAM
      stateUntil = seconds + Random(6, 18)
    }
  }
}

on Loaded() {
  state = ROAM
  stateUntil = Random(6, 18)
  sleepAfter = Random(300, 600)
  awakeSeconds = 0
  stopAndClearTarget()
}

on Clock(interval = 3.5) {
  roamSteer = Random(-0.65, 0.65)
}

// Sensing and state transitions share one ordered one-second handler.
on Clock(interval = 1.0) {
  seconds += 1
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let catPosition = cat.GetLocation()

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
  )
  playerNearby = false
  nearestPlayer = null
  if playerHit.Hit {
    nearestPlayer = playerHit.HitEntity
    if nearestPlayer != null {
      nearestPlayerPosition = nearestPlayer.GetLocation()
      playerNearby = true
    }
  }

  foodItems.fillFromZoneEntities(Radar, "Cat Food 1")
  foodVisible = false
  foodEntity = null
  if foodItems.length() > 0 {
    foodEntity = foodItems.get(0).Value
    if foodEntity != null {
      foodPosition = foodEntity.GetLocation()
      foodVisible = true
    }
  }

  toyItems1.fillFromZoneEntities(Radar, "Cat Toy 1")
  toyItems2.fillFromZoneEntities(Radar, "Cat Toy 2")
  toyItems3.fillFromZoneEntities(Radar, "Cat Toy 3")
  toyVisible = false
  toyEntity = null
  var bestToyDistance: float = 1000000.0
  if toyItems1.length() > 0 {
    let candidate = toyItems1.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      bestToyDistance = Magnitude(position - catPosition)
      toyEntity = candidate
      toyPosition = position
      toyVisible = true
    }
  }
  if toyItems2.length() > 0 {
    let candidate = toyItems2.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestToyDistance {
        bestToyDistance = distance
        toyEntity = candidate
        toyPosition = position
        toyVisible = true
      }
    }
  }
  if toyItems3.length() > 0 {
    let candidate = toyItems3.get(0).Value
    if candidate != null {
      let position = candidate.GetLocation()
      let distance = Magnitude(position - catPosition)
      if distance < bestToyDistance {
        bestToyDistance = distance
        toyEntity = candidate
        toyPosition = position
        toyVisible = true
      }
    }
  }

  mouthFoodItems.fillFromZoneEntities(Mouth, "Cat Food 1")
  mouthFood = null
  if mouthFoodItems.length() > 0 {
    mouthFood = mouthFoodItems.get(0).Value
  }

  if state == SLEEP {
    if seconds >= stateUntil {
      awakeSeconds = 0
      sleepAfter = Random(300, 600)
      emit chooseNextRequest
    }
  } else if state == EATING {
    if mouthFood == null || mouthFood != eatingTarget {
      eatingTarget = null
      state = HUNGRY
      stateUntil = seconds + 60
    } else if seconds >= stateUntil {
      eatingTarget.DestroySpawnedPrefab()
      eatingTarget = null
      foodEntity = null
      foodVisible = false
      emit chooseNextRequest
    }
  } else if state == PETTED {
    // The 0.2-second movement clock owns this short display timer.
  } else if state == SLEEPY {
    if seconds >= stateUntil {
      state = SLEEP
      stateUntil = seconds + Random(30, 60)
      stopAndClearTarget()
    }
  } else {
    awakeSeconds += 1
    // Stalk and Chase are committed sequences. Food and sleep timers wait
    // until the sequence completes or loses its target.
    if state == STALK {
      if targetEntity == null {
        emit chooseNextRequest
      } else {
        targetPosition = targetEntity.GetLocation()
        let distance = Magnitude(targetPosition - catPosition)
        targetValid = distance <= RADAR_RANGE
        if !targetValid || seconds >= stateUntil {
          emit chooseNextRequest
        } else if distance <= STALK_TO_CHASE_RANGE {
          state = CHASE
          stateUntil = seconds + Random(1, 3)
        }
      }
    } else if state == CHASE {
      if targetEntity == null {
        emit chooseNextRequest
      } else {
        targetPosition = targetEntity.GetLocation()
        let distance = Magnitude(targetPosition - catPosition)
        targetValid = distance <= RADAR_RANGE
        if !targetValid || distance <= CHASE_CONTACT_RANGE || seconds >= stateUntil {
          emit chooseNextRequest
        }
      }
    } else if state == HUNGRY {
      if mouthFood != null {
        state = EATING
        eatingTarget = mouthFood
        stateUntil = seconds + 5
        stopAndClearTarget()
      } else if foodVisible {
        targetEntity = foodEntity
        targetPosition = foodPosition
        targetValid = true
        targetIsPlayer = false
        hungryTargetKind = 1
      } else if playerNearby {
        targetEntity = nearestPlayer
        targetPosition = nearestPlayerPosition
        targetValid = true
        targetIsPlayer = true
        hungryTargetKind = 2
      } else {
        targetEntity = null
        targetValid = false
        hungryTargetKind = 0
      }
      if seconds >= stateUntil { emit chooseNextRequest }
    } else if foodVisible {
      state = HUNGRY
      stateUntil = seconds + 60
      targetEntity = foodEntity
      targetPosition = foodPosition
      targetValid = true
      targetIsPlayer = false
      hungryTargetKind = 1
    } else if awakeSeconds >= sleepAfter {
      state = SLEEPY
      stateUntil = seconds + Random(4, 8)
      stopAndClearTarget()
    } else if state == FOLLOW {
      if targetEntity == null {
        emit chooseNextRequest
      } else {
        targetPosition = targetEntity.GetLocation()
        let distance = Magnitude(targetPosition - catPosition)
        targetValid = distance <= RADAR_RANGE
        if !targetValid || distance <= FOLLOW_RANGE || seconds >= stateUntil {
          emit chooseNextRequest
        }
      }
    } else if seconds >= stateUntil {
      emit chooseNextRequest
    }
  }
}

// Movement and head tracking. The obstacle response is the verified controller
// from the working rigid-head cat, including the separate Head ignore entity.
on Clock(interval = 0.2) {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let transform = cat.GetLocationRotation()
  let position = transform.Vector
  let rawForward = transform.Rotation.ToDirection()
  let forward = Normalize(Vec(rawForward.x, rawForward.y, 0.0))

  if state == PETTED {
    if pettedTicks > 0 { pettedTicks -= 1 }
    if pettedTicks <= 0 { emit chooseNextRequest }
  }

  var hasLookTarget: bool = false
  var lookPosition: vector = Vec(0.0, 0.0, 0.0)
  if targetEntity != null && (state == HUNGRY || state == FOLLOW
    || state == STALK || state == CHASE) {
    lookPosition = targetEntity.GetLocation()
    hasLookTarget = true
  } else if playerNearby {
    lookPosition = nearestPlayerPosition
    hasLookTarget = true
  }
  headAngle = 0.0
  if hasLookTarget {
    let toLook = Vec(lookPosition.x - position.x, lookPosition.y - position.y, 0.0)
    if Magnitude(toLook) > 4.0 {
      let desiredLook = Normalize(toLook)
      let lookRadians = atan2(Cross(forward, desiredLook).z, Dot(forward, desiredLook))
      headAngle = min(max(lookRadians * -57.2958, -180.0), 180.0)
    }
  }

  var wantsMotion: bool = false
  driveCommand = 0.0
  steerCommand = 0.0
  brakeCommand = true

  if state == ROAM || (state == HUNGRY && hungryTargetKind == 0) {
    driveCommand = 0.25
    steerCommand = roamSteer
    brakeCommand = false
    wantsMotion = true
  } else if state == HUNGRY || state == FOLLOW || state == STALK || state == CHASE {
    if targetEntity != null {
      targetPosition = targetEntity.GetLocation()
      let toTarget = Vec(targetPosition.x - position.x, targetPosition.y - position.y, 0.0)
      let distance = Magnitude(toTarget)
      let stopRange = if state == STALK then STALK_TO_CHASE_RANGE
        else if state == CHASE then CHASE_CONTACT_RANGE
        else if state == HUNGRY && hungryTargetKind == 1 then FOOD_STOP_RANGE
        else FOLLOW_RANGE
      if distance > stopRange {
        let desired = Normalize(toTarget)
        let turnAngle = atan2(Cross(forward, desired).z, Dot(forward, desired))
        steerCommand = min(max(turnAngle / 0.8, -1.0), 1.0)
        let hardTurn = abs(steerCommand) > 0.75
        driveCommand = if state == CHASE then 1.0
          else if state == STALK then 0.12
          else if hardTurn then 0.16 else 0.42
        brakeCommand = false
        wantsMotion = true
      }
    }
  }

  if wantsMotion {
    if avoidTicks > 0 {
      driveCommand = -0.22
      steerCommand = 0.9
      brakeCommand = false
      avoidTicks -= 1
    } else {
      let nose = position + forward * 22.0 + Vec(0.0, 0.0, 5.0)
      let obstacle = Sweep(
        nose,
        forward,
        WALL_SWEEP_DISTANCE,
        radius = WALL_SWEEP_RADIUS,
        ignore = Head,
        detectBricks = true,
        detectPhysics = true,
        detectMap = true,
        detectPlayers1 = false,
        detectPlayers2 = false,
        detectPlayers3 = false,
        detectPlayers4 = false,
        ignoreOwningGrid = true,
      )
      if obstacle.Hit {
        avoidTicks = WALL_REVERSE_TICKS - 1
        driveCommand = -0.22
        steerCommand = 0.9
        brakeCommand = false
      }
    }
  } else {
    avoidTicks = 0
  }
}

on ChatCommand("cat", "Call a nearby cat") -> (controller, arguments) {
  let caller = controller.CharacterOf()
  if caller != null {
    let cat = if Chassis != null then Chassis else ReadBrickGrid()
    let callerPosition = caller.GetLocation()
    if Magnitude(callerPosition - cat.GetLocation()) <= RADAR_RANGE {
      state = FOLLOW
      stateUntil = seconds + Random(10, 20)
      targetEntity = caller
      targetPosition = callerPosition
      targetValid = true
      targetIsPlayer = true
      hungryTargetKind = 0
    }
  }
}

on WholeGridInteracted() -> { held: isHeld } {
  if isHeld && seconds >= nextPetAt {
    nextPetAt = seconds + 1
    state = PETTED
    pettedTicks = 10
    stopAndClearTarget()
    petSound()
  }
}
