// Field journal: which species the player has observed, persisted per world.

export class Journal {
  constructor(world) {
    this.world = world;
    this.key = `terra.journal.${world.id}`;
    this.data = { fauna: {}, flora: {} };
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) this.data = Object.assign(this.data, JSON.parse(raw));
    } catch { /* ignore */ }
  }

  has(kind, id) { return !!this.data[kind][id]; }

  discover(kind, id, where) {
    if (this.data[kind][id]) return false;
    this.data[kind][id] = { t: Date.now(), where };
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch { /* ignore */ }
    return true;
  }

  get faunaList() { return this.world.fauna; }
  get floraList() { return this.world.flora.filter((f) => !f.hidden); }

  get progress() {
    const fa = this.faunaList.filter((s) => this.has('fauna', s.id)).length;
    const fl = this.floraList.filter((s) => this.has('flora', s.id)).length;
    return { found: fa + fl, total: this.faunaList.length + this.floraList.length, fa, fl };
  }
}
