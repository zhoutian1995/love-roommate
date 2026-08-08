function nonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function scenarioDurationMs(scenario, config = {}, behaviors = {}) {
  if (scenario === 'dad-shout' || scenario === 'grandpa-shout') return 20000;
  if (scenario === 'centipede') {
    const sharedSpeed = positive(behaviors.motion?.maxSpeed, 120);
    const chaseSpeed = positive(behaviors.centipede?.maxSpeed, sharedSpeed);
    const effectiveSpeed = Math.min(sharedSpeed, chaseSpeed);
    const required = 2200 / effectiveSpeed * 1000 + 4000;
    return Math.max(6000, Math.ceil(required / 1000) * 1000);
  }
  if (scenario !== 'poop-chase'
    || config.selection?.chaseVariant !== 'self-poop'
    || !config.selection?.userCharacterId) return 6000;

  const followerCount = Math.max(0, (config.characters || [])
    .filter((character) => character?.id !== config.selection.userCharacterId).length);
  const settings = behaviors.poopChase || {};
  const initialDelay = nonNegative(settings.initialDropDelayMs, 250);
  const visibleDelay = nonNegative(settings.dropVisibleBeforeEatMs, 650);
  const mouthHold = Math.max(
    nonNegative(settings.eatDurationMs, 420),
    nonNegative(settings.mouthHoldMs, 520)
  );
  // Real desktop-compositor evidence freezes the ticker while each eating and
  // handoff frame is captured. Reserve travel plus two capture milestones per
  // follower so the final eater is still reached on the eight-person gate.
  const captureAndTravelBudgetMs = 2500;
  const perFollower = visibleDelay + mouthHold + captureAndTravelBudgetMs;
  const required = initialDelay
    + followerCount * perFollower
    + nonNegative(settings.consumedDelayMs, 240)
    + nonNegative(settings.roundResetDelayMs, 600)
    + 4000;
  return Math.max(6000, Math.ceil(required / 1000) * 1000);
}
