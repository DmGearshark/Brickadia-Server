@flat
@layout("cube")

// Priority-driven companion cat for the four-wheel rigid-bearing frame.
// One action variable owns appearance and intent. The one-second loop owns
// sensing, need changes, timers, and arbitration; the 0.2-second loop is the
// only writer of movement and head angle.

in Chassis: entity
in Head: entity
in Radar: zone
in Mouth: zone
in Petter: character

const ROAM = 0
const HUNGRY = 1
const EATING = 2
const SLEEPING = 3
const SLEEPY = 4
const CHASING = 5
const STALKING = 6
const PETTED = 7
const FOLLOWING = 8
const RELAXING = 9

const RADAR_RANGE = 900.0
const FOLLOW_RANGE = 90.0
const STALK_TO_CHASE_RANGE = 180.0
const CHASE_CONTACT_RANGE = 35.0
const FOOD_STOP_RANGE = 20.0

var seconds: int = 0
var action: int = ROAM

// All six priorities are capped at 100. Petting is event-driven and therefore
// deliberately has no need value.
var hungerNeed: float = 0.0
var sleepNeed: float = 0.0
var chaseNeed: float = 0.0
var stalkNeed: float = 0.0
var followNeed: float = 0.0
var relaxNeed: float = 0.0

var driveCommand: float = 0.0
var steerCommand: float = 0.0
var brakeCommand: bool = true
var headAngle: float = 0.0

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
var eatUntil: int = 0
var relaxUntil: int = 0
// The movement clock advances this countdown ten times at 0.2 seconds each.
// This keeps the pet face close to a true two-second display regardless of
// where the interaction falls between the one-second behavior ticks.
var pettedTicks: int = 0
var nextPetAt: int = 0
var chaseUntil: int = 0

var roamSteer: float = 0.25
var avoidTicks: int = 0

// Every state asks this one handler to run the priority list. Keeping the
// arbitration graph behind one exec signal avoids duplicating hundreds of
// gates in the 1.0-second and 0.2-second handlers.
let rerollRequest: exec

out Drive: float = driveCommand.Value
out Steer: float = steerCommand.Value
out Brake: bool = brakeCommand.Value
out HeadAngle: float = headAngle.Value
out CurrentAction: int = action.Value
out HungerNeed: float = hungerNeed.Value
out SleepNeed: float = sleepNeed.Value
out ChaseNeed: float = chaseNeed.Value
out StalkNeed: float = stalkNeed.Value
out FollowNeed: float = followNeed.Value
out RelaxNeed: float = relaxNeed.Value

let displayFace = if action.Value == RELAXING then ">⩊<"
  else if action.Value == FOLLOWING then "o⩊o"
  else if action.Value == STALKING then "◉⩊◉"
  else if action.Value == SLEEPING then "-⩊-"
  else if action.Value == PETTED then "^⩊^"
  else if action.Value == SLEEPY then "o)⩊(o"
  else if action.Value == CHASING then "(⧫⩊⧫)"
  else if action.Value == HUNGRY then "⟐⩊⟐"
  else if action.Value == EATING then "♢W♢"
  else "◈W◈"

let displayColor = if action.Value == RELAXING then ColorSRGB(80, 220, 100, 255)
  else if action.Value == FOLLOWING || action.Value == PETTED
    then ColorSRGB(255, 105, 180, 255)
  else if action.Value == STALKING then ColorSRGB(255, 65, 65, 255)
  else if action.Value == SLEEPING then ColorSRGB(25, 55, 150, 255)
  else if action.Value == SLEEPY then ColorSRGB(45, 225, 235, 255)
  else if action.Value == CHASING || action.Value == HUNGRY
    then ColorSRGB(255, 225, 45, 255)
  else if action.Value == EATING then ColorSRGB(255, 145, 35, 255)
  else ColorSRGB(235, 240, 255, 255)

out FaceText: string = displayFace
out FaceColor: color = displayColor

mod capNeed(value: float) -> float {
  return if value < 0.0 then 0.0 else if value > 100.0 then 100.0 else value
}

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
    let distance = Magnitude(nearestPlayerPosition - catPosition)
    bestDistance = distance
    targetEntity = nearestPlayer
    targetPosition = nearestPlayerPosition
    targetValid = true
    targetIsPlayer = true
  }
  if toyVisible {
    let distance = Magnitude(toyPosition - catPosition)
    if distance < bestDistance {
      bestDistance = distance
      targetEntity = toyEntity
      targetPosition = toyPosition
      targetValid = true
      targetIsPlayer = false
    }
  }
}

mod beginHungry(catPosition: vector) {
  action = HUNGRY
  targetEntity = null
  targetValid = false
  targetIsPlayer = false
  hungryTargetKind = 0
  if foodVisible {
    targetEntity = foodEntity
    targetPosition = foodPosition
    targetValid = true
    hungryTargetKind = 1
  } else if playerNearby {
    targetEntity = nearestPlayer
    targetPosition = nearestPlayerPosition
    targetValid = true
    targetIsPlayer = true
    hungryTargetKind = 2
  }
}

mod beginSleep() {
  action = SLEEPING
  stopAndClearTarget()
}

mod beginDirectChase(catPosition: vector) {
  choosePlayTarget(catPosition)
  if targetValid {
    action = CHASING
    chaseNeed = 0.0
    chaseUntil = seconds + 10
  }
}

mod beginForcedChase() {
  if targetValid {
    action = CHASING
    chaseNeed = 0.0
    chaseUntil = seconds + 10
  }
}

mod beginStalk(catPosition: vector) {
  choosePlayTarget(catPosition)
  if targetValid {
    action = STALKING
    stalkNeed = Random(0, 50)
  }
}

mod beginFollow() {
  if playerNearby {
    action = FOLLOWING
    targetEntity = nearestPlayer
    targetPosition = nearestPlayerPosition
    targetValid = true
    targetIsPlayer = true
  }
}

mod beginRelax() {
  action = RELAXING
  relaxUntil = seconds + Random(5, 25)
  stopAndClearTarget()
}

mod arbitrate(catPosition: vector) {
  let playAvailable = playerNearby || toyVisible
  if sleepNeed >= 100.0 {
    beginSleep()
  } else if hungerNeed >= 100.0 {
    beginHungry(catPosition)
  } else if chaseNeed >= 100.0 && playAvailable {
    beginDirectChase(catPosition)
  } else if stalkNeed >= 100.0 && playAvailable {
    beginStalk(catPosition)
  } else if followNeed >= 100.0 && playerNearby {
    beginFollow()
  } else if relaxNeed >= 100.0 && hungerNeed < 100.0 && sleepNeed < 100.0
    && chaseNeed < 100.0 && stalkNeed < 100.0 && followNeed < 100.0 {
    beginRelax()
  } else if sleepNeed >= 75.0 {
    action = SLEEPY
    stopAndClearTarget()
  } else {
    action = ROAM
    stopAndClearTarget()
  }
}

on rerollRequest {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  arbitrate(cat.GetLocation())
}

on Loaded() {
  action = ROAM
  stopAndClearTarget()
}

// Keep the same readable roaming arcs as the working simple controller.
on Clock(interval = 3.5) {
  roamSteer = Random(-0.65, 0.65)
}

// Sensing, need changes, state completion, and arbitration are deliberately
// ordered in one handler so a state never reads a stale same-second snapshot.
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

  // Compare the first result from each exact toy tag. Flat WireScript cannot
  // create a loop plane; this still chooses the closest tag representative.
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

  var reroll: bool = false
  if action == SLEEPING {
    // Sleeping is the sole state that freezes every other priority.
    sleepNeed = capNeed(sleepNeed - 1.0)
    if sleepNeed <= 0.0 {
      action = ROAM
      reroll = true
    }
  } else {
    hungerNeed = capNeed(hungerNeed + 1.0)
    sleepNeed = capNeed(sleepNeed + 1.0)
    chaseNeed = capNeed(chaseNeed + 1.0)
    stalkNeed = capNeed(stalkNeed + 1.0)
    followNeed = capNeed(followNeed + 1.0)
    relaxNeed = if action == RELAXING then capNeed(relaxNeed - 4.0)
      else capNeed(relaxNeed + 1.0)

    if action == EATING {
      if mouthFood == null || mouthFood != eatingTarget {
        eatingTarget = null
        beginHungry(catPosition)
      } else if seconds >= eatUntil {
        eatingTarget.DestroySpawnedPrefab()
        let reduction = if Random(0, 3) < 2 then 25.0 else 100.0
        hungerNeed = capNeed(hungerNeed - reduction)
        eatingTarget = null
        foodEntity = null
        foodVisible = false
        action = ROAM
        reroll = true
      }
    } else if action == HUNGRY {
      if sleepNeed >= 100.0 {
        reroll = true
      } else if mouthFood != null {
        action = EATING
        eatingTarget = mouthFood
        eatUntil = seconds + 5
        stopAndClearTarget()
      } else {
        beginHungry(catPosition)
      }
    } else if action == PETTED {
      // The 0.2-second clock owns this short event timer and reruns arbitration
      // immediately when it expires.
    } else if action == RELAXING {
      if seconds >= relaxUntil {
        action = ROAM
        reroll = true
      }
    } else if action == CHASING {
      if hungerNeed >= 100.0 || sleepNeed >= 100.0 {
        reroll = true
      } else if targetEntity == null {
        action = ROAM
        reroll = true
      } else {
        targetPosition = targetEntity.GetLocation()
        let distance = Magnitude(targetPosition - catPosition)
        targetValid = distance <= RADAR_RANGE
        if !targetValid || distance <= CHASE_CONTACT_RANGE || seconds >= chaseUntil {
          action = ROAM
          stopAndClearTarget()
          reroll = true
        }
      }
    } else if action == STALKING {
      if hungerNeed >= 100.0 || sleepNeed >= 100.0
        || (chaseNeed >= 100.0 && (playerNearby || toyVisible)) {
        reroll = true
      } else if targetEntity == null {
        action = ROAM
        reroll = true
      } else {
        targetPosition = targetEntity.GetLocation()
        let distance = Magnitude(targetPosition - catPosition)
        targetValid = distance <= RADAR_RANGE
        if !targetValid {
          action = ROAM
          stopAndClearTarget()
          reroll = true
        } else if distance <= STALK_TO_CHASE_RANGE {
          beginForcedChase()
        }
      }
    } else if action == FOLLOWING {
      if hungerNeed >= 100.0 || sleepNeed >= 100.0
        || (chaseNeed >= 100.0 && (playerNearby || toyVisible))
        || (stalkNeed >= 100.0 && (playerNearby || toyVisible)) {
        reroll = true
      } else if targetEntity == null {
        action = ROAM
        reroll = true
      } else {
        targetPosition = targetEntity.GetLocation()
        let distance = Magnitude(targetPosition - catPosition)
        targetValid = distance <= RADAR_RANGE
        if !targetValid {
          action = ROAM
          stopAndClearTarget()
          reroll = true
        } else if distance <= FOLLOW_RANGE {
          followNeed = 0.0
          action = ROAM
          stopAndClearTarget()
          reroll = true
        }
      }
    } else {
      reroll = true
    }
  }
  if reroll { emit rerollRequest }
}

// This loop alone writes the engine and rigid-bearing outputs.
on Clock(interval = 0.2) {
  let cat = if Chassis != null then Chassis else ReadBrickGrid()
  let transform = cat.GetLocationRotation()
  let position = transform.Vector
  let rawForward = transform.Rotation.ToDirection()
  let forward = Normalize(Vec(rawForward.x, rawForward.y, 0.0))

  if action == PETTED {
    if pettedTicks > 0 { pettedTicks -= 1 }
    if pettedTicks <= 0 {
      action = ROAM
      emit rerollRequest
    }
  }

  if playerNearby {
    let toPlayer = Vec(nearestPlayerPosition.x - position.x,
      nearestPlayerPosition.y - position.y, 0.0)
    if Magnitude(toPlayer) > 4.0 {
      let desiredLook = Normalize(toPlayer)
      let lookRadians = atan2(Cross(forward, desiredLook).z, Dot(forward, desiredLook))
      headAngle = min(max(lookRadians * -57.2958, -180.0), 180.0)
    }
  } else {
    headAngle = 0.0
  }

  var wantsMotion: bool = false
  driveCommand = 0.0
  steerCommand = 0.0
  brakeCommand = true

  if action == ROAM || (action == HUNGRY && hungryTargetKind == 0) {
    driveCommand = 0.25
    steerCommand = roamSteer
    brakeCommand = false
    wantsMotion = true
  } else if action == HUNGRY || action == FOLLOWING
    || action == STALKING || action == CHASING {
    if targetEntity != null {
      targetPosition = targetEntity.GetLocation()
      let toTarget = Vec(targetPosition.x - position.x, targetPosition.y - position.y, 0.0)
      let distance = Magnitude(toTarget)
      let stopRange = if action == STALKING then STALK_TO_CHASE_RANGE
        else if action == CHASING then CHASE_CONTACT_RANGE
        else if action == HUNGRY && hungryTargetKind == 1 then FOOD_STOP_RANGE
        else FOLLOW_RANGE
      if distance > stopRange {
        let desired = Normalize(toTarget)
        let turnAngle = atan2(Cross(forward, desired).z, Dot(forward, desired))
        steerCommand = min(max(turnAngle / 0.8, -1.0), 1.0)
        let hardTurn = abs(steerCommand) > 0.75
        driveCommand = if action == CHASING then 1.0
          else if action == STALKING then 0.12
          else if hardTurn then 0.16 else 0.42
        brakeCommand = false
        wantsMotion = true
      }
    }
  }

  if wantsMotion {
    let nose = position + forward * 22.0 + Vec(0.0, 0.0, 5.0)
    let obstacle = Sweep(
      nose,
      forward,
      140.0,
      radius = 8.0,
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
    if obstacle.Hit { avoidTicks = 5 }
    if avoidTicks > 0 {
      driveCommand = -0.22
      steerCommand = 0.9
      brakeCommand = false
      avoidTicks -= 1
    }
  } else {
    avoidTicks = 0
  }
}

// Calling /cat fills the social need. The normal priority pass then decides
// whether Following may start, so sleep, hunger, chase, and stalk retain their
// documented order. Following always uses the closest currently sensed player.
on ChatCommand("cat", "Call a nearby cat") -> (controller, arguments) {
  let caller = controller.CharacterOf()
  if caller != null {
    let cat = if Chassis != null then Chassis else ReadBrickGrid()
    let callerPosition = caller.GetLocation()
    if Magnitude(callerPosition - cat.GetLocation()) <= RADAR_RANGE {
      followNeed = 100.0
      nearestPlayer = caller
      nearestPlayerPosition = callerPosition
      playerNearby = true
    }
  }
}

// Petting is an event state, not a threshold priority. It is always available,
// lasts about two seconds, adds four FollowNeed, plays a sound, then rerolls.
on WholeGridInteracted() -> { held: isHeld } {
  if isHeld && seconds >= nextPetAt {
    nextPetAt = seconds + 1
    followNeed = capNeed(followNeed + 4.0)
    action = PETTED
    pettedTicks = 10
    stopAndClearTarget()
    petSound()
  }
}
