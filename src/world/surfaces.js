// Ground surfaces and their physical properties, shared by every world.
//
// mu       peak tyre friction coefficient at nominal (road) tyre pressure
// crr      rolling resistance coefficient on a rigid tyre
// soft     how deformable the ground is (0 rigid .. 1 loose sand): drives sinkage,
//          bulldozing resistance, and how much lowering tyre pressure helps
// rough    vibration / suspension excitation and puncture risk at low pressure
// dust     how much dust a spinning or fast wheel throws up
// dustColor sRGB colour of the plume

export const SURF = {
  ASPHALT: 0, PISTE: 1, SOIL: 2, ROCK: 3, REG: 4, SAND: 5, SNOW: 6, RIVERBED: 7, OASIS: 8,
  SALT: 9, ICE: 10, TUNDRA: 11, MUD: 12,
};

export const SURFACES = [
  { id: 0, name: 'Asphalt', mu: 1.0, crr: 0.012, soft: 0.0, rough: 0.05, dust: 0.0, dustColor: [0.5, 0.5, 0.5] },
  { id: 1, name: 'Gravel piste', mu: 0.72, crr: 0.028, soft: 0.12, rough: 0.35, dust: 1.0, dustColor: [0.72, 0.62, 0.48] },
  { id: 2, name: 'Forest soil', mu: 0.78, crr: 0.04, soft: 0.25, rough: 0.3, dust: 0.25, dustColor: [0.45, 0.38, 0.28] },
  { id: 3, name: 'Rock', mu: 0.85, crr: 0.02, soft: 0.0, rough: 0.9, dust: 0.2, dustColor: [0.6, 0.55, 0.5] },
  { id: 4, name: 'Reg (stony desert)', mu: 0.76, crr: 0.026, soft: 0.1, rough: 0.55, dust: 0.85, dustColor: [0.62, 0.5, 0.38] },
  { id: 5, name: 'Soft sand', mu: 0.62, crr: 0.05, soft: 1.0, rough: 0.05, dust: 1.0, dustColor: [0.88, 0.62, 0.4] },
  { id: 6, name: 'Snow', mu: 0.38, crr: 0.045, soft: 0.45, rough: 0.05, dust: 0.6, dustColor: [0.95, 0.96, 1.0] },
  { id: 7, name: 'Riverbed', mu: 0.5, crr: 0.06, soft: 0.5, rough: 0.6, dust: 0.0, dustColor: [0.4, 0.38, 0.35] },
  { id: 8, name: 'Oasis soil', mu: 0.7, crr: 0.045, soft: 0.35, rough: 0.2, dust: 0.3, dustColor: [0.5, 0.42, 0.3] },
  { id: 9, name: 'Salt crust', mu: 0.7, crr: 0.02, soft: 0.05, rough: 0.2, dust: 0.5, dustColor: [0.95, 0.94, 0.92] },
  { id: 10, name: 'Ice', mu: 0.12, crr: 0.015, soft: 0.0, rough: 0.05, dust: 0.1, dustColor: [0.9, 0.95, 1.0] },
  { id: 11, name: 'Tundra', mu: 0.6, crr: 0.06, soft: 0.5, rough: 0.3, dust: 0.1, dustColor: [0.45, 0.42, 0.35] },
  { id: 12, name: 'Mud', mu: 0.4, crr: 0.08, soft: 0.8, rough: 0.2, dust: 0.0, dustColor: [0.35, 0.28, 0.2] },
];
