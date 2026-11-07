@flat
@layout("cube")

// Player-facing monitor. Edit this variable inside the chip to change range.
// Brickadia uses ten position units per building block/stud.
var trackingRangeBlocks: float = 15.0
var bearingAngle: float = 0.0

in Monitor: entity
in CurrentAngle: float

out BearingAngle: float = bearingAngle.Value

on Loaded() {
  bearingAngle = CurrentAngle
}

on Clock(interval = 0.1) {
  if Monitor != null {
    let transform = Monitor.GetLocationRotation()
    let position = transform.Vector
    let rawForward = transform.Rotation.ToDirection()
    let forward = Normalize(Vec(rawForward.x, rawForward.y, 0.0))
    let playerHit = Sweep(
      position,
      Vec(1.0, 0.0, 0.0),
      1.0,
      radius = trackingRangeBlocks * 10.0,
      ignore = Monitor,
      detectBricks = false,
      detectPhysics = false,
      detectMap = false,
      detectPlayers1 = true,
      detectPlayers2 = true,
      detectPlayers3 = true,
      detectPlayers4 = true,
      ignoreOwningGrid = true,
    )
    if playerHit.Hit && playerHit.HitEntity != null {
      let playerPosition = playerHit.HitEntity.GetLocation()
      let toPlayer = Vec(playerPosition.x - position.x,
        playerPosition.y - position.y, 0.0)
      if Magnitude(toPlayer) > 0.01 {
        let desired = Normalize(toPlayer)
        let signedRadians = atan2(Cross(forward, desired).z, Dot(forward, desired))
        let rawAngle = CurrentAngle - signedRadians * 57.2958
        bearingAngle = fmod(rawAngle + 180.0, 360.0) - 180.0
      }
    } else {
      // Hold its current direction when nobody is inside the selected range.
      bearingAngle = CurrentAngle
    }
  }
}
