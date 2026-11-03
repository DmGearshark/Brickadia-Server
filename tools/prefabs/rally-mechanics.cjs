const fs = require('node:fs');
const assert = require('node:assert/strict');
const { WorldReader, brdb } = require('brs-js');

// The source is only needed while generating. The output prefab is standalone.
const DEFAULT_REFERENCE = require('node:path').join(__dirname, 'references', 'car.brz');

function addMechanics(world, referencePath = process.env.MARTEN_REFERENCE_CAR || DEFAULT_REFERENCE) {
  const reader = WorldReader.from(fs.readFileSync(referencePath));
  const assets = reader.brickAssets(), materials = reader.materials();
  const entities = new Map([...reader.entities()].map(e => [e.persistentIndex, e]));
  const mainChunk = reader.brickChunkIndex(1)[0];
  assert.equal(reader.brickChunkIndex(1).length, 1);
  const mainBricks = [...reader.bricks(1)];
  const mainComponents = reader.componentChunk(1, mainChunk.index);
  const mainHandles = new Map(), entityHandles = new Map();
  const casterRecords = new Map();
  const latestComponents = brdb.embeddedSchema('BRSavedComponentChunkSoA_max');

  function entityInput(e) {
    const data = structuredClone(e.data);
    if (e.typeName === 'Entity_Wheel_Caster') {
      // World currently supports only brick-grid classes. Encode a temporary
      // dynamic class, then restore the actual native class in finalizeArchive.
      delete data.Scale; delete data.FrictionMode;
      data.CollisionQuality = 0;
    }
    return {
      type: e.typeName === 'Entity_Wheel_Caster' ? 'Entity_DynamicBrickGrid' : e.typeName,
      location: e.location, rotation: e.rotation,
      frozen: false, sleeping: true,
      linear_velocity: { X: 0, Y: 0, Z: 0 },
      angular_velocity: { X: 0, Y: 0, Z: 0 },
      colors: Object.values(e.colors), data, owner_index: 0,
    };
  }
  function copyBrick(brick, offset, components, grid) {
    const input = {
      ...brick,
      asset: assets[brick.asset_name_index],
      material: materials[brick.material_index],
      owner_index: 0,
      position: brick.position.map((v, i) => v + [offset.x, offset.y, offset.z][i]),
      components: components.map(c => {
        const structName = brdb.COMPONENT_TYPE_STRUCTS.get(c.typeName);
        const fields = latestComponents.structs.get(structName);
        assert(fields, `Unknown component struct ${structName}`);
        return { type: c.typeName,
          data: Object.fromEntries(Object.entries(structuredClone(c.data)).filter(([key]) => fields.has(key))) };
      }),
    };
    delete input.asset_name_index;
    delete input.material_index;
    return world.addBrick(input, grid);
  }

  // Exact, known-working chassis, wheel mounts, seats and slim engine.
  const mechanicalIndices = [63, 66, 67, 68, 69, 71, 72, 73];
  for (const index of mechanicalIndices) {
    mainHandles.set(index, copyBrick(mainBricks[index], mainChunk.offset,
      mainComponents.components.filter(c => c.brickIndex === index)));
  }

  // Keep BOTH levels of the proven wheel assembly: chassis wheel joint ->
  // wheel brick grid -> native caster. Directly attaching the caster with the
  // first joint's transform would lose the bearing's second transform.
  const soa = mainComponents.soa;
  for (let j = 0; j < soa.JointBrickIndices.length; j++) {
    const mainIndex = soa.JointBrickIndices[j];
    if (!mainHandles.has(mainIndex)) continue; // rear deck is intentionally omitted
    const gridId = soa.JointEntityReferences[j], entity = entities.get(gridId);
    assert.equal(entity.typeName, 'Entity_DynamicBrickGrid');
    const grid = world.addBrickGrid(entityInput(entity));
    entityHandles.set(gridId, grid);
    const chunks = reader.brickChunkIndex(gridId);
    assert.equal(chunks.length, 1);
    const chunk = chunks[0], data = reader.componentChunk(gridId, chunk.index);
    const bricks = [...reader.bricks(gridId)], handles = [];
    for (let i = 0; i < bricks.length; i++) {
      handles.push(copyBrick(bricks[i], chunk.offset,
        data.components.filter(c => c.brickIndex === i), grid));
    }
    world.addJoint(mainHandles.get(mainIndex), grid, {
      offset: soa.JointInitialRelativeOffsets[j],
      rotation: soa.JointInitialRelativeRotations[j],
    });
    for (let k = 0; k < data.soa.JointBrickIndices.length; k++) {
      const wheelId = data.soa.JointEntityReferences[k], wheel = entities.get(wheelId);
      assert.equal(wheel.typeName, 'Entity_Wheel_Caster');
      const handle = world.addEntity(entityInput(wheel));
      casterRecords.set(2 + handle.entityOrder, wheel);
      entityHandles.set(wheelId, handle);
      world.addJoint(handles[data.soa.JointBrickIndices[k]], handle, {
        offset: data.soa.JointInitialRelativeOffsets[k],
        rotation: data.soa.JointInitialRelativeRotations[k],
      });
    }
  }
  const engineType = 'Component_Internal_WheelEngine';
  for (const index of [66, 67, 68, 69]) {
    world.addWire(
      { brick: mainHandles.get(73), component_type: engineType, port: 'Control_DriveAndSteer' },
      { brick: mainHandles.get(index), component_type: 'Component_Internal_Joint_Wheel', port: 'Control_DriveAndSteer' }
    );
  }
  world.addWire(
    { brick: mainHandles.get(72), component_type: 'Component_Internal_Seat', port: 'SittingCharacter' },
    { brick: mainHandles.get(73), component_type: engineType, port: 'Character' }
  );
  assert.equal(entityHandles.size, 8);
  return {
    brickCount: mechanicalIndices.length,
    totalMechanicalBricks: mechanicalIndices.length + 4 * 28,
    entityCount: entityHandles.size,
    finalizeArchive(bytes) {
      const out = WorldReader.from(bytes), archive = out.fs;
      const files = new Map(archive.listPaths().map(p => [p, archive.readFile(p)]));
      const global = out.globalData();
      const casterTypeIndex = global.EntityTypeNames.length;
      global.EntityTypeNames.push('Entity_Wheel_Caster');
      global.EntityDataClassNames.push('BP_Entity_Wheel_Caster_C');
      const entitySchema = out.schema('World/0/Entities/ChunksShared.schema');
      // Decode using the generated schema before importing the native class.
      const decoded = [];
      for (const chunk of out.entityChunkIndex().chunks) {
        const path = `World/0/Entities/Chunks/${chunk.index.x}_${chunk.index.y}_${chunk.index.z}.mps`;
        const reader = new brdb.ByteReader(files.get(path));
        const soa = entitySchema.readValue(reader, 'BRSavedEntityChunkSoA');
        const classes = [];
        for (const run of soa.TypeCounters) for (let i = 0; i < run.NumEntities; i++) classes.push(global.EntityDataClassNames[run.TypeIndex]);
        const data = classes.map(name => entitySchema.readValue(reader, name));
        assert.equal(reader.remaining, 0);
        decoded.push({ path, soa, data, classes });
      }
      entitySchema.merge(reader.schema('World/0/Entities/ChunksShared.schema').extractStructsTransitive(['BP_Entity_Wheel_Caster_C']));
      for (const { path, soa, data, classes } of decoded) {
        const types = [];
        for (const run of soa.TypeCounters) for (let i = 0; i < run.NumEntities; i++) types.push(run.TypeIndex);
        soa.TypeCounters = [];
        for (let i = 0; i < types.length; i++) {
          const wheel = casterRecords.get(soa.PersistentIndices[i]);
          if (wheel) { types[i] = casterTypeIndex; classes[i] = wheel.className; data[i] = wheel.data; }
          const last = soa.TypeCounters.at(-1);
          if (last && last.TypeIndex === types[i]) last.NumEntities++;
          else soa.TypeCounters.push({ TypeIndex: types[i], NumEntities: 1 });
        }
        const writer = new brdb.ByteWriter();
        entitySchema.writeValue(writer, 'BRSavedEntityChunkSoA', soa);
        for (let i = 0; i < data.length; i++) entitySchema.writeValue(writer, classes[i], data[i]);
        files.set(path, writer.toBytes());
      }
      files.set('World/0/Entities/ChunksShared.schema', entitySchema.toBinary());
      files.set('World/0/GlobalData.mps', out.schema('World/0/GlobalData.schema').encode('BRSavedGlobalDataSoA', global));
      function tree(prefix = '') {
        return [...archive.childFolders(prefix).map(n => [n, brdb.folder(tree(prefix ? `${prefix}/${n}` : n))]),
          ...archive.childFiles(prefix).map(n => [n, brdb.file(files.get(prefix ? `${prefix}/${n}` : n))])];
      }
      const result = brdb.writeBrzContainer(tree());
      const check = WorldReader.from(result);
      const checkedEntities = [...check.entities()];
      assert.equal(checkedEntities.filter(e => e.typeName === 'Entity_Wheel_Caster').length, 4);
      const checkedIds = new Set(checkedEntities.map(e => e.persistentIndex));
      let checkedJoints = 0;
      for (const grid of check.gridIds()) for (const chunk of check.brickChunkIndex(grid)) if (chunk.numComponents) {
        const components = check.componentChunk(grid, chunk.index).soa;
        checkedJoints += components.JointEntityReferences.length;
        for (const target of components.JointEntityReferences) assert(checkedIds.has(target), `Unresolved joint entity ${target}`);
      }
      assert.equal(checkedJoints, 8);
      for (const e of checkedEntities) if (casterRecords.has(e.persistentIndex)) {
        const original = casterRecords.get(e.persistentIndex);
        assert.deepEqual(e.data, original.data);
        assert.deepEqual(e.location, original.location);
        assert.deepEqual(e.rotation, original.rotation);
      }
      return result;
    },
    externalAssets: reader.externalAssets(),
    handles: mainHandles,
    clearance: { seatCenters: [[-10, 0, 3], [10, 0, 3]],
      chassis: { position: [0, -5, -14], size: [15, 50, 6] } },
  };
}

module.exports = { addMechanics };
